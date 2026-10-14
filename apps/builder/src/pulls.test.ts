import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { PULLS_VERSION, schema, type Db } from "@commitscape/server";
import { loginOf, readPulls, reviewRows, type Node } from "./pulls";

const { pullRequests, pullReviews, repositories } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

const who = (login: string, type = "User") => ({ __typename: type, login });
const node = (number: number, updatedAt: string, author: ReturnType<typeof who>, reviewers: string[] = [], mergedAt: string | null = null): Node => ({
  number,
  title: `PR ${number}`,
  state: mergedAt ? "MERGED" : "OPEN",
  createdAt: "2026-01-01T00:00:00Z",
  mergedAt,
  updatedAt,
  additions: number * 10,
  deletions: number,
  headRefName: null,
  author,
  reviews: { nodes: reviewers.map((r, i) => ({ author: who(r), submittedAt: `2026-02-0${i + 1}T00:00:00Z`, state: "COMMENTED" })) },
});

function github(pages: Node[][], decisions: Record<number, string> = {}) {
  const asked: (string | null)[] = [];
  const decided: number[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: { after: string | null } };
    if (query.includes("pullRequest(number:")) {
      const numbers = [...query.matchAll(/pullRequest\(number: (\d+)\)/g)].map((m) => Number(m[1]));
      decided.push(...numbers);
      return Response.json({ data: { repository: Object.fromEntries(numbers.map((n) => [`p${n}`, { number: n, reviewDecision: decisions[n] ?? null }])) } });
    }
    asked.push(variables.after);
    const i = variables.after ? Number(variables.after) : 0;
    return Response.json({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) }, nodes: pages[i] ?? [] } } } });
  }) as unknown as typeof fetch;
  return { asked, decided, gh: { api: "http://github.test", token: "t", fetcher } };
}

async function database(version = PULLS_VERSION): Promise<Db> {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", pullsVersion: version });
  return db;
}

test("the first read takes every pull request and review; later reads stop at the last one read", async () => {
  const db = await database(0);
  const first = github([
    [node(3, "2026-03-03T00:00:00Z", who("Alice"), ["bob", "bob", "alice"], "2026-03-02T00:00:00Z"), node(2, "2026-03-02T00:00:00Z", who("renovate", "Bot"))],
    [node(1, "2026-03-01T00:00:00Z", who("bob"), ["Alice"], "2026-03-01T00:00:00Z")],
  ]);
  expect(await readPulls(db, first.gh, "acme/rocket", "acme", "rocket", Date.now() + 60_000)).toMatchObject({ pages: 3, pulls: 3, done: true, whole: true });
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
  expect(await readPulls(db, later.gh, "acme/rocket", "acme", "rocket", Date.now() + 60_000)).toMatchObject({ pages: 1, pulls: 2, done: true, whole: false });
  expect(later.asked).toEqual([null]);
  expect((await db.select().from(pullReviews)).map((r) => [r.number, r.reviewer]).sort()).toEqual([
    [1, "alice"],
    [3, "carol"],
  ]);
  const [repo] = await db.select().from(repositories);
  expect([repo?.pullsAt, repo?.pullsVersion, repo?.pullsCursor]).toEqual(["2026-03-05T00:00:00Z", PULLS_VERSION, null]);
});

test("a read past its time stops without moving the mark, so the next one starts again", async () => {
  const db = await database();
  const slow = github([[node(1, "2026-03-01T00:00:00Z", who("bob"))]]);
  expect(await readPulls(db, slow.gh, "acme/rocket", "acme", "rocket", Date.now() - 1)).toMatchObject({ done: false, pages: 0 });
  expect((await db.select().from(repositories))[0]?.pullsAt).toBeNull();
});

test("a whole read cut off goes on from the page it stopped at, then reads what changed while it ran", async () => {
  const db = await database(0);
  const pages = [[node(3, "2026-03-03T00:00:00Z", who("ada"))], [node(2, "2026-03-02T00:00:00Z", who("ada"))], [node(1, "2026-03-01T00:00:00Z", who("ada"))]];
  const first = github(pages);
  const slow = { ...first.gh, fetcher: (async (url: string, init: RequestInit) => {
    await new Promise((r) => setTimeout(r, 300));
    return (first.gh.fetcher as typeof fetch)(url, init);
  }) as unknown as typeof fetch };
  expect(await readPulls(db, slow, "acme/rocket", "acme", "rocket", Date.now() + 150)).toMatchObject({ done: false, whole: true, pages: 1, pulls: 1 });
  const [mid] = await db.select().from(repositories);
  expect([mid?.pullsVersion, mid?.pullsMark, mid?.pullsCursor, mid?.pullsAt]).toEqual([0, "2026-03-03T00:00:00Z", "1", null]);
  const again = github([[node(4, "2026-03-09T00:00:00Z", who("bob")), ...pages[0]!], ...pages.slice(1)]);
  expect(await readPulls(db, again.gh, "acme/rocket", "acme", "rocket", Date.now() + 60_000)).toMatchObject({ done: true, whole: true });
  expect(again.asked).toEqual(["1", "2", null]);
  expect((await db.select({ n: pullRequests.number }).from(pullRequests)).map((r) => r.n).sort()).toEqual([1, 2, 3, 4]);
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, "acme/rocket"));
  expect([repo?.pullsVersion, repo?.pullsAt, repo?.pullsCursor, repo?.pullsMark]).toEqual([PULLS_VERSION, "2026-03-09T00:00:00Z", null, null]);
});

