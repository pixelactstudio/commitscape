import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { UNKNOWN_PERSON, type CommitList } from "@commitscape/data";
import { now, schema, storeCommits } from "@commitscape/server";
import { testDeps, viewer } from "#/test/deps";
import { commitAskOf, COMMITS_UNAVAILABLE, reportCommitPage } from "./commits";
import { SiteError } from "./http";

const { access, repositories, session, user } = schema;

const list: CommitList = {
  link: "https://github.com/acme/rocket/commit/",
  lines: true,
  kinds: ["features", "fixes"],
  people: [{ person: { id: 3, name: "Alice Example", colour: null, login: "alice" }, emails: [] }, { person: { id: UNKNOWN_PERSON, name: "someone unknown", colour: null, login: null }, emails: [] }],
  ids: ["a1", "b2", "c3"],
  times: [300, 200, 100],
  offsets: [0, 0, 0],
  person: [0, 1, 0],
  subjects: ["feat: launch", "fix: the fuel", "fix: the launch"],
  kind: [0, 1, 1],
  merge: [false, false, false],
  files: [1, 2, 3],
  added: [1, 2, 3],
  removed: [0, 0, 0],
};

async function stored() {
  const deps = await testDeps();
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/rocket/b1", reportAt: 500 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 2, status: "private", isPrivate: true, installationId: 5, factsAt: now(), reportKey: "reports/gh/acme/secret/b1", reportAt: 600 },
    { id: "acme/old", owner: "acme", name: "old", githubId: 3, status: "ok", factsAt: now(), reportKey: "reports/gh/acme/old/b1", reportAt: 700 },
  ]);
  await storeCommits(deps.db, deps.storage, "acme/rocket", "reports/gh/acme/rocket/b1", gzipSync(JSON.stringify(list)));
  await storeCommits(deps.db, deps.storage, "acme/secret", "reports/gh/acme/secret/b1", gzipSync(JSON.stringify(list)));
  return deps;
}

const failure = (p: Promise<unknown>) => p.then(() => null, (e: SiteError) => [e.status, e.message]);

describe("the commits API", () => {
  test("reads its query, and refuses what is not a number or a cursor", () => {
    expect(commitAskOf(new URLSearchParams("at=500&q=%20fix%20&person=3&kind=1&from=10&to=20&limit=5&cursor=MQ"))).toEqual({ at: 500, q: "fix", person: 3, kind: 1, from: 10, to: 20, limit: 5, cursor: "MQ" });
    expect(() => commitAskOf(new URLSearchParams("limit=ten"))).toThrow("limit must be a whole number.");
    expect(() => commitAskOf(new URLSearchParams(`cursor=${"x".repeat(41)}`))).toThrow(SiteError);
  });

  test("pages a public Report's commits, kept for good when the address pins the Report", async () => {
    const deps = await stored();
    const pinned = await reportCommitPage(deps, viewer(), "acme", "rocket", { at: 500, q: "fix", limit: 1 });
    expect(pinned.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(pinned.page).toMatchObject({ all: 3, total: 2, link: list.link, rows: [{ sha: "b2", personId: UNKNOWN_PERSON }] });
    const next = await reportCommitPage(deps, viewer(), "acme", "rocket", { q: "fix", limit: 1, cursor: pinned.page?.next ?? undefined });
    expect(next.cacheControl).toBe("public, max-age=300");
    expect(next.page?.rows.map((r) => r.sha)).toEqual(["c3"]);
    expect(next.page?.people).toEqual({ "3": list.people[0]?.person });
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

  test("a Report stored before commits were rows says so until it is built again", async () => {
    const deps = await stored();
    expect(await failure(reportCommitPage(deps, viewer(), "acme", "old", {}))).toEqual([404, COMMITS_UNAVAILABLE]);
  });
});
