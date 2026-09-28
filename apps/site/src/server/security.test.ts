import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { now, reportPrefix, schema, sha256 } from "@commitscape/server";
import { fakeGitHub, repoFacts, testDeps, viewer } from "#/test/deps";
import { clientAddress, sameOrigin, SiteError } from "./http";
import { allow } from "./limits";
import { known, LOOKUP_LIMIT, lookup, reportEntry, requestBuild, WAITING_MAX } from "./repos";
import { createShare, deleteShare, getShare, SHARES_TOTAL, uploadShare } from "./shares";
import { githubSigned } from "./webhooks";

const { builds, repositories, shares } = schema;

afterEach(() => vi.unstubAllGlobals());

describe("addresses and limits", () => {
  test("a page is the Site's by its public address, though a proxy passes the request on over http", () => {
    const from = (origin?: string) => sameOrigin(new Request("http://site.internal:3000/", { headers: origin ? { origin } : {} }), "https://commitscape.example");
    expect(from("https://commitscape.example")).toBe(true);
    expect(from()).toBe(true);
    expect(from("http://site.internal:3000")).toBe(false);
    expect(from("https://elsewhere.example")).toBe(false);
  });

  test("an IPv6 address counts as its /64; an IPv4 one as itself", () => {
    const at = (h: Record<string, string>) => clientAddress(new Request("http://site/", { headers: h }), "x-forwarded-for");
    expect(at({ "x-forwarded-for": "2001:db8:1:2:3:4:5:6, 10.0.0.1" })).toBe("2001:db8:1:2::/64");
    expect(at({ "x-forwarded-for": "2001:db8::1" })).toBe("2001:db8:0:0::/64");
    expect(at({ "x-forwarded-for": "198.51.100.7" })).toBe("198.51.100.7");
    expect(at({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "10.0.0.1" })).toBe("192.0.2.1");
  });

  test("an address gets its number in each window, then no more, and others are counted apart", async () => {
    const { db } = await testDeps();
    const limit = { action: "t", max: 2, seconds: 3600 };
    expect(await allow(db, limit, "a")).toBe(true);
    expect(await allow(db, limit, "a")).toBe(true);
    expect(await allow(db, limit, "a")).toBe(false);
    expect(await allow(db, limit, "b")).toBe(true);
  });
});

describe("repositories", () => {
  test("a name that is not GitHub's is refused before anything is asked", async () => {
    const deps = await testDeps();
    await expect(lookup(deps, viewer(), "-rf", "x")).rejects.toThrow(SiteError);
    await expect(lookup(deps, viewer(), "acme", "..")).rejects.toThrow(SiteError);
  });

  test("an address that looks up too many repositories is told so, and GitHub is not asked", async () => {
    const deps = await testDeps();
    const gh = fakeGitHub({ "/repos/acme/rocket": repoFacts(1) });
    vi.stubGlobal("fetch", gh.fetcher);
    for (let i = 0; i < LOOKUP_LIMIT.max; i++) await allow(deps.db, LOOKUP_LIMIT, "203.0.113.9");
    await expect(lookup(deps, viewer(), "acme", "rocket")).rejects.toThrow("many repositories");
    expect(gh.asked).toEqual([]);
  });

  test("a name now another repository's forgets the old one's Report", async () => {
    const deps = await testDeps();
    await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, reportKey: reportPrefix("acme/rocket", "b1"), reportAt: now(), factsAt: 0 });
    await deps.storage.put(`${reportPrefix("acme/rocket", "b1")}/index.json`, "{}", { type: "application/json" });
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/rocket": repoFacts(2) }).fetcher);
    const row = await known(deps, "acme", "rocket");
    expect(row?.githubId).toBe(2);
    expect(row?.reportKey).toBeNull();
    expect(deps.storage.objects.size).toBe(0);
  });

  test("a private repository's Report is as if there were none to someone GitHub does not show it to", async () => {
    const deps = await testDeps();
    await deps.db.insert(repositories).values({ id: "acme/secret", owner: "acme", name: "secret", isPrivate: true, status: "private", installationId: 5, reportKey: "reports/gh/acme/secret/b1", factsAt: now() });
    await expect(reportEntry(deps, viewer(), "acme", "secret", "/api/overview?window=all")).rejects.toThrow("No Report");
  });

  test("people's Builds waiting across the Site are capped, and a queue that is down pauses them", async () => {
    const deps = await testDeps();
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/rocket": repoFacts(1), "/repos/acme/other": repoFacts(3, { full_name: "acme/other" }) }).fetcher);
    await deps.db.insert(repositories).values({ id: "busy/one", owner: "busy", name: "one" });
    for (let i = 0; i < WAITING_MAX; i++) await deps.db.insert(builds).values({ id: `w${i}`, repoId: "busy/one", state: "queued", requestedAt: now() });
    await expect(requestBuild(deps, viewer(), "acme", "rocket")).rejects.toThrow("many repositories to read");
    await deps.db.delete(builds);

    const started = await requestBuild(deps, viewer(), "acme", "rocket");
    expect(started.build?.state).toBe("queued");
    expect(deps.sent).toHaveLength(1);

    const down = { ...deps, queue: () => Promise.reject(new Error("down")) };
    const paused = await requestBuild(down, viewer(), "acme", "other");
    expect(paused.build).toMatchObject({ state: "failed", reason: "paused" });
  });

  test("a Build asked for from another site is refused", async () => {
    const deps = await testDeps();
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/rocket": repoFacts(1) }).fetcher);
    await expect(requestBuild(deps, viewer({ sameOrigin: false }), "acme", "rocket")).rejects.toThrow("Not from this Site");
  });
});

