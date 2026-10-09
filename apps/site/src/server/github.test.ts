import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { forgetGitHubLimits, now, schema, type Db } from "@commitscape/server";
import { testDb, repoFacts } from "#/test/deps";
import { askGitHub } from "./github";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

function github(routes: Record<string, Reply | ((token: string | null) => Reply)>) {
  const asked: { path: string; token: string | null }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit) => {
    const url = new URL(String(input));
    const token = new Headers(init.headers).get("authorization")?.replace("Bearer ", "") ?? null;
    asked.push({ path: url.pathname + url.search, token });
    const route = routes[url.pathname + url.search] ?? routes[url.pathname];
    const reply = typeof route === "function" ? route(token) : route;
    if (!reply) return new Response("{}", { status: 404 });
    return new Response(reply.status === 304 ? null : JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
  }) as unknown as typeof fetch;
  return { asked, fetcher };
}

const rocket = {
  "/repos/acme/rocket": { body: repoFacts(1), headers: { etag: '"r"' } },
  "/repos/acme/rocket/languages": { body: { Rust: 900, Shell: 100 } },
  "/repos/acme/rocket/contributors?per_page=12": { body: [{ login: "alice", avatar_url: "https://a/alice", contributions: 40 }] },
  "/repos/acme/rocket/releases?per_page=5": { body: [{ name: "One", tag_name: "v1", published_at: "2026-01-01T00:00:00Z" }] },
};

let shared: Db;

beforeAll(async () => {
  shared = await testDb();
});

const deps = async (fetcher: typeof fetch, token = "site") => {
  await shared.delete(schema.githubCache);
  return { db: shared, github: { api: "http://github.test", token, fetcher } };
};

