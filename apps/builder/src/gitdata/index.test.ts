import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import type { GitPull, GitPullIndex } from "@commitscape/data";
import { gitBlobKey, gitFileKey, gitPullKey, memoryStorage, readBlobs, readBranchDetail, readBranches, readGitJson, removeGit, schema, type Db } from "@commitscape/server";
import type { GitSettings } from "../config";
import { buildGitData, type GitContext } from "./index";
import { repo } from "./fixture";

const { pullRequests, repoGit, repositories } = schema;
const migrations = fileURLToPath(new URL("../../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const cfg: GitSettings = {
  seconds: 60,
  branches: 300,
  tags: 50,
  branchDetails: 10,
  fileBytes: 1000,
  repoBytes: 100_000,
  warmFiles: 10,
  branchCommits: 100_000,
  pullsOpen: 10,
  pullsOthers: 10,
  patchBytes: 10_000,
  pullFileBytes: 5_000,
  pullCommits: 50,
  pullFiles: 50,
  pullsBytes: 1_000_000,
};

async function setup() {
  const r = repo();
  r.commit({ "a.ts": "export const a = 1;\n", "b.ts": "export const b = 1;\n" }, "m0", "Ada", 0);
  const m0 = r.sh(r.origin, "rev-parse", "HEAD").trim();
  r.sh(r.origin, "checkout", "-q", "-b", "feat", m0);
  const f1 = r.commit({ "a.ts": "export const a = 2;\n", "b.ts": "export const b = 2;\n" }, "feat (#7)", "Bob", 1);
  r.sh(r.origin, "checkout", "-q", "main");
  r.commit({ "c.ts": "export const c = 1;\n" }, "m1", "Ada", 2);
  r.sh(r.origin, "update-ref", "refs/pull/7/head", f1);
  r.sync();
  const db = await database();
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  await db.insert(pullRequests).values({ repoId: "acme/rocket", number: 7, state: "OPEN", title: "feat", createdAt: 1, updatedAt: 2, additions: 2, deletions: 2 });
  const storage = memoryStorage();
  const ctx: GitContext = { db, storage, cfg, repoId: "acme/rocket", buildId: "b1", dir: r.clone, env: {}, log: () => {}, private: true };
  return { r, db, storage, ctx };
}

test("a Build's git data lands beside its Report and is recorded with how long each step took", async () => {
  const { db, storage, ctx } = await setup();
  const done = await buildGitData(ctx);
  expect(done.steps.map((s) => [s.name, s.ok])).toEqual([["branches", true], ["files", true], ["pulls", true]]);
  const prefix = "git/gh/acme/rocket";
  const blobs = await readBlobs(db, "acme/rocket");
  expect(blobs.size).toBe(3);
  for (const sha of blobs.keys()) expect(storage.objects.has(gitBlobKey(prefix, sha))).toBe(true);
  expect(await readGitJson(storage, gitFileKey(prefix, "tree"))).toBeNull();
  const branches = await readBranches(db, "acme/rocket");
  expect(branches?.branches.map((b) => [b.name, b.ahead, b.behind, b.merged])).toEqual([["main", 0, 0, false], ["feat", 1, 1, false]]);
  const detail = await readBranchDetail(db, "acme/rocket", 1);
  expect(detail).toMatchObject({ name: "feat", against: "main", commitsTotal: 1, filesTotal: 2, added: 2, removed: 2 });
  expect(detail?.commits.map((c) => c.subject)).toEqual(["feat (#7)"]);
  expect(await readBranchDetail(db, "acme/rocket", 0)).toBeNull();
  const index = await readGitJson<GitPullIndex>(storage, gitFileKey(prefix, "pulls"));
  expect(Object.keys(index?.pulls ?? {})).toEqual(["7"]);
  const pull = await readGitJson<GitPull>(storage, gitPullKey(prefix, 7));
  expect(pull?.files.map((f) => [f.path, f.added, f.removed])).toEqual([["a.ts", 1, 1], ["b.ts", 1, 1]]);
  const [row] = await db.select().from(repoGit).where(eq(repoGit.repoId, "acme/rocket"));
  expect(row).toMatchObject({ prefix, buildId: "b1", branch: "main", branches: 2, files: 3, stored: 3, pulls: 1, complete: true });
  expect(row?.bytes).toBeGreaterThan(0);
  expect(JSON.parse(row?.steps ?? "[]")).toHaveLength(3);
});

test("a public repository's text is not uploaded, since the Site reads it from GitHub when it is opened, and text no longer at HEAD is deleted", async () => {
  const { r, db, storage, ctx } = await setup();
  const prefix = "git/gh/acme/rocket";
  const a = r.sh(r.clone, "rev-parse", "HEAD:a.ts").trim();
  await storage.put(gitBlobKey(prefix, a), "kept by the Site", { type: "text/plain" });
  await storage.put(gitBlobKey(prefix, "f".repeat(40)), "an old HEAD's", { type: "text/plain" });
  const done = await buildGitData({ ...ctx, private: false });
  expect(done.steps.every((s) => s.ok)).toBe(true);
  expect((await readBlobs(db, "acme/rocket")).size).toBe(0);
  expect([...storage.objects.keys()].filter((k) => k.includes("/blobs/"))).toEqual([gitBlobKey(prefix, a)]);
  const [row] = await db.select().from(repoGit);
  expect(row).toMatchObject({ files: 3, stored: 0, complete: true });
});

test("a private repository's warm set is held to its size and count, and a later Build with more room goes on from what was kept", async () => {
  const { db, ctx } = await setup();
  await buildGitData({ ...ctx, cfg: { ...cfg, repoBytes: 25 } });
  const [first] = await db.select().from(repoGit);
  expect(first).toMatchObject({ files: 3, stored: 1, complete: true });
  await buildGitData({ ...ctx, cfg: { ...cfg, warmFiles: 2 } });
  const [second] = await db.select().from(repoGit);
  expect(second).toMatchObject({ stored: 2, complete: true });
});

test("a second Build at the same head leaves the files as they are and still looks at branches and pull requests", async () => {
  const { storage, ctx } = await setup();
  await buildGitData(ctx);
  const before = [...storage.objects.keys()].sort();
  const second = await buildGitData({ ...ctx, buildId: "b2" });
  expect(second.steps.every((s) => s.ok)).toBe(true);
  expect([...storage.objects.keys()].sort()).toEqual(before);
  const [row] = await ctx.db.select().from(repoGit);
  expect(row).toMatchObject({ buildId: "b2", files: 3, stored: 3 });
  expect(row?.bytes).toBeGreaterThan(0);
});

test("a step that fails leaves the others written and the Build unharmed", async () => {
  const { r, ctx } = await setup();
  r.sh(r.clone, "remote", "set-url", "origin", "/nowhere/at/all");
  const done = await buildGitData(ctx);
  expect(done.steps.map((s) => [s.name, s.ok])).toEqual([["branches", true], ["files", true], ["pulls", false]]);
  expect((await readBlobs(ctx.db, "acme/rocket")).size).toBe(3);
  const [row] = await ctx.db.select().from(repoGit);
  expect(row?.files).toBe(3);
});

test("with no clone at all every step fails soft and nothing is recorded", async () => {
  const { storage, ctx } = await setup();
  const done = await buildGitData({ ...ctx, dir: "/does/not/exist" });
  expect(done.steps.every((s) => !s.ok)).toBe(true);
  expect(storage.objects.size).toBe(0);
  expect(await ctx.db.select().from(repoGit)).toEqual([]);
});

test("a step with no time left fails rather than running on", async () => {
  const { ctx } = await setup();
  const done = await buildGitData({ ...ctx, cfg: { ...cfg, seconds: 0.001 } });
  expect(done.seconds).toBeLessThan(5);
  expect(done.steps.every((s) => !s.ok)).toBe(true);
});

test("deleting a repository's git data takes the blobs and pull requests with it", async () => {
  const { storage, ctx } = await setup();
  await buildGitData(ctx);
  expect(storage.objects.size).toBe(5);
  await removeGit(ctx.db, storage, ["acme/rocket"]);
  expect(storage.objects.size).toBe(0);
  expect((await readBlobs(ctx.db, "acme/rocket")).size).toBe(0);
  expect(await readBranches(ctx.db, "acme/rocket")).toBeNull();
});