describe("Shared Reports", () => {
  const hash = sha256("delete-token");

  test("upload once with its token, read until it expires, delete with the Delete Token", async () => {
    const { db, storage } = await testDeps();
    const made = await createShare(db, "a", { bytes: 40, hours: 1, deleteHash: hash });
    await expect(uploadShare(db, storage, made.id, "wrong", new Uint8Array(40))).rejects.toThrow("Not this Shared Report's upload");
    await expect(uploadShare(db, storage, made.id, made.uploadToken, new Uint8Array(39))).rejects.toThrow("not the size");
    await uploadShare(db, storage, made.id, made.uploadToken, new Uint8Array(40));
    await expect(uploadShare(db, storage, made.id, made.uploadToken, new Uint8Array(40))).rejects.toThrow("Not this Shared Report's upload");
    expect((await getShare(db, storage, made.id)).body.length).toBe(40);
    await expect(deleteShare(db, storage, made.id, "not-it")).rejects.toThrow("Delete Token");
    await deleteShare(db, storage, made.id, "delete-token");
    await expect(getShare(db, storage, made.id)).rejects.toThrow("no Shared Report");
  });

  test("an expired one says so, and the Site stops taking them when it holds its fill", async () => {
    const { db, storage } = await testDeps();
    await db.insert(shares).values({ id: "old", bytes: 40, createdAt: 0, expiresAt: now() - 1, deleteHash: hash, uploaded: true });
    await expect(getShare(db, storage, "old")).rejects.toMatchObject({ status: 410 });
    const third = Math.ceil(SHARES_TOTAL / 3);
    for (const id of ["f1", "f2", "f3"]) await db.insert(shares).values({ id, bytes: third, createdAt: now(), expiresAt: now() + 3600, deleteHash: hash, uploaded: true });
    await expect(createShare(db, "a", { bytes: 40, hours: 1, deleteHash: hash })).rejects.toMatchObject({ status: 503 });
  });

  test("its size, hours and Delete Token's hash are checked", async () => {
    const { db } = await testDeps();
    await expect(createShare(db, "a", { bytes: 26 * 1024 * 1024, hours: 1, deleteHash: hash })).rejects.toMatchObject({ status: 413 });
    await expect(createShare(db, "a", { bytes: 40, hours: 13, deleteHash: hash })).rejects.toMatchObject({ status: 400 });
    await expect(createShare(db, "a", { bytes: 40, hours: 1, deleteHash: "nope" })).rejects.toMatchObject({ status: 400 });
  });
});

test("a webhook is GitHub's only under the secret", () => {
  const body = '{"action":"deleted"}';
  const good = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
  expect(githubSigned("s3cret", good, body)).toBe(true);
  expect(githubSigned("s3cret", good, `${body} `)).toBe(false);
  expect(githubSigned(undefined, good, body)).toBe(false);
  expect(githubSigned("s3cret", "sha256=00", body)).toBe(false);
});
