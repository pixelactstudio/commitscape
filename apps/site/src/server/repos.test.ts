import { afterEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { now, reportPrefix, schema } from "@commitscape/server";
import { fakeGitHub, repoFacts, testDeps, viewer } from "#/test/deps";
import { engineOf } from "./engine";
import { canSee, known, lookup, reportHead, requestBuild } from "./repos";
import { standingsOf } from "./standings";

const { builds, pullRequests, repoNames, repoPeople, repositories, surviving } = schema;

afterEach(() => vi.unstubAllGlobals());

const facts = (fullName: string) => JSON.stringify({ fullName, description: null, stars: 1, forks: 0, sizeKb: 10, languages: [], contributors: [], releases: [], topics: [] });

async function moved() {
  const deps = await testDeps();
  const key = reportPrefix("facebook/react", "b1");
  await deps.db.insert(repositories).values([
    { id: "facebook/react", owner: "facebook", name: "react", githubId: 10, reportKey: key, reportAt: now() - 60, reportLines: true, factsAt: now() - 600, facts: facts("react/react"), pullsReadAt: now() - 60 },
    { id: "react/react", owner: "react", name: "react", githubId: 10, factsAt: now() - 60, facts: facts("react/react") },
  ]);
  await deps.storage.put(`${key}/index.json`, JSON.stringify({ meta: {}, stats: null, keys: [] }), { type: "application/json" });
  await deps.db.insert(repoPeople).values({ repoId: "facebook/react", reportKey: key, personId: 1, name: "Dan", login: "gaearon", commits: 40, linesAdded: 400, linesRemoved: 40, first: 1, last: 2 });
  await deps.db.insert(surviving).values({ repoId: "facebook/react", reportKey: key, personId: 1, status: "counted", lines: 100, added: 400, askedAt: now() });
  await deps.db.insert(pullRequests).values({ repoId: "facebook/react", number: 7, author: "gaearon", state: "MERGED", title: "Hooks", createdAt: 1, mergedAt: 2, updatedAt: 3, additions: 1, deletions: 1 });
  await deps.db.insert(builds).values({ id: "b1", repoId: "facebook/react", state: "done", requestedAt: now() - 120, finishedAt: now() - 60 });
  return { deps, key };
}

describe("renamed and moved repositories", () => {
  test("two rows of one GitHub repository become one under its current name, with the Report, people, pull requests and Builds", async () => {
    const { deps, key } = await moved();
    const gh = fakeGitHub({});
    vi.stubGlobal("fetch", gh.fetcher);
    const row = await known(deps, "react", "react");
    expect(row).toMatchObject({ id: "react/react", owner: "react", name: "react", githubId: 10, reportKey: key });
    expect(gh.asked).toEqual([]);
    expect((await deps.db.select().from(repositories).where(eq(repositories.githubId, 10))).map((r) => r.id)).toEqual(["react/react"]);
    expect(await deps.db.select({ id: repoNames.id, repoId: repoNames.repoId }).from(repoNames)).toEqual([{ id: "facebook/react", repoId: "react/react" }]);
    expect((await deps.db.select().from(repoPeople)).map((p) => p.repoId)).toEqual(["react/react"]);
    expect((await deps.db.select().from(surviving)).map((p) => p.repoId)).toEqual(["react/react"]);
    expect((await deps.db.select().from(pullRequests)).map((p) => p.repoId)).toEqual(["react/react"]);
    expect((await deps.db.select().from(builds)).map((p) => p.repoId)).toEqual(["react/react"]);
    expect(deps.storage.objects.size).toBe(1);
  });

  test("the old name leads to the current one everywhere, without asking GitHub again", async () => {
    const { deps } = await moved();
    const gh = fakeGitHub({});
    vi.stubGlobal("fetch", gh.fetcher);
    expect(await lookup(deps, viewer(), "facebook", "react")).toMatchObject({ id: "react/react", owner: "react", name: "react", report: { lines: true } });
    expect(await lookup(deps, viewer(), "FaceBook", "React")).toMatchObject({ id: "react/react" });
    expect((await reportHead(deps, viewer(), "facebook", "react")).logins).toEqual([[1, "gaearon"]]);
    const standings = await standingsOf(deps, { ...viewer(), login: async () => null }, "facebook", "react");
    expect(standings.repo).toMatchObject({ owner: "react", name: "react" });
    expect(standings.people.find((p) => p.login === "gaearon")).toMatchObject({ commits: 40, prsMerged: 1, surviving: 100 });
    expect(gh.asked).toEqual([]);
  });

  test("a Profile lists the repository once, under its current name, before and after the rows are made one", async () => {
    const { deps } = await moved();
    const anyone = { ...viewer(), login: async () => null };
    const before = await engineOf(deps, anyone, "gaearon");
    expect(before.repos.map((r) => `${r.owner}/${r.name}`)).toEqual(["react/react"]);
    vi.stubGlobal("fetch", fakeGitHub({}).fetcher);
    await known(deps, "react", "react");
    const after = await engineOf(deps, anyone, "gaearon");
    expect(after.repos.map((r) => [`${r.owner}/${r.name}`, r.commits, r.surviving.lines])).toEqual([["react/react", 40, 100]]);
  });

  test("a repository GitHub answers for under a new name moves there when asked by its old one, and its Builds start there", async () => {
    const deps = await testDeps();
    const key = reportPrefix("acme/rocket", "b1");
    await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, reportKey: key, reportAt: now() - 2 * 86400, factsAt: 0 });
    await deps.storage.put(`${key}/index.json`, "{}", { type: "application/json" });
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/rocket": repoFacts(1, { full_name: "Acme/Missile" }) }).fetcher);
    const started = await requestBuild(deps, viewer(), "acme", "rocket");
    expect(started).toMatchObject({ id: "acme/missile", owner: "Acme", name: "Missile", build: { state: "queued" } });
    expect((await deps.db.select().from(builds)).map((b) => b.repoId)).toEqual(["acme/missile"]);
    expect((await deps.db.select().from(repositories)).map((r) => [r.id, r.reportKey])).toEqual([["acme/missile", key]]);
    expect(deps.storage.objects.size).toBe(1);
  });

  test("an old name that GitHub now gives to another repository leads to that one, and the moved one keeps its Report", async () => {
    const deps = await testDeps();
    await deps.db.insert(repositories).values({ id: "acme/missile", owner: "acme", name: "missile", githubId: 1, reportKey: "r/missile/b1", reportAt: now(), factsAt: now(), facts: facts("acme/missile") });
    await deps.db.insert(repoNames).values({ id: "acme/rocket", repoId: "acme/missile", at: now() - 7200 });
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/rocket": repoFacts(2) }).fetcher);
    const row = await known(deps, "acme", "rocket");
    expect(row).toMatchObject({ id: "acme/rocket", githubId: 2, reportKey: null });
    expect(await deps.db.select().from(repoNames)).toEqual([]);
    expect((await known(deps, "acme", "missile"))?.reportKey).toBe("r/missile/b1");
  });

  test("a name taken by another repository forgets the old one's people and pull requests too", async () => {
    const deps = await testDeps();
    await deps.db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, reportKey: "r/rocket/b1", reportAt: now(), factsAt: 0, pullsReadAt: now() });
    await deps.db.insert(repoPeople).values({ repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 1, name: "Old", login: "old", commits: 3, first: 1, last: 2 });
    await deps.db.insert(pullRequests).values({ repoId: "acme/rocket", number: 1, author: "old", state: "MERGED", title: "x", createdAt: 1, mergedAt: 2, updatedAt: 3, additions: 1, deletions: 1 });
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/rocket": repoFacts(2) }).fetcher);
    expect(await known(deps, "acme", "rocket")).toMatchObject({ githubId: 2, reportKey: null, pullsReadAt: null });
    expect(await deps.db.select().from(repoPeople)).toEqual([]);
    expect(await deps.db.select().from(pullRequests)).toEqual([]);
  });
});

