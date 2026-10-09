import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { cachedGet, forgetGitHubLimits, githubGraphql, githubLimits, pruneGitHubCache } from "./github-cache";
import { now } from "./time";

const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

let shared: Db;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  shared = db as unknown as Db;
});

async function testDb(): Promise<Db> {
  await shared.delete(schema.githubCache);
  return shared;
}

type Step = { status?: number; body?: unknown; headers?: Record<string, string>; fail?: boolean };

function github(steps: Step[]) {
  const sent: { url: string; headers: Record<string, string>; body?: string }[] = [];
  let at = 0;
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined });
    const step = steps[Math.min(at++, steps.length - 1)] ?? {};
    if (step.fail) throw new Error("unreachable");
    const status = step.status ?? 200;
    const body = step.body === undefined ? null : typeof step.body === "string" ? step.body : JSON.stringify(step.body);
    return new Response(status === 304 || status === 204 ? null : body, { status, headers: step.headers });
  }) as unknown as typeof fetch;
  return { sent, fetcher };
}

const URL_ = "http://github.test/repos/acme/rocket";
const expire = (db: Db) => db.update(schema.githubCache).set({ until: now() - 1 });
const limited = { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now() + 3600) };

beforeEach(() => {
  forgetGitHubLimits();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("cachedGet", () => {
  test("a fresh answer comes from Postgres without asking GitHub again", async () => {
    const db = await testDb();
    const gh = github([{ body: { id: 1 }, headers: { etag: '"a"' } }]);
    const first = await cachedGet<{ id: number }>(db, { url: URL_, ttl: 600, fetcher: gh.fetcher });
    const second = await cachedGet<{ id: number }>(db, { url: URL_, ttl: 600, fetcher: gh.fetcher });
    expect(first).toEqual({ status: 200, body: { id: 1 }, cached: false, stale: false });
    expect(second).toEqual({ status: 200, body: { id: 1 }, cached: true, stale: false });
    expect(gh.sent).toHaveLength(1);
  });

  test("an expired answer is revalidated with its ETag, and a 304 keeps the body and renews it", async () => {
    const db = await testDb();
    const gh = github([{ body: { id: 1 }, headers: { etag: '"a"' } }, { status: 304 }]);
    await cachedGet(db, { url: URL_, ttl: 600, token: "t", fetcher: gh.fetcher });
    await expire(db);
    const again = await cachedGet(db, { url: URL_, ttl: 600, token: "t", fetcher: gh.fetcher });
    expect(gh.sent[1]?.headers["if-none-match"]).toBe('"a"');
    expect(gh.sent[1]?.headers.authorization).toBe("Bearer t");
    expect(again).toEqual({ status: 200, body: { id: 1 }, cached: true, stale: false });
    const [row] = await db.select().from(schema.githubCache);
    expect(row?.until).toBeGreaterThan(now() + 500);
    expect(gh.sent).toHaveLength(2);
    await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher });
    expect(gh.sent).toHaveLength(2);
  });

  test("a changed answer replaces the old one", async () => {
    const db = await testDb();
    const gh = github([{ body: { id: 1 }, headers: { etag: '"a"' } }, { body: { id: 2 }, headers: { etag: '"b"' } }]);
    await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher });
    await expire(db);
    expect((await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher })).body).toEqual({ id: 2 });
    const [row] = await db.select().from(schema.githubCache);
    expect(row).toMatchObject({ etag: '"b"', status: 200 });
  });

  test("a missing resource is remembered for a short while only", async () => {
    const db = await testDb();
    const gh = github([{ status: 404, body: { message: "Not Found" } }]);
    const first = await cachedGet(db, { url: URL_, ttl: 86_400, fetcher: gh.fetcher });
    expect(first.status).toBe(404);
    expect((await cachedGet(db, { url: URL_, ttl: 86_400, fetcher: gh.fetcher })).cached).toBe(true);
    const [row] = await db.select().from(schema.githubCache);
    expect(row?.until).toBeLessThanOrEqual(now() + 600);
    expect(gh.sent).toHaveLength(1);
  });

  test("a refusal that is not a limit is remembered briefly, and an unauthorised or failing answer is not remembered", async () => {
    const db = await testDb();
    const refused = github([{ status: 403, body: { message: "list too large" } }]);
    expect((await cachedGet(db, { url: `${URL_}/contributors`, ttl: 86_400, fetcher: refused.fetcher })).status).toBe(403);
    expect((await cachedGet(db, { url: `${URL_}/contributors`, ttl: 86_400, fetcher: refused.fetcher })).cached).toBe(true);
    const unauthorised = github([{ status: 401, body: { message: "Bad credentials" } }]);
    expect(await cachedGet(db, { url: `${URL_}/a`, ttl: 600, fetcher: unauthorised.fetcher })).toEqual({ status: 401, body: null, cached: false, stale: false });
    const failing = github([{ status: 502 }]);
    await cachedGet(db, { url: `${URL_}/b`, ttl: 600, fetcher: failing.fetcher });
    expect(await db.select().from(schema.githubCache)).toHaveLength(1);
  });

  test("a success that is not JSON is returned but not kept", async () => {
    const db = await testDb();
    const gh = github([{ body: "<html>bad gateway</html>" }]);
    expect(await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher })).toEqual({ status: 200, body: null, cached: false, stale: false });
    expect(await db.select().from(schema.githubCache)).toEqual([]);
  });

  test("an empty answer is remembered as empty", async () => {
    const db = await testDb();
    const gh = github([{ status: 204 }]);
    expect(await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher })).toEqual({ status: 204, body: null, cached: false, stale: false });
    expect(await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher })).toEqual({ status: 204, body: null, cached: true, stale: false });
  });

  test.each([
    ["the primary limit", { status: 403, headers: limited }],
    ["a secondary limit", { status: 403, headers: { "retry-after": "60" } }],
    ["a limit worded in the body", { status: 403, body: { message: "You have exceeded a secondary rate limit." } }],
    ["a 429", { status: 429 }],
    ["a failing GitHub", { status: 503 }],
    ["an unreachable GitHub", { fail: true }],
  ] satisfies [string, Step][])("when GitHub answers with %s, the stale answer is served instead", async (_, step) => {
    const db = await testDb();
    const gh = github([{ body: { id: 1 }, headers: { etag: '"a"' } }, step]);
    await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher });
    await expire(db);
    expect(await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher })).toEqual({ status: 200, body: { id: 1 }, cached: true, stale: true });
    expect(gh.sent).toHaveLength(2);
  });

  test("with nothing kept, a limit is reported as its status and nothing is stored", async () => {
    const db = await testDb();
    const gh = github([{ status: 403, headers: limited, body: { message: "API rate limit exceeded" } }]);
    expect(await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher })).toEqual({ status: 403, body: null, cached: false, stale: false });
    expect(await db.select().from(schema.githubCache)).toEqual([]);
  });

  test("a token near its limit is not spent: the stale answer is served without asking, and with nothing kept GitHub is not asked at zero", async () => {
    const db = await testDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const low = { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "100", "x-ratelimit-reset": String(now() + 3600), "x-ratelimit-resource": "core" };
    const gh = github([{ body: { id: 1 }, headers: low }, { body: { id: 2 } }]);
    await cachedGet(db, { url: URL_, ttl: 600, token: "site", scope: "public", fetcher: gh.fetcher });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("github rate limit low: public core 100/5000"));
    await expire(db);
    expect(await cachedGet(db, { url: URL_, ttl: 600, token: "site", scope: "public", fetcher: gh.fetcher })).toMatchObject({ body: { id: 1 }, stale: true });
    expect(gh.sent).toHaveLength(1);
    expect(await cachedGet(db, { url: URL_, ttl: 600, token: "other", scope: "public", fetcher: gh.fetcher })).toMatchObject({ body: { id: 2 }, stale: false });

    const empty = github([{ body: {}, headers: { ...low, "x-ratelimit-remaining": "0" } }]);
    await cachedGet(db, { url: `${URL_}/x`, ttl: 600, token: "t", fetcher: empty.fetcher });
    expect(await cachedGet(db, { url: `${URL_}/y`, ttl: 600, token: "t", fetcher: empty.fetcher })).toEqual({ status: 429, body: null, cached: false, stale: false });
    expect(empty.sent).toHaveLength(1);
    expect(githubLimits().map((l) => [l.label, l.resource, l.remaining])).toContainEqual(["public", "core", 0]);
  });

  test("search and core limits are tracked apart", async () => {
    const db = await testDb();
    const search = github([{ body: { items: [] }, headers: { "x-ratelimit-limit": "30", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now() + 60), "x-ratelimit-resource": "search" } }]);
    await cachedGet(db, { url: "http://github.test/search/users?q=a", ttl: 600, token: "t", fetcher: search.fetcher });
    const core = github([{ body: { id: 1 } }]);
    expect((await cachedGet(db, { url: URL_, ttl: 600, token: "t", fetcher: core.fetcher })).status).toBe(200);
    expect((await cachedGet(db, { url: "http://github.test/search/users?q=b", ttl: 600, token: "t", fetcher: search.fetcher })).status).toBe(429);
  });

  test("answers kept for one scope are never given to another", async () => {
    const db = await testDb();
    const gh = github([{ body: { private: true } }, { body: { private: false } }]);
    const mine = await cachedGet(db, { url: URL_, ttl: 600, token: "mine", scope: "user:1", fetcher: gh.fetcher });
    const yours = await cachedGet(db, { url: URL_, ttl: 600, token: "yours", scope: "user:2", fetcher: gh.fetcher });
    const everyone = await cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher });
    expect([mine.body, yours.body, everyone.body]).toEqual([{ private: true }, { private: false }, { private: false }]);
    expect(gh.sent).toHaveLength(3);
    expect(await cachedGet(db, { url: URL_, ttl: 600, token: "mine", scope: "user:1", fetcher: gh.fetcher })).toMatchObject({ body: { private: true }, cached: true });
  });

  test("an answer the caller will not share is returned but not kept", async () => {
    const db = await testDb();
    const gh = github([{ body: { private: true } }]);
    const answer = await cachedGet<{ private: boolean }>(db, { url: URL_, ttl: 600, token: "mine", keep: (body) => (body as { private?: boolean }).private !== true, fetcher: gh.fetcher });
    expect(answer.body).toEqual({ private: true });
    expect(await db.select().from(schema.githubCache)).toEqual([]);
  });

  test("identical requests in flight share one", async () => {
    const db = await testDb();
    const gh = github([{ body: { id: 1 } }]);
    const all = await Promise.all([1, 2, 3].map(() => cachedGet(db, { url: URL_, ttl: 600, fetcher: gh.fetcher })));
    expect(all.map((a) => a.body)).toEqual([{ id: 1 }, { id: 1 }, { id: 1 }]);
    expect(gh.sent).toHaveLength(1);
  });

  test("without a database nothing is kept, but identical requests in flight still share one", async () => {
    const gh = github([{ body: { id: 1 } }]);
    await Promise.all([cachedGet(null, { url: URL_, ttl: 600, token: "a", fetcher: gh.fetcher }), cachedGet(null, { url: URL_, ttl: 600, token: "a", fetcher: gh.fetcher })]);
    expect(gh.sent).toHaveLength(1);
    await cachedGet(null, { url: URL_, ttl: 600, token: "a", fetcher: gh.fetcher });
    await cachedGet(null, { url: URL_, ttl: 600, token: "b", fetcher: gh.fetcher });
    expect(gh.sent).toHaveLength(3);
  });

  test("a fetch that fails with nothing kept is an error", async () => {
    const db = await testDb();
    await expect(cachedGet(db, { url: URL_, ttl: 600, fetcher: github([{ fail: true }]).fetcher })).rejects.toThrow("unreachable");
  });
});

