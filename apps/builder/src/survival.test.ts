import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { memoryStorage, schema, type Db, type SurvivalJob } from "@commitscape/server";
import type { JobContext } from "./job";
import type { Ran } from "./run";
import { budgetOf, runSurvival, SURVIVING_BUDGET_MAX } from "./survival";

const { repositories, surviving } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function setup(run: (cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<Ran>, over: Partial<typeof repositories.$inferInsert> = {}, queued: SurvivalJob[] = []) {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", reportKey: "r/b1", reportLines: true, ...over });
  await db.insert(surviving).values([3, 4].map((personId) => ({ repoId: "acme/rocket", reportKey: "r/b1", personId, status: "queued", askedAt: 1 })));
  const work = await mkdtemp(join(tmpdir(), "survival-"));
  const ctx = { db, storage: memoryStorage(), cfg: { bin: "commitscape", work, concurrency: 1, maxMb: undefined, timeLimit: 60, diskGb: 20, gitBase: undefined }, app: null, run, github: { api: "x", token: null }, log: () => {}, queueCounts: async (job: SurvivalJob) => void queued.push(job), budget: 60 } as JobContext & { budget: number };
  return { db, ctx };
}

const rows = async (db: Db) => (await db.select().from(surviving)).sort((a, b) => a.personId - b.personId).map((r) => [r.personId, r.status, r.lines, r.added, r.head]);
const oldestOf = async (db: Db, id: number) => (await db.select().from(surviving)).find((r) => r.personId === id)?.oldest;

test("each person's count is recorded at the Report's head; one over budget gets no number and is asked again with twice the budget", async () => {
  let asked: string[] = [];
  const queued: SurvivalJob[] = [];
  const { db, ctx } = await setup(async (_cmd, args) => {
    asked = args;
    return { code: 0, stderr: "", timedOut: false, stdout: JSON.stringify({ head: "a".repeat(40), people: [{ id: 3, name: "Alice", status: "counted", surviving: 75, added: 120, files: 4, oldest: 1_500_000_000, seconds: 0.5 }, { id: 4, name: "Bob", status: "over_budget", surviving: null, added: 30, files: 9, seconds: 60 }] }) };
  }, {}, queued);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4] }, ctx);
  expect(queued).toEqual([{ repoId: "acme/rocket", reportKey: "r/b1", personIds: [4], attempt: 1 }]);
  expect((await rows(db))[1]?.[1]).toBe("queued");
  expect(asked).toEqual(["surviving", "--budget-seconds", "60", "--cache-dir", ctx.cfg.work, "--offline", "--person", "3", "--person", "4", "--", "acme/rocket"]);
  await mkdir(join(ctx.cfg.work, "clones", "acme", "rocket"), { recursive: true });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, ctx);
  expect(asked.at(-1)).toBe(join(ctx.cfg.work, "clones", "acme", "rocket"));
  expect(await rows(db)).toEqual([
    [3, "counted", 75, 120, "a".repeat(40)],
    [4, "queued", null, 30, "a".repeat(40)],
  ]);
  expect(await oldestOf(db, 3)).toBe(1_500_000_000);
  expect(await oldestOf(db, 4)).toBeNull();
});

test("a Report replaced since it was asked is stale, one read without lines is still counted, and a failure says so", async () => {
  let ran = 0;
  const count = async (): Promise<Ran> => {
    ran++;
    return { code: 1, stderr: "boom", timedOut: false, stdout: "" };
  };
  const stale = await setup(count, { reportKey: "r/b2" });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, stale.ctx);
  expect((await rows(stale.db))[0]?.[1]).toBe("stale");
  expect(ran).toBe(0);
  const partial = await setup(count, { reportLines: false });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, partial.ctx);
  expect((await rows(partial.db))[0]?.[1]).toBe("failed");
  expect(ran).toBe(1);
  const failed = await setup(count);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, failed.ctx);
  expect((await rows(failed.db))[0]?.[1]).toBe("failed");
  expect(ran).toBe(2);
});

test("a count stopped past its time is asked again per person with a doubled budget, its loading given its own time, until the budget reaches four hours", async () => {
  const timers: number[] = [];
  const budgets: string[] = [];
  const queued: SurvivalJob[] = [];
  const { db, ctx } = await setup(async (_cmd, args, _env, timeoutMs) => {
    timers.push(timeoutMs);
    budgets.push(args[args.indexOf("--budget-seconds") + 1] ?? "");
    return { code: null, stderr: "", timedOut: true, stdout: "" };
  }, {}, queued);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4] }, ctx);
  expect(timers[0]).toBe((60 * 2 + ctx.cfg.timeLimit) * 1000);
  expect(queued).toEqual([
    { repoId: "acme/rocket", reportKey: "r/b1", personIds: [3], attempt: 1 },
    { repoId: "acme/rocket", reportKey: "r/b1", personIds: [4], attempt: 1 },
  ]);
  expect((await rows(db)).map((r) => r[1])).toEqual(["queued", "queued"]);

  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3], attempt: 1 }, ctx);
  expect(budgets[1]).toBe("120");
  expect(timers[1]).toBe((120 + ctx.cfg.timeLimit) * 1000);
  expect(queued.at(-1)).toEqual({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3], attempt: 2 });

  const last = Math.ceil(Math.log2(SURVIVING_BUDGET_MAX / 60));
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3], attempt: last }, ctx);
  expect(budgets[2]).toBe(String(SURVIVING_BUDGET_MAX));
  expect(queued).toHaveLength(3);
  expect((await rows(db))[0]?.[1]).toBe("over_budget");
  expect([0, 1, 2, last, last + 5].map((a) => budgetOf(60, a))).toEqual([60, 120, 240, SURVIVING_BUDGET_MAX, SURVIVING_BUDGET_MAX]);
});
