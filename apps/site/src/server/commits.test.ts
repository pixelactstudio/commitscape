import { describe, expect, test } from "vitest";
import { cursorOf, UNKNOWN_PERSON } from "@commitscape/data";
import { now, schema, seedIndex, type SeedIndex } from "@commitscape/server";
import { fakeEngine, packed, testDeps, viewer } from "#/test/deps";
import { commitAskOf, COMMITS_UNAVAILABLE, reportCommitPage } from "./commits";
import { SiteError } from "./http";

const { access, repositories, session, user } = schema;

const sha = (c: string) => c.repeat(20);

const seed: SeedIndex = {
  anchor: 1000,
  persons: [{ id: 3, name: "Alice Example", login: "alice" }],
  files: [
    { file: 0, path: "a.ts" },
    { file: 1, path: "b.ts" },
    { file: 2, path: "c.ts" },
  ],
  commits: [
    { sha: sha("c3"), at: 100, person: 3, subject: "fix: the launch", kind: 1, files: [0, 1, 2], added: [1, 1, 1] },
    { sha: sha("b2"), at: 200, person: null, subject: "fix: the fuel", kind: 1, files: [0, 1], added: [1, 1] },
    { sha: sha("a1"), at: 300, person: 3, subject: "feat: launch", kind: 0, files: [0], added: [1] },
  ],
};

