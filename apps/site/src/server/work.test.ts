import { describe, expect, test } from "vitest";
import { schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { checkAsk, commitRequests, prRequests, repeats, sharedWork, shareWork, SITE_BUDGET, unshareWork, windowsOf, WorkGateError, workOf } from "./work";

type FakePr = { number: number; repo: string; private: boolean; mergedAt: string };
type FakeCommit = { sha: string; repo: string; private: boolean; message: string; date: string };

const day = (start: string, n: number) => new Date(Date.parse(start) + n * 86_400_000).toISOString().slice(0, 10);

function github(prs: FakePr[], commits: FakeCommit[], { unlisted = [], viewer = "alice" }: { unlisted?: string[]; viewer?: string } = {}) {
  const asked: { kind: "first" | "repositories" | "prs" | "history" | "private"; q?: string; repos?: string[] }[] = [];
  const page = <T,>(list: T[], after: string | null, cap = Infinity) => {
    const start = Number(after ?? 0);
    const end = Math.min(start + 100, list.length, cap);
    return { nodes: list.slice(start, end), pageInfo: { hasNextPage: end < Math.min(list.length, cap), endCursor: String(end) } };
  };
  const search = (q: string, after: string | null) => {
    const [, from = "", to = ""] = /merged:(\S+)\.\.(\S+)/.exec(q) ?? [];
    const repo = /repo:(\S+)/.exec(q)?.[1];
    const org = /org:(\S+)/.exec(q)?.[1];
    const found = prs.filter((p) => p.mergedAt.slice(0, 10) >= from && p.mergedAt.slice(0, 10) <= to && (!repo || p.repo === repo) && (!org || p.repo.startsWith(`${org}/`)));
    const { nodes, pageInfo } = page(found, after, 1000);
    return { issueCount: found.length, pageInfo, nodes: [...nodes.map((p) => ({ number: p.number, title: `PR ${p.number}`, url: `https://github.com/${p.repo}/pull/${p.number}`, mergedAt: p.mergedAt, additions: 10, deletions: 1, repository: { nameWithOwner: p.repo, isPrivate: p.private } })), {}] };
  };
  const contributions = (from: string, to: string) => {
    const counts = new Map<string, { repository: { nameWithOwner: string; isPrivate: boolean }; contributions: { totalCount: number } }>();
    for (const c of commits.filter((c) => c.date >= from.slice(0, 10) && c.date <= to.slice(0, 10) && !unlisted.includes(c.repo))) {
      const had = counts.get(c.repo) ?? { repository: { nameWithOwner: c.repo, isPrivate: c.private }, contributions: { totalCount: 0 } };
      had.contributions.totalCount++;
      counts.set(c.repo, had);
    }
    const list = [...counts.values()].sort((a, b) => b.contributions.totalCount - a.contributions.totalCount).slice(0, 100);
    return { id: "U_alice", contributionsCollection: { commitContributionsByRepository: list } };
  };
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const { query, variables: v } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string | null> };
    if (query.includes("viewer {")) {
      asked.push({ kind: "private" });
      const nodes = [...new Set(commits.filter((c) => c.private).map((c) => c.repo))].map((nameWithOwner) => ({ nameWithOwner, pushedAt: "2026-09-20T00:00:00Z" }));
      return Response.json({ data: { viewer: { login: viewer, repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [...nodes, { nameWithOwner: "alice/old", pushedAt: "2020-01-01T00:00:00Z" }] } } } });
    }
    if (query.includes("contributionsCollection")) {
      const user = contributions(String(v.from), String(v.to));
      if (query.includes("search(")) {
        asked.push({ kind: "first", q: String(v.q) });
        return Response.json({ data: { user, search: search(String(v.q), null) } });
      }
      asked.push({ kind: "repositories" });
      return Response.json({ data: { user } });
    }
    if (query.includes("search(")) {
      asked.push({ kind: "prs", q: String(v.q) });
      return Response.json({ data: { search: search(String(v.q), v.after ?? null) } });
    }
    const data: Record<string, unknown> = {};
    const repos: string[] = [];
    for (let i = 0; `o${i}` in v; i++) {
      const repo = `${v[`o${i}`]}/${v[`n${i}`]}`;
      repos.push(repo);
      const list = commits.filter((c) => c.repo === repo && `${c.date}T12:00:00Z` >= String(v[`s${i}`]) && `${c.date}T12:00:00Z` <= String(v[`u${i}`]));
      const { nodes, pageInfo } = page(list, v[`a${i}`] ?? null);
      data[`r${i}`] = { defaultBranchRef: { target: { history: { pageInfo, nodes: nodes.map((c) => ({ oid: c.sha, messageHeadline: c.message.split("\n")[0], authoredDate: `${c.date}T12:00:00Z`, url: `https://github.com/${c.repo}/commit/${c.sha}`, additions: 3, deletions: 2 })) } } } };
    }
    asked.push({ kind: "history", repos });
    return Response.json({ data });
  }) as unknown as typeof fetch;
  const count = (kind: string) => asked.filter((a) => a.kind === kind).length;
  return { asked, fetcher, count };
}

