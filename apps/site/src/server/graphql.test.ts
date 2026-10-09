import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { forgetGitHubLimits, now, schema, type Db } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { graphql, type GraphQL } from "./graphql";
import { SiteError } from "./http";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

function github(replies: Reply[]) {
  const sent: { token: string | null; variables: Record<string, unknown> }[] = [];
  let at = 0;
  const fetcher = (async (_url: string, init: RequestInit) => {
    sent.push({ token: new Headers(init.headers).get("authorization"), variables: (JSON.parse(String(init.body)) as { variables: Record<string, unknown> }).variables });
    const reply = replies[Math.min(at++, replies.length - 1)] ?? {};
    return new Response(JSON.stringify(reply.body ?? { data: {} }), { status: reply.status ?? 200, headers: reply.headers });
  }) as unknown as typeof fetch;
  return { sent, fetcher };
}

const QUERY = "query($login: String!) { user(login: $login) { login } }";
let db: Db;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  forgetGitHubLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(schema.githubCache);
});

const client = (fetcher: typeof fetch, over: Partial<GraphQL> = {}): GraphQL => ({ api: "http://github.test", token: "site", fetcher, count: { requests: 0 }, cache: { db, scope: "public" }, ...over });

describe("graphql", () => {
  test("a public answer under the Site's token is asked once and then served from Postgres, and only requests that reach GitHub are counted", async () => {
    const gh = github([{ body: { data: { user: { login: "alice" } } } }]);
    const c = client(gh.fetcher);
    expect(await graphql(c, QUERY, { login: "alice" })).toEqual({ user: { login: "alice" } });
    expect(await graphql(c, QUERY, { login: "alice" })).toEqual({ user: { login: "alice" } });
    expect(gh.sent).toHaveLength(1);
    expect(c.count?.requests).toBe(1);
    await graphql(c, QUERY, { login: "bob" });
    expect(c.count?.requests).toBe(2);
  });

  test("a visitor's own token is never cached or served from the shared cache", async () => {
    const gh = github([{ body: { data: { user: { login: "private-view" } } } }]);
    const own = client(gh.fetcher, { token: "ghu_alice", cache: undefined });
    await graphql(own, QUERY, { login: "alice" });
    await graphql(own, QUERY, { login: "alice" });
    expect(gh.sent).toHaveLength(2);
    expect(await db.select().from(schema.githubCache)).toEqual([]);
  });

  test("a query asked with a time to live of zero is never kept", async () => {
    const gh = github([{ body: { data: { viewer: { login: "site-owner" } } } }]);
    const c = client(gh.fetcher);
    await graphql(c, "query { viewer { login } }", {}, 0);
    await graphql(c, "query { viewer { login } }", {}, 0);
    expect(gh.sent).toHaveLength(2);
    expect(await db.select().from(schema.githubCache)).toEqual([]);
  });

  test("identical requests made together are one request", async () => {
    const gh = github([{ body: { data: { user: { login: "alice" } } } }]);
    const c = client(gh.fetcher);
    await Promise.all([1, 2, 3].map(() => graphql(c, QUERY, { login: "alice" })));
    expect(gh.sent).toHaveLength(1);
  });

  test("when GitHub's limit is reached the stale answer is served, and with none a SiteError says so", async () => {
    const gh = github([{ body: { data: { user: { login: "alice" } } } }, { status: 403, body: { message: "rate limited" } }, { body: { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] } }]);
    const c = client(gh.fetcher);
    await graphql(c, QUERY, { login: "alice" });
    await db.update(schema.githubCache).set({ until: now() - 1 });
    expect(await graphql(c, QUERY, { login: "alice" })).toEqual({ user: { login: "alice" } });
    await expect(graphql(c, QUERY, { login: "bob" })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("rate limit") });
    await expect(graphql(client(gh.fetcher, { token: "other" }), QUERY, { login: "carol" })).rejects.toThrow(SiteError);
  });

  test("a token that is out of points is not spent: nothing is sent until its window resets", async () => {
    const reset = String(now() + 1800);
    const gh = github([{ body: { data: { user: { login: "alice" } } }, headers: { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset, "x-ratelimit-resource": "graphql" } }]);
    const c = client(gh.fetcher);
    await graphql(c, QUERY, { login: "alice" });
    await expect(graphql(c, QUERY, { login: "bob" })).rejects.toMatchObject({ status: 503 });
    expect(gh.sent).toHaveLength(1);
  });

  test("a missing token, an unaccepted one and a failure are SiteErrors", async () => {
    await expect(graphql(client(github([{}]).fetcher, { token: null }), QUERY)).rejects.toMatchObject({ status: 503 });
    await expect(graphql(client(github([{ status: 401 }]).fetcher, { cache: undefined }), QUERY)).rejects.toMatchObject({ status: 401 });
    await expect(graphql(client(github([{ status: 500 }]).fetcher, { cache: undefined }), QUERY)).rejects.toMatchObject({ status: 502 });
    await expect(graphql(client(github([{ body: { errors: [{ message: "Something broke" }] } }]).fetcher, { cache: undefined }), QUERY)).rejects.toMatchObject({ status: 502, message: "Something broke" });
  });
});