beforeEach(() => {
  forgetGitHubLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("askGitHub", () => {
  test("a repository costs four requests once, and none while its facts are fresh", async () => {
    const gh = github(rocket);
    const d = await deps(gh.fetcher);
    const first = await askGitHub(d, "acme", "rocket");
    expect(first).toMatchObject({ status: "ok", githubId: 1, facts: { stars: 10, languages: [{ name: "Rust", bytes: 900 }, { name: "Shell", bytes: 100 }], contributors: [{ login: "alice", contributions: 40 }], releases: [{ tag: "v1" }] } });
    expect(gh.asked).toHaveLength(4);
    expect(gh.asked.every((a) => a.token === "site")).toBe(true);
    expect(await askGitHub(d, "acme", "rocket")).toEqual(first);
    expect(gh.asked).toHaveLength(4);
  });

  test("when the facts have gone stale GitHub is asked with the stored ETags, and a 304 renews them", async () => {
    const calls: Record<string, number> = {};
    const gh = github({
      ...rocket,
      "/repos/acme/rocket": () => {
        calls.repo = (calls.repo ?? 0) + 1;
        return calls.repo === 1 ? { body: repoFacts(1), headers: { etag: '"r"' } } : { status: 304 };
      },
    });
    const d = await deps(gh.fetcher);
    await askGitHub(d, "acme", "rocket");
    await d.db.update(schema.githubCache).set({ until: now() - 1 });
    const again = await askGitHub(d, "acme", "rocket");
    expect(again).toMatchObject({ status: "ok", facts: { stars: 10 } });
    expect(calls.repo).toBe(2);
  });

  test("a visitor's own token is spent first, and the Site's only when GitHub refuses it", async () => {
    const gh = github({ ...rocket, "/repos/acme/rocket": (token) => (token === "ghu_expired" ? { status: 401, body: { message: "Bad credentials" } } : { body: repoFacts(1) }) });
    const d = await deps(gh.fetcher);
    expect(await askGitHub(d, "acme", "rocket", { token: "ghu_expired" })).toMatchObject({ status: "ok" });
    expect(gh.asked.map((a) => a.token)).toEqual(["ghu_expired", "site", "site", "site", "site"]);
    const fresh = github(rocket);
    const e = await deps(fresh.fetcher);
    await askGitHub(e, "acme", "rocket", { token: "ghu_alice" });
    expect(fresh.asked.every((a) => a.token === "ghu_alice")).toBe(true);
  });

  test("a private repository seen only through a visitor's token is not found for everyone else, and kept nowhere", async () => {
    const gh = github({ "/repos/acme/secret": { body: repoFacts(5, { full_name: "acme/secret", private: true }) } });
    const d = await deps(gh.fetcher);
    expect(await askGitHub(d, "acme", "secret", { token: "ghu_member" })).toEqual({ status: "not_found" });
    expect(gh.asked).toHaveLength(1);
    expect(await d.db.select().from(schema.githubCache)).toEqual([]);
  });

  test("a private repository the Site's own token sees is reported private, and kept nowhere", async () => {
    const gh = github({ "/repos/acme/secret": { body: repoFacts(5, { full_name: "acme/secret", private: true }) } });
    const d = await deps(gh.fetcher);
    expect(await askGitHub(d, "acme", "secret")).toEqual({ status: "private" });
    expect(await d.db.select().from(schema.githubCache)).toEqual([]);
  });

  test("with a person's scope a private repository is read and kept for that person only", async () => {
    const secret = {
      "/repos/acme/secret": (token: string | null) => (token === "ghu_member" ? { body: repoFacts(5, { full_name: "acme/secret", private: true }) } : { status: 404 }),
    };
    const gh = github(secret);
    const d = await deps(gh.fetcher);
    expect(await askGitHub(d, "acme", "secret", { token: "ghu_member", scope: "user:member" })).toMatchObject({ status: "ok", githubId: 5 });
    const requests = gh.asked.length;
    expect(await askGitHub(d, "acme", "secret", { token: "ghu_member", scope: "user:member" })).toMatchObject({ status: "ok" });
    expect(gh.asked).toHaveLength(requests);
    expect(await askGitHub(d, "acme", "secret", { token: "ghu_stranger", scope: "user:stranger" })).toEqual({ status: "not_found" });
    expect(await askGitHub(d, "acme", "secret", { token: "ghu_stranger" })).toEqual({ status: "not_found" });
  });

  test("a missing repository is not_found, and is not asked about again straight away", async () => {
    const gh = github({});
    const d = await deps(gh.fetcher);
    expect(await askGitHub(d, "acme", "nothing")).toEqual({ status: "not_found" });
    expect(await askGitHub(d, "acme", "nothing")).toEqual({ status: "not_found" });
    expect(gh.asked).toHaveLength(1);
  });

  test("a contributors list GitHub refuses is left empty and is not asked for again", async () => {
    const gh = github({ ...rocket, "/repos/acme/rocket/contributors?per_page=12": { status: 403, body: { message: "The history or contributor list is too large" } } });
    const d = await deps(gh.fetcher);
    expect(await askGitHub(d, "acme", "rocket")).toMatchObject({ status: "ok", facts: { contributors: [] } });
    await askGitHub(d, "acme", "rocket");
    expect(gh.asked.filter((a) => a.path.includes("contributors"))).toHaveLength(1);
  });

  test("when the Site's token is out of requests the stale facts are served instead of an error", async () => {
    let limited = false;
    const gh = github({ ...rocket, "/repos/acme/rocket": () => (limited ? { status: 403, body: { message: "API rate limit exceeded" }, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-limit": "5000", "x-ratelimit-reset": String(now() + 3000) } } : { body: repoFacts(1) }) });
    const d = await deps(gh.fetcher);
    const first = await askGitHub(d, "acme", "rocket");
    await d.db.update(schema.githubCache).set({ until: now() - 1 });
    limited = true;
    expect(await askGitHub(d, "acme", "rocket")).toEqual(first);
    await expect(askGitHub(d, "acme", "other")).rejects.toThrow("GitHub answered");
  });
});
