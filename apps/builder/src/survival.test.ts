import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { memoryStorage, schema, type Db } from "@commitscape/server";
import type { JobContext } from "./job";
import type { Ran } from "./run";
import { runSurvival } from "./survival";

const { repositories, surviving } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function setup(run: (cmd: string, args: string[]) => Promise<Ran>, over: Partial<typeof repositories.$inferInsert> = {}) {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", reportKey: "r/b1", reportLines: true, ...over });
  await db.insert(surviving).values([3, 4].map((personId) => ({ repoId: "acme/rocket", reportKey: "r/b1", personId, status: "queued", askedAt: 1 })));
  const work = await mkdtemp(join(tmpdir(), "survival-"));
  const ctx = { db, storage: memoryStorage(), cfg: { bin: "commitscape", work, concurrency: 1, fullUpToMb: 100, maxMb: 3000, timeLimit: 60, diskGb: 20, gitBase: undefined }, app: null, run, github: { api: "x", token: null }, log: () => {}, budget: 60 } as JobContext & { budget: number };
  return { db, ctx };
}

const rows = async (db: Db) => (await db.select().from(surviving)).sort((a, b) => a.personId - b.personId).map((r) => [r.personId, r.status, r.lines, r.added, r.head]);
const oldestOf = async (db: Db, id: number) => (await db.select().from(surviving)).find((r) => r.personId === id)?.oldest;

test("each person's count is recorded at the Report's head; one over budget gets no number", async () => {
  let asked: string[] = [];
  const { db, ctx } = await setup(async (_cmd, args) => {
    asked = args;
    return { code: 0, stderr: "", timedOut: false, stdout: JSON.stringify({ head: "a".repeat(40), people: [{ id: 3, name: "Alice", status: "counted", surviving: 75, added: 120, files: 4, oldest: 1_500_000_000, seconds: 0.5 }, { id: 4, name: "Bob", status: "over_budget", surviving: null, added: 30, files: 9, seconds: 60 }] }) };
  });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4] }, ctx);
  expect(asked).toEqual(["surviving", "--budget-seconds", "60", "--cache-dir", ctx.cfg.work, "--offline", "--person", "3", "--person", "4", "--", "acme/rocket"]);
  await mkdir(join(ctx.cfg.work, "clones", "acme", "rocket"), { recursive: true });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, ctx);
  expect(asked.at(-1)).toBe(join(ctx.cfg.work, "clones", "acme", "rocket"));
  expect(await rows(db)).toEqual([
    [3, "counted", 75, 120, "a".repeat(40)],
    [4, "over_budget", null, 30, "a".repeat(40)],
  ]);
  expect(await oldestOf(db, 3)).toBe(1_500_000_000);
  expect(await oldestOf(db, 4)).toBeNull();
});

test("a Report replaced since it was asked is stale, a history read without old files is not counted, and a failure says so", async () => {
  let ran = 0;
  const count = async (): Promise<Ran> => {
    ran++;
    return { code: 1, stderr: "boom", timedOut: false, stdout: "" };
  };
  const stale = await setup(count, { reportKey: "r/b2" });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, stale.ctx);
  expect((await rows(stale.db))[0]?.[1]).toBe("stale");
  const partial = await setup(count, { reportLines: false });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, partial.ctx);
  expect((await rows(partial.db))[0]?.[1]).toBe("not_counted");
  expect(ran).toBe(0);
  const failed = await setup(count);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, failed.ctx);
  expect((await rows(failed.db))[0]?.[1]).toBe("failed");
  expect(ran).toBe(1);
});