const deps = async (fetcher: typeof fetch) => ({ db: await testDb(), github: { api: "http://github.test", token: "site", fetcher } });
const anyone = { login: async () => null, token: async () => null };
const signedIn = { login: async () => "bob", token: async () => "ghu_bob" };
const alice = { login: async () => "Alice", token: async () => "ghu_alice" };

const small = () =>
  github(
    [
      { number: 1, repo: "acme/rocket", private: false, mergedAt: "2026-09-02T00:00:00Z" },
      { number: 2, repo: "acme/rocket", private: false, mergedAt: "2026-09-03T00:00:00Z" },
      { number: 7, repo: "acme/secret", private: true, mergedAt: "2026-09-09T00:00:00Z" },
      { number: 9, repo: "other/thing", private: false, mergedAt: "2026-09-10T00:00:00Z" },
    ],
    [
      { sha: "a1", repo: "acme/rocket", private: false, message: "Add thrust (#2)", date: "2026-09-03" },
      { sha: "b2", repo: "acme/rocket", private: false, message: "Fix the fins\n\nLonger text", date: "2026-09-04" },
      { sha: "c3", repo: "acme/secret", private: true, message: "Secret sauce", date: "2026-09-05" },
      { sha: "d4", repo: "acme/rocket", private: false, message: "Merge pull request #1 from alice/x", date: "2026-09-06" },
      { sha: "e5", repo: "other/thing", private: false, message: "Elsewhere", date: "2026-09-07" },
    ],
  );

