import { afterEach, describe, expect, test, vi } from "vitest";
import { now, schema, type SurvivalJob } from "@commitscape/server";
import { fakeGitHub, testDeps, viewer } from "#/test/deps";
import { engineOf } from "./engine";
import { mcpServer } from "./mcp";
import { saveChoices } from "./people";
import { lookupProfile, readProfile } from "./profiles";
import { standingsOf } from "./standings";

const { pullRequests, pullReviews, repoPeople, repositories, session, surviving, user } = schema;

afterEach(() => vi.unstubAllGlobals());

async function seeded() {
  const deps = await testDeps();
  await deps.db.insert(repositories).values([
    { id: "acme/rocket", owner: "acme", name: "rocket", reportKey: "r/rocket/b1", reportAt: 100, factsAt: now(), pullsReadAt: 100 },
    { id: "acme/secret", owner: "acme", name: "secret", githubId: 77, reportKey: "r/secret/b1", reportAt: 100, isPrivate: true, status: "private", installationId: 5, factsAt: now() },
  ]);
  const person = (repoId: string, personId: number, login: string | null, name: string, commits: number) => ({ repoId, reportKey: `r/${repoId.split("/")[1]}/b1`, personId, name, login, commits, linesAdded: commits * 10, linesRemoved: commits, first: 1, last: 2 });
  await deps.db.insert(repoPeople).values([
    person("acme/rocket", 0, "alice", "Alice Example", 30),
    person("acme/rocket", 1, "bob", "Bob Example", 20),
    person("acme/rocket", 2, null, "Dee", 5),
    person("acme/secret", 0, "alice", "Alice Example", 9),
  ]);
  const pr = (number: number, author: string, merged: boolean) => ({ repoId: "acme/rocket", number, author, state: merged ? "MERGED" : "OPEN", title: `PR ${number}`, createdAt: 1, mergedAt: merged ? 2 : null, updatedAt: 3, additions: 1, deletions: 1 });
  await deps.db.insert(pullRequests).values([pr(1, "alice", true), pr(2, "bob", true), pr(3, "bob", true), pr(4, "carol", true), pr(5, "renovate[bot]", true), pr(6, "alice", false)]);
  await deps.db.insert(pullReviews).values([
    { repoId: "acme/rocket", number: 2, reviewer: "alice", reviews: 2, firstAt: 1 },
    { repoId: "acme/rocket", number: 3, reviewer: "alice", reviews: 1, firstAt: 1 },
    { repoId: "acme/rocket", number: 1, reviewer: "bob", reviews: 1, firstAt: 1 },
  ]);
  await deps.db.insert(surviving).values([
    { repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 0, status: "counted", lines: 400, added: 300, askedAt: now() },
    { repoId: "acme/rocket", reportKey: "r/rocket/b1", personId: 1, status: "counted", lines: 500, added: 200, askedAt: now() },
  ]);
  await deps.db.insert(user).values([
    { id: "u-bob", name: "Bob", email: "bob@example.com", login: "bob" },
    { id: "u-alice", name: "Alice", email: "alice@example.com", login: "alice" },
  ]);
  await deps.db.insert(session).values({ id: "s-bob", token: "t-bob", userId: "u-bob", expiresAt: new Date(Date.now() + 3600_000), updatedAt: new Date() });
  return deps;
}

const anyone = { ...viewer(), login: async () => null };
const signedIn = (login: string, sessionId: string, userId: string) => ({ ...viewer({ session: async () => ({ id: sessionId, userId }), token: async () => `ghu_${login}` }), login: async () => login });