describe("what asking GitHub costs", () => {
  type Seen = { path: string; token: string | null; match: string | null };
  const asking = (reply: (path: string, match: string | null) => Response) => {
    const seen: Seen[] = [];
    const fetcher = (async (input: string | URL | Request, init: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);
      const found = { path: url.pathname, token: headers.get("authorization")?.replace("Bearer ", "") ?? null, match: headers.get("if-none-match") };
      seen.push(found);
      return reply(found.path, found.match);
    }) as unknown as typeof fetch;
    return { seen, fetcher };
  };

  test("a visitor's own token pays for a public repository's facts, and the next visitor's cost nothing", async () => {
    const gh = asking((path) => (path === "/repos/acme/rocket" ? Response.json(repoFacts(1)) : Response.json([])));
    const deps = await testDeps({ github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } });
    expect(await known(deps, "acme", "rocket", "1.1.1.1", async () => "ghu_visitor")).toMatchObject({ status: "ok", githubId: 1 });
    expect(gh.seen.every((s) => s.token === "ghu_visitor")).toBe(true);
    const requests = gh.seen.length;
    await deps.db.update(repositories).set({ factsAt: now() - 7200 });
    await known(deps, "acme", "rocket", "2.2.2.2", async () => "ghu_other");
    await known(deps, "acme", "rocket", "3.3.3.3");
    expect(gh.seen).toHaveLength(requests);
  });

  test("without a visitor's token the Site's is used", async () => {
    const gh = asking(() => Response.json(repoFacts(1)));
    const deps = await testDeps({ github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } });
    await known(deps, "acme", "rocket", "1.1.1.1", async () => null);
    expect(gh.seen.every((s) => s.token === "site")).toBe(true);
  });

  test("a private repository a visitor's token can see is no more than not found for everyone else, and none of its facts are kept", async () => {
    const gh = asking(() => Response.json(repoFacts(5, { full_name: "acme/secret", private: true })));
    const deps = await testDeps({ github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } });
    const row = await known(deps, "acme", "secret", "1.1.1.1", async () => "ghu_member");
    expect(row).toMatchObject({ status: "not_found", isPrivate: false, facts: null });
    expect(await deps.db.select().from(schema.githubCache)).toEqual([]);
  });

  test("whether GitHub shows a repository to someone is revalidated with an ETag, which costs nothing when nothing changed", async () => {
    const gh = asking((_, match) => (match === '"v1"' ? new Response(null, { status: 304 }) : Response.json({ id: 1 }, { headers: { etag: '"v1"' } })));
    const deps = await testDeps();
    await deps.db.insert(schema.user).values({ id: "u1", name: "Alice", email: "alice@example.com" });
    await deps.db.insert(schema.session).values(["session-1", "session-2"].map((id) => ({ id, token: id, userId: "u1", expiresAt: new Date(Date.now() + 3_600_000) })));
    const github = { ...deps, github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    expect(await canSee(github, "session-1", "ghu_alice", "acme", "secret", 1)).toBe(true);
    await deps.db.delete(schema.access);
    expect(await canSee(github, "session-1", "ghu_alice", "acme", "secret", 1)).toBe(true);
    expect(gh.seen.map((s) => s.match)).toEqual([null, '"v1"']);
    await deps.db.delete(schema.access);
    expect(await canSee(github, "session-2", "ghu_bob", "acme", "secret", 2)).toBe(false);
    expect(gh.seen[2]?.match).toBeNull();
  });
});
