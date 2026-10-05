import { afterEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { now, reportPrefix, schema } from "@commitscape/server";
import { fakeGitHub, repoFacts, testDeps, viewer } from "#/test/deps";
import { engineOf } from "./engine";
import { known, lookup, reportHead, requestBuild } from "./repos";
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
  await deps.storage.put(`${key}/index.json`, JSON.stringify({ meta: {}, stats: null, keys: [], cards: [], commits: false }), { type: "application/json" });
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