async function stored() {
  const deps = await testDeps();
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 2, status: "private", isPrivate: true, installationId: 5, factsAt: now(), reportKey: "reports/gh/acme/secret/b1", reportAt: 600 },
    { id: "acme/old", owner: "acme", name: "old", githubId: 3, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/old/b1", reportAt: 700 },
  ]);
  await seedIndex(deps.db, "acme/rocket", seed);
  await seedIndex(deps.db, "acme/secret", seed);
  return deps;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("the commits API", () => {
  test("reads its query, and refuses what is not a number or a cursor", () => {
    expect(commitAskOf(new URLSearchParams("at=500&q=%20fix%20&person=3&kind=1&from=10&to=20&limit=5&cursor=MQ"))).toEqual({ at: 500, q: "fix", person: 3, kind: 1, from: 10, to: 20, limit: 5, cursor: "MQ" });
    expect(() => commitAskOf(new URLSearchParams("limit=ten"))).toThrow("limit must be a whole number.");
    expect(() => commitAskOf(new URLSearchParams(`cursor=${"x".repeat(41)}`))).toThrow(SiteError);
    expect(commitAskOf(new URLSearchParams(`cursor=2s.${"ab".repeat(20)}`)).cursor).toBe(`2s.${"ab".repeat(20)}`);
    expect(() => commitAskOf(new URLSearchParams(`cursor=2s.${"ab".repeat(20)}'`))).toThrow(SiteError);
  });

  test("a page starts right after the last commit of the one before, and a numbered cursor still counts from the top", async () => {
    const deps = await stored();
    const first = await reportCommitPage(deps, viewer(), "acme", "rocket", { limit: 2 });
    expect(first.page?.rows.map((r) => r.sha)).toEqual([sha("a1"), sha("b2")]);
    expect(first.page?.next).toBe(`${(200).toString(36)}.${sha("b2")}`);
    const next = await reportCommitPage(deps, viewer(), "acme", "rocket", { limit: 2, cursor: first.page?.next ?? undefined });
    expect(next.page).toMatchObject({ total: null, next: null });
    expect(next.page?.rows.map((r) => r.sha)).toEqual([sha("c3")]);
    const counted = await reportCommitPage(deps, viewer(), "acme", "rocket", { limit: 2, cursor: cursorOf(1) });
    expect(counted.page?.rows.map((r) => r.sha)).toEqual([sha("b2"), sha("c3")]);
  });

  test("pages a public Report's commits, kept for good when the address pins the Report", async () => {
    const deps = await stored();
    const pinned = await reportCommitPage(deps, viewer(), "acme", "rocket", { at: 500, q: "fix", limit: 1 });
    expect(pinned.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(pinned.page).toMatchObject({ all: 3, total: 2, link: "https://github.com/acme/rocket/commit/", rows: [{ sha: sha("b2"), personId: UNKNOWN_PERSON, added: 2, files: 2 }] });
    const next = await reportCommitPage(deps, viewer(), "acme", "rocket", { q: "fix", limit: 1, cursor: pinned.page?.next ?? undefined });
    expect(next.cacheControl).toBe("public, max-age=300");
    expect(next.page?.rows.map((r) => r.sha)).toEqual([sha("c3")]);
    expect(next.page?.people).toEqual({ "3": { id: 3, name: "Alice Example", colour: null, login: "alice" } });
  });

  test("answers an ETag it gave with no page, and a changed query with another", async () => {
    const deps = await stored();
    const first = await reportCommitPage(deps, viewer(), "acme", "rocket", { q: "fix" });
    expect((await reportCommitPage(deps, viewer(), "acme", "rocket", { q: "fix", at: 1 }, first.etag)).page).toBeNull();
    expect((await reportCommitPage(deps, viewer(), "acme", "rocket", { q: "launch" }, first.etag)).page?.total).toBe(2);
  });

  test("a private repository's commits are only for who GitHub shows it to, and kept privately", async () => {
    const deps = await stored();
    expect(await failure(reportCommitPage(deps, viewer(), "acme", "secret", {}))).toEqual([404, "No Report of this repository yet."]);
    await deps.db.insert(user).values({ id: "u1", name: "Alice", email: "alice@example.com" });
    await deps.db.insert(session).values({ id: "s1", token: "t", userId: "u1", expiresAt: new Date(Date.now() + 3600_000), updatedAt: new Date() });
    await deps.db.insert(access).values({ sessionId: "s1", repoId: "acme/secret", allowed: true, until: now() + 300 });
    const signedIn = viewer({ session: async () => ({ id: "s1", userId: "u1" }), token: async () => "token" });
    const seen = await reportCommitPage(deps, signedIn, "acme", "secret", { at: 600 });
    expect(seen.cacheControl).toBe("private, max-age=60");
    expect(seen.page?.rows).toHaveLength(3);
  });

  test("words are searched by the engine service over the pack, and only the page it names is read from Postgres", async () => {
    const engine = fakeEngine(({ endpoint }) => (endpoint === "/v1/commits/search" ? { shas: [sha("a1")], total: 2, next: "next-page" } : endpoint === "/v1/commits/under" ? { shas: [sha("b2")], total: 1, next: null } : undefined));
    const deps = Object.assign(await stored(), { engine });
    const si = (await deps.db.select().from(repositories)).find((r) => r.id === "acme/rocket")?.indexId ?? 0;
    const pack = await packed(deps.db, si);
    const found = await reportCommitPage(deps, viewer(), "acme", "rocket", { q: "Launch", kind: 0 });
    expect(engine.asked).toEqual([{ endpoint: "/v1/commits/search", body: { pack, query: { q: "Launch", kind: 0 } } }]);
    expect(found.page?.rows.map((r) => r.subject)).toEqual(["feat: launch"]);
    expect([found.page?.total, found.page?.next]).toEqual([2, "next-page"]);
    const under = await reportCommitPage(deps, viewer(), "acme", "rocket", { q: "fuel", under: "a.ts" });
    expect(engine.asked.at(-1)).toEqual({ endpoint: "/v1/commits/under", body: { pack, path: "a.ts", query: { q: "fuel" }, said: null } });
    expect(under.page?.rows.map((r) => r.subject)).toEqual(["fix: the fuel"]);
    const plain = await reportCommitPage(deps, viewer(), "acme", "rocket", { kind: 1 });
    expect(plain.page?.rows).toHaveLength(2);
    expect(engine.asked).toHaveLength(2);
  });

  test("a repository built before it had a Stored Index says so until it is built again", async () => {
    const deps = await stored();
    expect(await failure(reportCommitPage(deps, viewer(), "acme", "old", {}))).toEqual([404, COMMITS_UNAVAILABLE]);
  });
});