describe("githubGraphql", () => {
  const ask = { api: "http://github.test", query: "query($login: String!) { user(login: $login) { login } }", ttl: 600 };

  test("answers are kept by query, variables and scope, with no ETag", async () => {
    const db = await testDb();
    const gh = github([{ body: { data: { user: { login: "a" } } }, headers: { etag: '"x"' } }, { body: { data: { user: { login: "b" } } } }]);
    const a = await githubGraphql(db, { ...ask, variables: { login: "a" }, token: "site", fetcher: gh.fetcher });
    expect(a).toEqual({ status: 200, body: { data: { user: { login: "a" } } }, cached: false, stale: false });
    expect((await githubGraphql(db, { ...ask, variables: { login: "a" }, token: "site", fetcher: gh.fetcher })).cached).toBe(true);
    expect((await githubGraphql(db, { ...ask, variables: { login: "b" }, token: "site", fetcher: gh.fetcher })).body?.data).toEqual({ user: { login: "b" } });
    expect((await githubGraphql(db, { ...ask, variables: { login: "a" }, token: "mine", scope: "user:1", fetcher: gh.fetcher })).cached).toBe(false);
    expect(gh.sent).toHaveLength(3);
    const rows = await db.select().from(schema.githubCache);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.etag === null)).toBe(true);
    expect(gh.sent[0]?.headers).not.toHaveProperty("if-none-match");
  });

  test("asks for the rate limit along with the query and reads it", async () => {
    const db = await testDb();
    const resetAt = new Date((now() + 3600) * 1000).toISOString();
    const gh = github([{ body: { data: { user: null, rateLimit: { limit: 5000, remaining: 40, resetAt } } } }]);
    await githubGraphql(db, { ...ask, variables: { login: "a" }, token: "site", scope: "public", fetcher: gh.fetcher });
    const sent = JSON.parse(gh.sent[0]?.body ?? "{}") as { query: string };
    expect(sent.query).toBe("query($login: String!) { user(login: $login) { login } rateLimit { limit remaining resetAt } }");
    expect(githubLimits()).toMatchObject([{ label: "public", resource: "graphql", limit: 5000, remaining: 40 }]);
  });

  test("a missing person is kept, a partial or failed answer is not", async () => {
    const db = await testDb();
    const missing = github([{ body: { data: { user: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] } }]);
    await githubGraphql(db, { ...ask, variables: { login: "nobody" }, token: "t", fetcher: missing.fetcher });
    expect((await githubGraphql(db, { ...ask, variables: { login: "nobody" }, token: "t", fetcher: missing.fetcher })).cached).toBe(true);
    const partial = github([{ body: { data: { user: {} }, errors: [{ type: "RESOURCE_LIMITS_EXCEEDED", message: "too much" }] } }]);
    const answer = await githubGraphql(db, { ...ask, variables: { login: "big" }, token: "t", fetcher: partial.fetcher });
    expect(answer.body?.errors?.[0]?.type).toBe("RESOURCE_LIMITS_EXCEEDED");
    expect(await db.select().from(schema.githubCache)).toHaveLength(1);
  });

  test.each([
    ["a 403", { status: 403 }],
    ["a RATE_LIMITED error", { body: { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] } }],
    ["a 502", { status: 502 }],
  ] satisfies [string, Step][])("%s serves the stale answer, and with none kept is reported as a limit or failure", async (_, step) => {
    const db = await testDb();
    const gh = github([{ body: { data: { user: { login: "a" } } } }, step]);
    await githubGraphql(db, { ...ask, variables: { login: "a" }, token: "t", fetcher: gh.fetcher });
    await expire(db);
    expect(await githubGraphql(db, { ...ask, variables: { login: "a" }, token: "t", fetcher: gh.fetcher })).toMatchObject({ body: { data: { user: { login: "a" } } }, cached: true, stale: true });
    const none = await githubGraphql(db, { ...ask, variables: { login: "b" }, token: "t", fetcher: gh.fetcher });
    expect(none.stale).toBe(false);
    expect([403, 429, 502]).toContain(none.status);
  });

  test("without a database the answer is not kept", async () => {
    const gh = github([{ body: { data: { viewer: { login: "me" } } } }]);
    await githubGraphql(null, { ...ask, token: "mine", ttl: 0, fetcher: gh.fetcher });
    await githubGraphql(null, { ...ask, token: "mine", ttl: 0, fetcher: gh.fetcher });
    expect(gh.sent).toHaveLength(2);
  });
});

describe("pruneGitHubCache", () => {
  test("deletes answers that expired more than a day ago and nothing else", async () => {
    const db = await testDb();
    const at = now();
    await db.insert(schema.githubCache).values([
      { key: "old", status: 200, body: "{}", fetchedAt: at - 200_000, until: at - 90_000 },
      { key: "recent", status: 200, body: "{}", fetchedAt: at - 2000, until: at - 1000 },
      { key: "fresh", status: 200, body: "{}", fetchedAt: at, until: at + 1000 },
    ]);
    expect(await pruneGitHubCache(db)).toBe(1);
    expect((await db.select().from(schema.githubCache)).map((r) => r.key).sort()).toEqual(["fresh", "recent"]);
  });
});
