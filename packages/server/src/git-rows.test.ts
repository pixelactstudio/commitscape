import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { GIT_FORMAT, type GitBranch, type GitBranches } from "@commitscape/data";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { branchPeople, readBranchInsight, readBranches, readOpenBranches, withPeople, writeBranches } from "./git-rows";
import { seedIndex } from "./index-seed";

const { indexCommits, indexFilePaths, indexPeople, indexPersons, pullRequests, repoGit, repositories, storedIndexes } = schema;
const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  return db as unknown as Db;
}

const branch = (name: string, author: string, login: string | null = null): GitBranch => ({
  name,
  sha: "s",
  at: 100,
  author,
  login,
  subject: "",
  ahead: 1,
  behind: 0,
  base: "b",
  baseAt: 1,
  merged: false,
  squashed: false,
  parent: "main",
  shared: 0,
});

test("a branch's author is named by the Stored Index's people when the email named no one, and bots are marked", async () => {
  const db = await database();
  const [si] = await db
    .insert(storedIndexes)
    .values({ repoId: "acme/rocket", lineage: "1", kept: true, state: "live", lines: true, builtAt: 1, snapshot: { commits: 0, merges: 0, oldest: null, newest: null, languages: [], code_age: [], suspects: [], releases: [] } })
    .returning({ id: storedIndexes.id });
  const id = si?.id ?? 0;
  await db.update(repositories).set({ indexId: id });
  await db.insert(indexPersons).values([
    { si: id, person: 0, traits: 0, identities: 1, commits: 900 },
    { si: id, person: 1, traits: 0, identities: 1, commits: 3 },
    { si: id, person: 2, traits: 4, identities: 1, commits: 40 },
  ]);
  await db.insert(indexPeople).values([
    { si: id, signature: 0, name: "Andrew Gallant", person: 0, login: "burntsushi", bot: false },
    { si: id, signature: 1, name: "andrew gallant", person: 1, login: "someone-else", bot: false },
    { si: id, signature: 2, name: "Release Robot", person: 2, login: null, bot: true },
  ]);
  const people = await branchPeople(db, "acme/rocket");
  expect(people.get("andrew gallant")).toEqual({ login: "burntsushi", bot: false });
  const out = withPeople([branch("ag/wip", "Andrew Gallant"), branch("deps", "dependabot[bot]", "dependabot[bot]"), branch("rel", "Release Robot"), branch("x", "Nobody", "nobody")], people);
  expect(out.map((b) => [b.name, b.login, b.bot])).toEqual([
    ["ag/wip", "burntsushi", false],
    ["deps", "dependabot[bot]", true],
    ["rel", null, true],
    ["x", "nobody", false],
  ]);
});

test("a branch's pull request is one opened from the repository itself, not a fork's branch of the same name", async () => {
  const db = await database();
  await db.insert(repoGit).values({ repoId: "acme/rocket", prefix: "p", buildId: "b", builtAt: 1, head: "h", branch: "main" });
  const found: GitBranches = { v: GIT_FORMAT, builtAt: 1, default: "main", head: "h", total: 3, inferred: true, branches: [branch("main", "Ada"), branch("patch-1", "Ada"), branch("old", "Ada")], tags: [], tagsTotal: 0 };
  await writeBranches(db, "acme/rocket", found, new Map());
  const pull = (number: number, head: string, headOwner: string | null, fromFork: boolean | null, state = "OPEN") => ({ repoId: "acme/rocket", number, state, title: `#${number}`, createdAt: number, updatedAt: number, additions: 0, deletions: 0, headRef: head, headOwner, fromFork });
  await db.insert(pullRequests).values([pull(1, "patch-1", "stranger", true), pull(2, "patch-1", "acme", false, "MERGED"), pull(3, "patch-1", "other", true), pull(4, "old", null, null, "CLOSED")]);
  const read = await readBranches(db, "acme/rocket");
  const by = Object.fromEntries((read?.branches ?? []).map((b) => [b.name, b.pull?.number ?? null]));
  expect(by).toEqual({ main: null, "patch-1": 2, old: 4 });
  await db.update(pullRequests).set({ headOwner: "elsewhere", fromFork: true }).where(eq(pullRequests.number, 4));
  expect((await readBranches(db, "acme/rocket"))?.branches.find((b) => b.name === "old")?.pull).toBeNull();
});

const sha = (k: number) => k.toString(16).padStart(2, "0").repeat(20);

async function seeded() {
  const db = await database();
  await db.insert(repoGit).values({ repoId: "acme/rocket", prefix: "p", buildId: "b", builtAt: 10_000_000, head: "h", branch: "main", branchesTotal: 4, tagsTotal: 3 });
  const si = await seedIndex(db, "acme/rocket", {
    anchor: 10_000_000,
    persons: [
      { id: 1, name: "Ada", login: "ada" },
      { id: 2, name: "Bob", login: "bob" },
      { id: 3, name: "Robot", login: "robot[bot]", bot: true },
    ],
    files: [
      { file: 0, path: "src/a.ts" },
      { file: 1, path: "src/b.ts" },
      { file: 2, path: "src/c.ts" },
      { file: 3, path: "src/other.ts" },
    ],
    commits: [
      { sha: sha(1), at: 100, person: 1, subject: "one", files: [0, 1] },
      { sha: sha(2), at: 200, person: 1, subject: "two", files: [0] },
      { sha: sha(3), at: 300, person: 2, subject: "three", files: [1] },
      { sha: sha(4), at: 9_990_000, person: 2, subject: "four", files: [0, 2] },
      { sha: sha(5), at: 9_990_100, person: 3, subject: "five", files: [0] },
      { sha: sha(6), at: 9_990_200, person: 2, subject: "six", files: [3] },
      { sha: sha(7), at: 9_990_300, person: 2, subject: "merge", files: [], merge: true },
      { sha: sha(8), at: 9_990_400, person: 1, subject: "on a branch", files: [0] },
    ],
  });
  for (const k of [1, 2, 3, 4, 5, 6, 7]) {
    const c = await db.select({ at: indexCommits.at }).from(indexCommits).where(eq(indexCommits.sha, Buffer.from(sha(k), "hex")));
    await db.update(indexCommits).set({ flags: k === 7 ? 9 : 8, arrival: c[0]?.at ?? 0 }).where(eq(indexCommits.sha, Buffer.from(sha(k), "hex")));
  }
  await db.insert(indexFilePaths).values({ si, file: 2, path: "src/old-c.ts" });
  return db;
}