describe("Proof of Work", () => {
  test("a period's merged pull requests and commits, private work only for the person, and no commit counted twice", async () => {
    const gh = small();
    const d = await deps(gh.fetcher);
    const seen = await workOf(d, anyone, "alice", { from: "2026-09-01", to: "2026-09-30" });
    expect(seen.scope).toBe("public");
    expect(seen.items.map((i) => `${i.kind}:${i.repo}:${i.number ?? i.title}`)).toEqual(["pr:other/thing:9", "pr:acme/rocket:2", "pr:acme/rocket:1", "commit:acme/rocket:Fix the fins", "commit:other/thing:Elsewhere"]);
    expect(seen.items.find((i) => i.kind === "commit")).toMatchObject({ additions: 3, deletions: 2, sha: "b2" });
    expect(JSON.stringify(seen)).not.toContain("secret");
    expect(gh.asked.filter((a) => a.kind === "history").flatMap((a) => a.repos)).not.toContain("acme/secret");
    expect(seen.capped).toEqual({ prDays: [], repositoryDays: [] });
    const own = await workOf(d, alice, "alice", { from: "2026-09-01", to: "2026-09-30" });
    expect(own.scope).toBe("self");
    expect(own.items.filter((i) => i.private).map((i) => i.number ?? i.title)).toEqual([7, "Secret sauce"]);
  });

  test("the person's own private repositories are read even when GitHub leaves them out of the contributions it lists", async () => {
    const make = (viewer: string) => github([], [{ sha: "p1", repo: "alice/hidden", private: true, message: "Private work", date: "2026-09-12" }, { sha: "o1", repo: "acme/rocket", private: false, message: "Open work", date: "2026-09-13" }], { unlisted: ["alice/hidden"], viewer });
    const gh = make("alice");
    const own = await workOf(await deps(gh.fetcher), alice, "alice", { from: "2026-09-04", to: "2026-09-30" });
    expect(own.items.map((i) => i.title)).toEqual(["Open work", "Private work"]);
    expect(gh.asked.filter((a) => a.kind === "history").flatMap((a) => a.repos)).not.toContain("alice/old");
    const other = make("alice");
    const seen = await workOf(await deps(other.fetcher), anyone, "alice", { from: "2026-09-04", to: "2026-09-30" });
    expect(seen.items.map((i) => i.title)).toEqual(["Open work"]);
    expect(other.count("private")).toBe(0);
    const wrong = make("mallory");
    const mixed = await workOf(await deps(wrong.fetcher), alice, "alice", { from: "2026-09-02", to: "2026-09-30" });
    expect(mixed.items.map((i) => i.title)).toEqual(["Open work"]);
  });

  test("a filter narrows pull requests by the search qualifier and commits by the repositories read", async () => {
    const gh = small();
    const d = await deps(gh.fetcher);
    const rocket = await workOf(d, anyone, "alice", { from: "2026-09-01", to: "2026-09-29", filter: "acme/rocket" });
    expect(gh.asked[0]?.q).toBe("author:alice is:pr is:merged merged:2026-09-01..2026-09-29 repo:acme/rocket");
    expect(gh.asked.filter((a) => a.kind === "history").flatMap((a) => a.repos)).toEqual(["acme/rocket"]);
    expect(new Set(rocket.items.map((i) => i.repo))).toEqual(new Set(["acme/rocket"]));
    const acme = await workOf(d, anyone, "alice", { from: "2026-09-01", to: "2026-09-28", filter: "acme" });
    expect(gh.asked.at(-2)?.q).toContain(" org:acme");
    expect(acme.items.map((i) => i.number ?? i.title)).toEqual([2, 1, "Fix the fins"]);
    const before = gh.asked.length;
    await workOf(d, anyone, "alice", { from: "2026-09-01", to: "2026-09-27" });
    const derived = await workOf(d, anyone, "alice", { from: "2026-09-01", to: "2026-09-27", filter: "other" });
    expect(derived.items.map((i) => i.number ?? i.title)).toEqual([9, "Elsewhere"]);
    expect(gh.asked.length - before).toBe(2);
  });

  test("every commit in many repositories, a busy one read in stretches, page after page", async () => {
    const commits: FakeCommit[] = [];
    for (let r = 0; r < 25; r++) for (let n = 0; n < 3 + r; n++) commits.push({ sha: `r${r}c${n}`, repo: `acme/repo-${r}`, private: false, message: `Change ${n}`, date: day("2025-01-01", (n * 7) % 365) });
    for (let n = 0; n < 730; n++) commits.push({ sha: `big${n}`, repo: "acme/big", private: false, message: `Big ${n}`, date: day("2025-01-01", Math.floor(n / 2)) });
    const gh = github([], commits);
    const work = await workOf(await deps(gh.fetcher), signedIn, "carol", { from: "2025-01-01", to: "2025-12-31" });
    expect(work.items).toHaveLength(commits.length);
    expect(new Set(work.items.map((i) => i.sha)).size).toBe(commits.length);
    const places = [{ repo: "acme/big", private: false, commits: 730 }, ...Array.from({ length: 25 }, (_, r) => ({ repo: `acme/repo-${r}`, private: false, commits: 3 + r }))];
    expect(windowsOf(places[0] as (typeof places)[0], "2025-01-01", "2025-12-31")).toHaveLength(4);
    expect(gh.count("history")).toBe(commitRequests(places, "2025-01-01", "2025-12-31"));
    expect(gh.asked.filter((a) => a.kind === "history").every((a) => (a.repos?.length ?? 0) <= 10)).toBe(true);
  });

  test("more than 100 repositories in a period are found by splitting the period, and an anonymous read that grows too big stops early", async () => {
    const commits: FakeCommit[] = Array.from({ length: 130 }, (_, r) => ({ sha: `s${r}`, repo: `acme/r${r}`, private: false, message: `Work ${r}`, date: day("2025-01-01", r * 2) }));
    const gh = github([], commits);
    const work = await workOf(await deps(gh.fetcher), signedIn, "gina", { from: "2025-01-01", to: "2025-12-31" });
    expect(work.items).toHaveLength(130);
    expect(work.capped.repositoryDays).toEqual([]);
    expect(gh.count("repositories")).toBe(2);
    const many: FakeCommit[] = Array.from({ length: 900 }, (_, r) => ({ sha: `m${r}`, repo: `acme/m${r}`, private: false, message: `Work ${r}`, date: day("2025-01-01", r % 365) }));
    const big = github([], many);
    const refused = await workOf(await deps(big.fetcher), anyone, "hana", { from: "2025-01-01", to: "2025-12-31" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(WorkGateError);
    expect((refused as WorkGateError).gate.atLeast).toBe(true);
    expect(big.count("history")).toBe(0);
  });

  test("a range with more than 1,000 merged pull requests is split in halves until each part is whole", async () => {
    const prs: FakePr[] = Array.from({ length: 2500 }, (_, n) => ({ number: n + 1, repo: "acme/rocket", private: false, mergedAt: `${day("2025-01-01", n % 365)}T10:00:00Z` }));
    const gh = github(prs, []);
    const work = await workOf(await deps(gh.fetcher), signedIn, "dave", { from: "2025-01-01", to: "2025-12-31" });
    expect(work.items).toHaveLength(2500);
    expect(new Set(work.items.map((i) => i.number)).size).toBe(2500);
    expect(work.capped.prDays).toEqual([]);
    expect(gh.asked.filter((a) => a.kind === "prs").map((a) => /merged:(\S+)/.exec(a.q ?? "")?.[1])).toContain("2025-01-01..2025-04-02");
  });

  test("only a single day with more than 1,000 merged pull requests stays capped, and says so", async () => {
    const prs: FakePr[] = [...Array.from({ length: 1200 }, (_, n) => ({ number: n + 1, repo: "acme/bot", private: false, mergedAt: "2025-03-03T10:00:00Z" })), { number: 5000, repo: "acme/bot", private: false, mergedAt: "2025-03-04T10:00:00Z" }];
    const gh = github(prs, []);
    const work = await workOf(await deps(gh.fetcher), signedIn, "erin", { from: "2025-03-01", to: "2025-03-07" });
    expect(work.capped.prDays).toEqual(["2025-03-03"]);
    expect(work.items).toHaveLength(1001);
  });

  test("a read too big for the Site's allowance is refused before reading, unless the visitor reads with their own token", async () => {
    const prs: FakePr[] = Array.from({ length: 4200 }, (_, n) => ({ number: n + 1, repo: "acme/rocket", private: false, mergedAt: `${day("2025-01-01", n % 365)}T10:00:00Z` }));
    const gh = github(prs, [{ sha: "x", repo: "acme/rocket", private: false, message: "One", date: "2025-05-05" }]);
    const d = await deps(gh.fetcher);
    const refused = await workOf(d, anyone, "frank", { from: "2025-01-01", to: "2025-12-31" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(WorkGateError);
    const gate = (refused as WorkGateError).gate;
    expect(gate).toMatchObject({ gate: "sign_in_for_work", prs: 4200, commits: 1, budget: SITE_BUDGET, atLeast: false, signedIn: false, repositories: [{ repo: "acme/rocket", private: false, commits: 1 }] });
    expect(gate.requests).toBe(1 + prRequests(4200) + 1);
    expect(gate.requests).toBeGreaterThan(SITE_BUDGET);
    expect((refused as WorkGateError).status).toBe(401);
    expect(gh.asked.map((a) => a.kind)).toEqual(["first"]);
    await expect(workOf(d, anyone, "frank", { from: "2025-01-01", to: "2025-12-31" })).rejects.toBeInstanceOf(WorkGateError);
    expect(gh.asked).toHaveLength(1);
    const stale = await workOf(d, { login: async () => "bob", token: async () => null }, "frank", { from: "2025-01-01", to: "2025-12-31" }).catch((e: unknown) => e);
    expect((stale as WorkGateError).gate.signedIn).toBe(true);
    const read = await workOf(d, signedIn, "frank", { from: "2025-01-01", to: "2025-12-31" });
    expect(read.items).toHaveLength(4201);
    expect(gh.count("prs") + 1).toBeLessThanOrEqual(gate.requests);
  });

  test("the cost of a read, estimated from the counts", () => {
    expect(prRequests(0)).toBe(0);
    expect(prRequests(100)).toBe(0);
    expect(prRequests(523)).toBe(5);
    expect(prRequests(2500)).toBe(2 + 4 * 7);
    expect(commitRequests([], "2025-01-01", "2025-12-31")).toBe(0);
    expect(commitRequests(Array.from({ length: 43 }, (_, i) => ({ repo: `a/${i}`, private: false, commits: i === 0 ? 150 : 7 })), "2025-01-01", "2025-12-31")).toBe(6);
  });

  test("a shared link holds the public work and only the private repositories chosen, and its person can delete it", async () => {
    const gh = small();
    const db = await testDb();
    await db.insert(schema.user).values({ id: "u-alice", name: "Alice", email: "a@example.com", login: "alice" });
    const d = { db, github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    const own = await workOf(d, alice, "alice", { from: "2026-09-01", to: "2026-09-29" });
    const plain = await sharedWork(db, await shareWork(db, "u-alice", own, []));
    expect(plain.items.some((i) => i.private)).toBe(false);
    expect(plain.scope).toBe("public");
    const chosen = await sharedWork(db, await shareWork(db, "u-alice", own, ["ACME/secret"]));
    expect(chosen.items.filter((i) => i.private)).toHaveLength(2);
    const publicView = await workOf(d, anyone, "alice", { from: "2026-09-01", to: "2026-09-28" });
    await expect(shareWork(db, "u-alice", publicView, ["acme/secret"])).rejects.toThrow("Only the person themselves");
    await expect(unshareWork(db, "u-bob", chosen.shared ?? "")).rejects.toThrow("no shared Proof of Work of yours");
    await unshareWork(db, "u-alice", chosen.shared ?? "");
    await expect(sharedWork(db, chosen.shared ?? "")).rejects.toThrow("no shared Proof of Work here");
  });

  test("its period and filter are checked", () => {
    expect(() => checkAsk({ from: "2026-9-1", to: "2026-09-30" })).toThrow("YYYY-MM-DD");
    expect(() => checkAsk({ from: "2026-09-30", to: "2026-09-01" })).toThrow("ends before it starts");
    expect(() => checkAsk({ from: "2024-01-01", to: "2026-01-01" })).toThrow("a year at most");
    expect(() => checkAsk({ from: "2025-03-01", to: "2026-03-02" })).toThrow("a year at most");
    expect(checkAsk({ from: "2024-01-01", to: "2024-12-31" }).to).toBe("2024-12-31");
    expect(() => checkAsk({ from: "2026-09-01", to: "2026-09-30", filter: "acme rocket" })).toThrow("organisation");
    expect(checkAsk({ from: "2026-09-01", to: "2026-09-30", filter: " acme/rocket " })).toEqual({ from: "2026-09-01", to: "2026-09-30", filter: "acme/rocket" });
  });

  test("a squash merge or GitHub's merge commit repeats its pull request; other commits do not", () => {
    const item = (kind: "pr" | "commit", repo: string, title: string, number: number | null = null) => ({ kind, repo, private: false, title, url: "", at: "", number, sha: null, additions: null, deletions: null });
    const prs = [item("pr", "a/b", "x", 5)];
    expect(repeats(prs, item("commit", "a/b", "Do it (#5)"))).toBe(true);
    expect(repeats(prs, item("commit", "a/b", "Merge pull request #5 from a/branch"))).toBe(true);
    expect(repeats(prs, item("commit", "a/c", "Do it (#5)"))).toBe(false);
    expect(repeats(prs, item("commit", "a/b", "Do it (#6)"))).toBe(false);
    expect(repeats(prs, item("commit", "a/b", "Mention (#5) in the middle"))).toBe(false);
  });
});
