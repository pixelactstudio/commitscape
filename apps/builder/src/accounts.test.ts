import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { forgetGitHubLimits, schema, type Db } from "@commitscape/server";
import { accountsFor, authorsQuery, COMMITS_PER_QUERY, noreplyLogin, signaturesOf, type Signature } from "./accounts";

const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const sha = (n: number) => n.toString(16).padStart(40, "0");
const sig = (email: string, commits: number, n: number): Signature => ({ email, name: email, commits, sha: sha(n) });

type Asked = { url: string; owner: unknown; name: unknown; oids: string[]; auth: string | undefined };

function graphqlGitHub(answer?: (oid: string) => string | null, status = 200) {
  const asked: Asked[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    const fields = [...body.query.matchAll(/(c\d+): object\(oid: "([0-9a-f]{40})"\)/g)];
    asked.push({ url, owner: body.variables.owner, name: body.variables.name, oids: fields.map((m) => m[2] ?? ""), auth: (init.headers as Record<string, string>).authorization });
    if (status !== 200) return new Response("{}", { status });
    const repository = Object.fromEntries(
      fields.map((m) => {
        const oid = m[2] ?? "";
        const n = Number.parseInt(oid, 16);
        if (n % 7 === 0) return [m[1], null];
        const login = answer ? answer(oid) : `user${n}`;
        return [m[1], { author: { user: login ? { login } : null } }];
      }),
    );
    return Response.json({ data: { repository, rateLimit: { limit: 5000, remaining: 4999, resetAt: new Date(Date.now() + 3600_000).toISOString() } } });
  }) as unknown as typeof fetch;
  return { asked, fetcher };
}

test("signatures are read as commitscape writes them, and a noreply address names its login", () => {
  expect(signaturesOf(JSON.stringify([{ email: "a@x", name: "A", commits: 2, sha: sha(1) }, { email: 3 }]))).toEqual([{ email: "a@x", name: "A", commits: 2, sha: sha(1) }]);
  expect(noreplyLogin("12345+Octo-Cat@users.noreply.github.com")).toBe("Octo-Cat");
  expect(noreplyLogin("octocat@users.noreply.github.com")).toBe("octocat");
  expect(noreplyLogin("49699333+dependabot[bot]@users.noreply.github.com")).toBe("dependabot[bot]");
  expect(noreplyLogin("ada@example.com")).toBeNull();
});

test("a hundred commits' authors are asked in one GraphQL query", () => {
  expect(authorsQuery([sha(1), sha(2)])).toBe(
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { c0: object(oid: "${sha(1)}") { ... on Commit { author { user { login } } } } c1: object(oid: "${sha(2)}") { ... on Commit { author { user { login } } } } } }`,
  );
});

test("logins are asked for the emails with most commits, up to the cap, a hundred commits to a query, and each commit's answer is kept for the next Build", async () => {
  forgetGitHubLimits();
  const db = await database();
  const gh = graphqlGitHub();
  const api = { api: "http://gh.test/", token: "t", fetcher: gh.fetcher };
  const list = [...Array.from({ length: 260 }, (_, i) => sig(`p${i}@x`, 1000 - i, i + 1)), sig("1+bot[bot]@users.noreply.github.com", 5000, 9999)];
  const first = await accountsFor(db, api, { owner: "acme", name: "rocket", scope: "public" }, list, 250);
  expect(gh.asked.map((a) => a.oids.length)).toEqual([COMMITS_PER_QUERY, COMMITS_PER_QUERY, 50]);
  expect(gh.asked.every((a) => a.url === "http://gh.test/graphql" && a.owner === "acme" && a.name === "rocket" && a.auth === "Bearer t")).toBe(true);
  expect(gh.asked.flatMap((a) => a.oids)).toEqual(Array.from({ length: 250 }, (_, i) => sha(i + 1)));
  expect(first).toMatchObject({ asked: 250, requests: 3 });
  expect(first.accounts["1+bot[bot]@users.noreply.github.com"]).toBe("bot[bot]");
  expect(first.accounts["p0@x"]).toBe("user1");
  expect(first.accounts["p6@x"]).toBeUndefined();
  expect(first.accounts["p250@x"]).toBeUndefined();
  expect(Object.keys(first.accounts)).toHaveLength(1 + 250 - Math.floor(250 / 7));

  const again = await accountsFor(db, api, { owner: "acme", name: "rocket", scope: "public" }, list, 250);
  expect(again.accounts).toEqual(first.accounts);
  expect(again).toMatchObject({ requests: 1, asked: Math.floor(250 / 7) });
  expect(gh.asked.at(-1)?.oids.every((o) => Number.parseInt(o, 16) % 7 === 0)).toBe(true);

  await accountsFor(db, api, { owner: "acme", name: "rocket", scope: "acme/rocket" }, list, 250);
  expect(gh.asked.length).toBe(4 + 3);
});

test("a commit whose author GitHub links to no account is kept as having none, and nothing is asked without a token", async () => {
  forgetGitHubLimits();
  const db = await database();
  const gh = graphqlGitHub(() => null);
  const list = [sig("one@x", 3, 1), sig("two@x", 2, 2)];
  const none = await accountsFor(db, { api: "http://gh.test", token: null, fetcher: gh.fetcher }, { owner: "a", name: "b", scope: "public" }, list, 300);
  expect(none).toEqual({ accounts: {}, asked: 0, requests: 0 });
  expect(gh.asked).toHaveLength(0);
  const found = await accountsFor(db, { api: "http://gh.test", token: "t", fetcher: gh.fetcher }, { owner: "a", name: "b", scope: "public" }, list, 300);
  expect(found).toEqual({ accounts: {}, asked: 2, requests: 1 });
  expect((await accountsFor(db, { api: "http://gh.test", token: "t", fetcher: gh.fetcher }, { owner: "a", name: "b", scope: "public" }, list, 300)).requests).toBe(0);
});

test("a rate limit stops the asking and keeps what was found", async () => {
  forgetGitHubLimits();
  const db = await database();
  const gh = graphqlGitHub(undefined, 403);
  const list = Array.from({ length: 240 }, (_, i) => sig(`p${i}@x`, 240 - i, i + 1));
  const found = await accountsFor(db, { api: "http://gh.test", token: "t", fetcher: gh.fetcher }, { owner: "a", name: "b", scope: "public" }, list, 300);
  expect(found.accounts).toEqual({});
  expect(gh.asked).toHaveLength(1);
});