test("a page GitHub takes too long over is asked for again in halves", async () => {
  const db = await database();
  const firsts: number[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body)) as { variables: { first: number } };
    firsts.push(variables.first);
    if (variables.first > 12) return new Response("{}", { status: 502 });
    return Response.json({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(1, "2026-03-01T00:00:00Z", who("ada"), [], "2026-03-01T00:00:00Z")] } } } });
  }) as unknown as typeof fetch;
  expect(await readPulls(db, { api: "http://github.test", token: "t", fetcher }, "acme/rocket", "acme", "rocket", Date.now() + 60_000)).toMatchObject({ done: true, pulls: 1 });
  expect(firsts).toEqual([25, 12]);
});

test("a pull request keeps who merged it, where it came from and went, its labels, counts and merge commit, and an open one its review decision", async () => {
  const db = await database();
  const full: Node = {
    ...node(7, "2026-03-07T00:00:00Z", who("Ada"), [], "2026-03-06T00:00:00Z"),
    closedAt: "2026-03-06T00:00:00Z",
    changedFiles: 4,
    isDraft: false,
    headRefName: "patch-1",
    baseRefName: "main",
    isCrossRepository: true,
    headRepositoryOwner: { login: "Ada" },
    mergedBy: who("Bob"),
    mergeCommit: { oid: "a".repeat(40) },
    labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
    comments: { totalCount: 3 },
    commits: { totalCount: 2 },
  };
  const open = node(8, "2026-03-06T00:00:00Z", who("Cy"));
  const read = github([[full, open]], { 8: "CHANGES_REQUESTED" });
  await readPulls(db, read.gh, "acme/rocket", "acme", "rocket", Date.now() + 60_000);
  expect(read.decided).toEqual([8]);
  const [row, other] = await db.select().from(pullRequests).orderBy(pullRequests.number);
  expect(other?.reviewDecision).toBe("changes_requested");
  expect(row).toMatchObject({
    closedAt: Date.parse("2026-03-06T00:00:00Z") / 1000,
    changedFiles: 4,
    draft: false,
    headRef: "patch-1",
    baseRef: "main",
    fromFork: true,
    headOwner: "ada",
    mergedBy: "bob",
    mergeCommit: "a".repeat(40),
    reviewDecision: null,
    labels: [{ name: "bug", colour: "d73a4a" }],
    comments: 3,
    commits: 2,
  });
});

test("a reviewer's last word stands over later comments, and their first approval is kept", () => {
  const at = (d: number) => `2026-02-0${d}T00:00:00Z`;
  const n: Node = {
    ...node(1, at(9), who("ada")),
    reviews: {
      nodes: [
        { author: who("bob"), submittedAt: at(1), state: "COMMENTED" },
        { author: who("bob"), submittedAt: at(2), state: "CHANGES_REQUESTED" },
        { author: who("bob"), submittedAt: at(3), state: "APPROVED" },
        { author: who("bob"), submittedAt: at(4), state: "COMMENTED" },
        { author: who("cy"), submittedAt: at(5), state: "COMMENTED" },
        { author: who("cy"), submittedAt: null, state: "PENDING" },
        { author: who("ada"), submittedAt: at(6), state: "APPROVED" },
      ],
    },
  };
  const s = (d: string) => Date.parse(d) / 1000;
  expect(reviewRows("r", [n])).toEqual([
    { repoId: "r", number: 1, reviewer: "bob", reviews: 4, firstAt: s(at(1)), lastAt: s(at(4)), state: "approved", approvedAt: s(at(3)) },
    { repoId: "r", number: 1, reviewer: "cy", reviews: 1, firstAt: s(at(5)), lastAt: s(at(5)), state: "commented", approvedAt: null },
  ]);
});

test("a bot's login is marked as one", () => {
  expect(loginOf(who("dependabot", "Bot"))).toBe("dependabot[bot]");
  expect(loginOf(who("github-actions[bot]", "Bot"))).toBe("github-actions[bot]");
  expect(loginOf(who("Alice"))).toBe("alice");
  expect(loginOf(null)).toBeNull();
});