describe("Standings", () => {
  test("each view ranks on its own, engine and pull requests joined by login, bots and nobodies left out", async () => {
    const deps = await seeded();
    const s = await standingsOf(deps, anyone, "acme", "rocket");
    const row = (key: string) => s.people.find((r) => r.key === key);
    expect(row("alice")).toMatchObject({ commits: 30, prsMerged: 1, prsOpened: 2, reviews: 2, surviving: 400, survivingStatus: "counted" });
    expect(row("bob")).toMatchObject({ commits: 20, prsMerged: 2, reviews: 1, surviving: 500 });
    expect(row("carol")).toMatchObject({ commits: null, prsMerged: 1, reviews: 0, surviving: null });
    expect(row("#2")).toMatchObject({ name: "Dee", login: null, commits: 5, prsMerged: null });
    expect(s.people.some((r) => r.login?.includes("[bot]"))).toBe(false);
    expect(s.people.map((r) => r.key).slice(0, 2)).toEqual(["bob", "alice"]);
  });

  test("a private repository's Standings are refused to anyone GitHub does not show it to", async () => {
    const deps = await seeded();
    await expect(standingsOf(deps, anyone, "acme", "secret")).rejects.toThrow("No Standings here");
    vi.stubGlobal("fetch", fakeGitHub({}).fetcher);
    await expect(standingsOf(deps, signedIn("bob", "s-bob", "u-bob"), "acme", "secret")).rejects.toThrow("No Standings here");
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/secret": { id: 77, full_name: "acme/secret", private: true } }).fetcher);
    await deps.db.delete(schema.access);
    const seen = await standingsOf(deps, signedIn("bob", "s-bob", "u-bob"), "acme", "secret");
    expect(seen.people.map((r) => r.login)).toEqual(["alice"]);
    vi.stubGlobal("fetch", fakeGitHub({ "/repos/acme/secret": { id: 999, full_name: "acme/secret", private: true } }).fetcher);
    await deps.db.delete(schema.access);
    await expect(standingsOf(deps, signedIn("bob", "s-bob", "u-bob"), "acme", "secret")).rejects.toThrow("No Standings here");
  });

  test("a count over budget is asked again half an hour on", async () => {
    const deps = await seeded();
    const counted: SurvivalJob[] = [];
    deps.queue = async () => ({ send: async () => {}, count: async (job) => void counted.push(job) });
    await deps.db.update(surviving).set({ status: "over_budget", lines: null, askedAt: now() - 60 });
    const fresh = await standingsOf(deps, anyone, "acme", "rocket");
    expect(fresh.people.find((r) => r.key === "alice")?.survivingStatus).toBe("over_budget");
    expect(counted.flatMap((j) => j.personIds)).toEqual([2]);
    await deps.db.update(surviving).set({ askedAt: now() - 3600 });
    const again = await standingsOf(deps, anyone, "acme", "rocket");
    expect(again.people.find((r) => r.key === "alice")?.survivingStatus).toBe("counting");
    expect(counted.at(-1)?.personIds.sort()).toEqual([0, 1, 2]);
  });

  test("a repository not read yet has no Standings", async () => {
    const deps = await seeded();
    await expect(standingsOf(deps, anyone, "acme", "nothing")).rejects.toThrow("No Standings here");
  });
});

describe("a hidden person", () => {
  test("is absent from everyone else's Standings, Profile, engine numbers and MCP, and still sees their own", async () => {
    const deps = await seeded();
    await saveChoices(deps, "u-alice", "Alice", { hidden: true });
    const others = await standingsOf(deps, anyone, "acme", "rocket");
    expect(others.people.some((r) => r.login === "alice")).toBe(false);
    expect(others.hidden).toBe(1);
    const own = await standingsOf(deps, signedIn("alice", "s-x", "u-alice"), "acme", "rocket");
    expect(own.people.find((r) => r.login === "alice")?.you).toBe(true);
    expect(await lookupProfile(deps, anyone, "alice")).toMatchObject({ status: "hidden" });
    await expect(readProfile(deps, anyone, "alice")).rejects.toThrow("hidden");
    expect((await engineOf(deps, anyone, "alice")).repos).toEqual([]);
    const call = await (mcpServer(deps, anyone) as unknown as { _registeredTools: Record<string, { handler: (a: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }> }> })._registeredTools.read_profile?.handler({ login: "alice" });
    expect(call?.isError).toBe(true);
    expect(call?.content[0]?.text).toContain("hidden");
    const standings = await (mcpServer(deps, anyone) as unknown as { _registeredTools: Record<string, { handler: (a: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools.read_standings?.handler({ owner: "acme", repo: "rocket" });
    expect(standings?.content[0]?.text).not.toContain('"alice"');
    await saveChoices(deps, "u-alice", "alice", { hidden: false });
    expect((await standingsOf(deps, anyone, "acme", "rocket")).people.some((r) => r.login === "alice")).toBe(true);
  });
});