const tip = (name: string, over: Partial<GitBranch> = {}): GitBranch => ({ ...branch(name, "Ada", "ada"), at: 9_990_500, baseAt: 9_990_000, ahead: 2, ...over });

test("a branch carries the times of the commits kept for it, its pull request's draft state, and is counted open unless merged, a bot's or the default branch", async () => {
  const db = await seeded();
  const found: GitBranches = {
    v: GIT_FORMAT,
    builtAt: 10_000_000,
    default: "main",
    head: "h",
    total: 4,
    inferred: true,
    branches: [tip("main", { ahead: 0 }), tip("feature/a"), tip("feature/b", { merged: true, ahead: 0 }), { ...tip("bot/x"), bot: true }],
    tags: [],
    tagsTotal: 0,
  };
  await writeBranches(db, "acme/rocket", found, new Map([[1, { v: GIT_FORMAT, name: "feature/a", against: "main", commits: [{ sha: "x", at: 9_990_400, author: "Ada", subject: "s" }, { sha: "y", at: 9_990_100, author: "Ada", subject: "s" }], commitsTotal: 2, files: [], filesTotal: 0, added: 0, removed: 0 }]]));
  await db.insert(pullRequests).values({ repoId: "acme/rocket", number: 7, state: "OPEN", title: "A", createdAt: 1, updatedAt: 2, additions: 0, deletions: 0, headRef: "feature/a", headOwner: "acme", fromFork: false, draft: true });
  const read = await readBranches(db, "acme/rocket");
  const a = read?.branches.find((b) => b.name === "feature/a");
  expect(a?.ticks).toEqual([9_990_100, 9_990_400]);
  expect(a?.pull).toMatchObject({ number: 7, state: "OPEN", draft: true });
  expect(read?.branches.find((b) => b.name === "feature/b")?.ticks).toBeUndefined();
  expect(await readOpenBranches(db, "acme/rocket")).toBe(1);
});

test("the newest tag of a family says how many commits the default branch has taken since its commit arrived, and tags it does not hold say nothing", async () => {
  const db = await seeded();
  const found: GitBranches = { v: GIT_FORMAT, builtAt: 10_000_000, default: "main", head: "h", total: 1, inferred: true, branches: [tip("main", { ahead: 0 })], tags: [], tagsTotal: 3 };
  await writeBranches(db, "acme/rocket", found, new Map());
  await db.insert(schema.repoTags).values([
    { repoId: "acme/rocket", position: 0, name: "v2.0.0", sha: sha(4), at: 9_990_000 },
    { repoId: "acme/rocket", position: 1, name: "v1.0.0", sha: sha(2), at: 200 },
    { repoId: "acme/rocket", position: 2, name: "nightly", sha: sha(8), at: 9_990_400 },
  ]);
  const read = await readBranches(db, "acme/rocket");
  expect(read?.tags.map((t) => [t.name, t.since])).toEqual([
    ["v2.0.0", 2],
    ["v1.0.0", undefined],
    ["nightly", undefined],
  ]);
});

test("a branch's changes are met with who holds the files, bots never, and the files the default branch changed after the branch left it", async () => {
  const db = await seeded();
  const found: GitBranches = { v: GIT_FORMAT, builtAt: 10_000_000, default: "main", head: "h", total: 2, inferred: true, branches: [tip("main", { ahead: 0 }), tip("feature/a", { baseAt: 9_980_000 })], tags: [], tagsTotal: 0 };
  const files = [{ path: "src/a.ts", added: 9, removed: 1 }, { path: "src/old-c.ts", added: 1, removed: 0 }, { path: "src/new.ts", added: 5, removed: 0 }];
  await writeBranches(db, "acme/rocket", found, new Map([[1, { v: GIT_FORMAT, name: "feature/a", against: "main", commits: [], commitsTotal: 0, files, filesTotal: 3, added: 15, removed: 1 }]]));
  const insight = await readBranchInsight(db, "acme/rocket", 1);
  expect(insight).toMatchObject({ name: "feature/a", forkedAt: 9_980_000, touched: 3, known: 2, atHead: ["src/a.ts"], landed: 3 });
  expect(insight?.holders.map((h) => [h.login, h.files, h.commits])).toEqual([
    ["ada", 1, 2],
    ["bob", 1, 1],
  ]);
  expect(insight?.conflicts.map((c) => [c.path, c.commits, c.login])).toEqual([
    ["src/a.ts", 2, "robot[bot]"],
    ["src/old-c.ts", 1, "bob"],
  ]);
  expect(insight?.conflictCommits).toBe(2);
  expect(await readBranchInsight(db, "acme/rocket", 0)).toBeNull();
  await db.update(schema.repoBranches).set({ baseAt: 0 }).where(eq(schema.repoBranches.position, 1));
  expect(await readBranchInsight(db, "acme/rocket", 1)).toMatchObject({ forkedAt: 0, landed: 0, conflicts: [], conflictCommits: 0 });
});
