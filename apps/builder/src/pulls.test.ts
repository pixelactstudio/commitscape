import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { schema, type Db } from "@commitscape/server";
import { loginOf, readPulls } from "./pulls";

const { pullRequests, pullReviews, repositories } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

const who = (login: string, type = "User") => ({ __typename: type, login });
const node = (number: number, updatedAt: string, author: ReturnType<typeof who>, reviewers: string[] = [], mergedAt: string | null = null) => ({
  number,
  title: `PR ${number}`,
  state: mergedAt ? "MERGED" : "OPEN",
  createdAt: "2026-01-01T00:00:00Z",
  mergedAt,
  updatedAt,
  additions: number * 10,
  deletions: number,
  author,
  reviews: { nodes: reviewers.map((r, i) => ({ author: who(r), submittedAt: `2026-02-0${i + 1}T00:00:00Z` })) },
});

function github(pages: ReturnType<typeof node>[][]) {
  const asked: (string | null)[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body)) as { variables: { after: string | null } };
    asked.push(variables.after);
    const i = variables.after ? Number(variables.after) : 0;
    return Response.json({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) }, nodes: pages[i] ?? [] } } } });
  }) as unknown as typeof fetch;
  return { asked, gh: { api: "http://github.test", token: "t", fetcher } };
}

test("the first read takes every pull request and review; later reads stop at the last one read", async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  const first = github([
    [node(3, "2026-03-03T00:00:00Z", who("Alice"), ["bob", "bob", "alice"], "2026-03-02T00:00:00Z"), node(2, "2026-03-02T00:00:00Z", who("renovate", "Bot"))],
    [node(1, "2026-03-01T00:00:00Z", who("bob"), ["Alice"], "2026-03-01T00:00:00Z")],
  ]);
  expect(await readPulls(db, first.gh, "acme/rocket", "acme", "rocket", Date.now() + 60_000)).toMatchObject({ pages: 2, pulls: 3, done: true });
  expect((await db.select().from(pullRequests)).map((p) => [p.number, p.author, p.state, p.additions]).sort()).toEqual([
    [1, "bob", "MERGED", 10],
    [2, "renovate[bot]", "OPEN", 20],
    [3, "alice", "MERGED", 30],
  ]);
  expect((await db.select().from(pullReviews)).map((r) => [r.number, r.reviewer, r.reviews]).sort()).toEqual([
    [1, "alice", 1],
    [3, "bob", 2],
  ]);
  const later = github([[node(4, "2026-03-05T00:00:00Z", who("carol")), node(3, "2026-03-04T00:00:00Z", who("alice"), ["carol"], "2026-03-02T00:00:00Z"), node(2, "2026-03-02T00:00:00Z", who("renovate", "Bot"))]]);
  expect(await readPulls(db, later.gh, "acme/rocket", "acme", "rocket", Date.now() + 60_000)).toMatchObject({ pages: 1, pulls: 2, done: true });
  expect(later.asked).toEqual([null]);
  expect((await db.select().from(pullReviews)).map((r) => [r.number, r.reviewer]).sort()).toEqual([
    [1, "alice"],
    [3, "carol"],
  ]);
  const [repo] = await db.select().from(repositories);
  expect(repo?.pullsAt).toBe("2026-03-05T00:00:00Z");
});

test("a read past its time stops without moving the mark, so the next one starts again", async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  const slow = github([[node(1, "2026-03-01T00:00:00Z", who("bob"))]]);
  expect(await readPulls(db, slow.gh, "acme/rocket", "acme", "rocket", Date.now() - 1)).toMatchObject({ done: false, pages: 0 });
  expect((await db.select().from(repositories))[0]?.pullsAt).toBeNull();
});

test("a bot's login is marked as one", () => {
  expect(loginOf(who("dependabot", "Bot"))).toBe("dependabot[bot]");
  expect(loginOf(who("github-actions[bot]", "Bot"))).toBe("github-actions[bot]");
  expect(loginOf(who("Alice"))).toBe("alice");
  expect(loginOf(null)).toBeNull();
});
