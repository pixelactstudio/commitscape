import { describe, expect, test } from "vitest";
import { schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { checkAsk, monthsOf, repeats, sharedWork, shareWork, unshareWork, workOf } from "./work";

const pr = (number: number, repo: string, isPrivate: boolean, mergedAt: string) => ({ number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, mergedAt, additions: 10 * number, deletions: number, repository: { nameWithOwner: repo, isPrivate } });
const commit = (sha: string, repo: string, isPrivate: boolean, message: string, date: string) => ({ sha: sha.repeat(40).slice(0, 40), html_url: `https://github.com/${repo}/commit/${sha}`, commit: { message, author: { date } }, repository: { full_name: repo, private: isPrivate } });

function github() {
  const asked: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.includes("/search/commits")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      asked.push(`commits:${q}`);
      return Response.json({
        total_count: 4,
        items: [
          commit("a", "acme/rocket", false, "Add thrust (#2)", "2026-09-03T10:00:00Z"),
          commit("b", "acme/rocket", false, "Fix the fins\n\nLonger text", "2026-09-04T10:00:00Z"),
          commit("c", "acme/secret", true, "Secret sauce", "2026-09-05T10:00:00Z"),
          commit("d", "acme/rocket", false, "Merge pull request #1 from alice/x", "2026-09-06T10:00:00Z"),
        ],
      });
    }
    const body = JSON.parse(String(init?.body)) as { variables: { q: string } };
    asked.push(`prs:${body.variables.q}`);
    return Response.json({ data: { search: { issueCount: 3, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [pr(1, "acme/rocket", false, "2026-09-02T00:00:00Z"), pr(2, "acme/rocket", false, "2026-09-03T00:00:00Z"), pr(7, "acme/secret", true, "2026-09-09T00:00:00Z"), {}] } } });
  }) as unknown as typeof fetch;
  return { asked, fetcher };
}

const anyone = { login: async () => null, token: async () => null };
const alice = { login: async () => "Alice", token: async () => "ghu_alice" };

describe("Proof of Work", () => {
  test("a period's merged pull requests and commits, private work only for the person, and no commit counted twice", async () => {
    const gh = github();
    const deps = { db: await testDb(), github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    const seen = await workOf(deps, anyone, "alice", { from: "2026-09-01", to: "2026-09-30", filter: "acme" });
    expect(gh.asked).toEqual(["prs:author:alice is:pr is:merged merged:2026-09-01..2026-09-30 org:acme", "commits:author:alice author-date:2026-09-01..2026-09-30 org:acme"]);
    expect(seen.scope).toBe("public");
    expect(seen.items.map((i) => `${i.kind}:${i.repo}:${i.number ?? i.title}`)).toEqual(["pr:acme/rocket:1", "pr:acme/rocket:2", "commit:acme/rocket:Fix the fins"]);
    expect(JSON.stringify(seen)).not.toContain("secret");
    const own = await workOf(deps, alice, "alice", { from: "2026-09-01", to: "2026-09-30", filter: "acme" });
    expect(own.scope).toBe("self");
    expect(own.items.filter((i) => i.private).map((i) => i.number ?? i.title)).toEqual([7, "Secret sauce"]);
  });

  test("a shared link holds the public work and only the private repositories chosen, and its person can delete it", async () => {
    const gh = github();
    const db = await testDb();
    await db.insert(schema.user).values({ id: "u-alice", name: "Alice", email: "a@example.com", login: "alice" });
    const deps = { db, github: { api: "http://github.test", token: "site", fetcher: gh.fetcher } };
    const own = await workOf(deps, alice, "alice", { from: "2026-09-01", to: "2026-09-29" });
    const plain = await sharedWork(db, await shareWork(db, "u-alice", own, []));
    expect(plain.items.some((i) => i.private)).toBe(false);
    expect(plain.scope).toBe("public");
    const chosen = await sharedWork(db, await shareWork(db, "u-alice", own, ["ACME/secret"]));
    expect(chosen.items.filter((i) => i.private)).toHaveLength(2);
    const publicView = await workOf(deps, anyone, "alice", { from: "2026-09-01", to: "2026-09-28" });
    await expect(shareWork(db, "u-alice", publicView, ["acme/secret"])).rejects.toThrow("Only the person themselves");
    await expect(unshareWork(db, "u-bob", chosen.shared ?? "")).rejects.toThrow("no shared Proof of Work of yours");
    await unshareWork(db, "u-alice", chosen.shared ?? "");
    await expect(sharedWork(db, chosen.shared ?? "")).rejects.toThrow("no shared Proof of Work here");
  });

  test("its period and filter are checked", () => {
    expect(() => checkAsk({ from: "2026-9-1", to: "2026-09-30" })).toThrow("YYYY-MM-DD");
    expect(() => checkAsk({ from: "2026-09-30", to: "2026-09-01" })).toThrow("ends before it starts");
    expect(() => checkAsk({ from: "2024-01-01", to: "2026-01-01" })).toThrow("a year at most");
    expect(() => checkAsk({ from: "2026-09-01", to: "2026-09-30", filter: "acme rocket" })).toThrow("organisation");
    expect(checkAsk({ from: "2026-09-01", to: "2026-09-30", filter: " acme/rocket " })).toEqual({ from: "2026-09-01", to: "2026-09-30", filter: "acme/rocket" });
  });

  test("a long period is read month by month, each month clipped to the period", () => {
    expect(monthsOf("2026-09-05", "2026-09-20")).toEqual([["2026-09-05", "2026-09-20"]]);
    expect(monthsOf("2025-11-15", "2026-02-10")).toEqual([
      ["2025-11-15", "2025-11-30"],
      ["2025-12-01", "2025-12-31"],
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-10"],
    ]);
    expect(monthsOf("2025-01-01", "2025-12-31")).toHaveLength(12);
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
