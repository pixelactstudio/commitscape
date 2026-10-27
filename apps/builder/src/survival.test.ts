import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { memoryStorage, schema, type Db, type SurvivalJob } from "@commitscape/server";
import { holdingRepo } from "./disk";
import type { JobContext } from "./job";
import type { Ran } from "./run";
import { budgetOf, runSurvival, SURVIVING_BUDGET_MAX } from "./survival";

const { repositories, surviving } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function setup(run: (cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<Ran>, over: Partial<typeof repositories.$inferInsert> = {}, queued: SurvivalJob[] = [], clones: string[] = []) {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", reportKey: "r/b1", reportLines: true, ...over });
  await db.insert(surviving).values([3, 4].map((personId) => ({ repoId: "acme/rocket", reportKey: "r/b1", personId, status: "queued", askedAt: 1 })));
  const work = await mkdtemp(join(tmpdir(), "survival-"));
  const cloning = async (cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Ran> => {
    if (args[0] === "signatures") {
      await writeFile(args[args.indexOf("--out") + 1] ?? "", JSON.stringify([{ email: "ada@example.com", name: "Ada", commits: 4, sha: "b".repeat(40) }]));
      return { code: 0, stderr: "", timedOut: false };
    }
    if (cmd !== "git") return run(cmd, args, env, timeoutMs);
    if (args[0] !== "clone") return { code: 0, stderr: "", timedOut: false };
    clones.push(args.at(-1) ?? "");
    await mkdir(join(args.at(-1) ?? "", ".git"), { recursive: true });
    return { code: 0, stderr: "", timedOut: false };
  };
  const ctx = { db, storage: memoryStorage(), cfg: { bin: "commitscape", threads: undefined, linesBudget: 120, nice: 10, work, concurrency: 1, maxMb: undefined, timeLimit: 60, cloneLimit: 120, largeMb: 1500, largeConcurrency: 1, logins: 300, diskGb: 20, cacheGb: 5, engineMemoryMb: 1200, bulkFiles: 50, moreLinesBudget: 600, gitBase: undefined }, app: null, run: cloning, github: { api: "http://github.test", token: "t", fetcher: (async () => Response.json({ data: { repository: { c0: { author: { user: { login: "ada" } } } } } })) as unknown as typeof fetch }, log: () => {}, queueCounts: async (job: SurvivalJob) => void queued.push(job), budget: 60 } as JobContext & { budget: number };
  return { db, ctx };
}

const rows = async (db: Db) => (await db.select().from(surviving)).sort((a, b) => a.personId - b.personId).map((r) => [r.personId, r.status, r.lines, r.added, r.head]);
const oldestOf = async (db: Db, id: number) => (await db.select().from(surviving)).find((r) => r.personId === id)?.oldest;

const everyone = (people: unknown[], complete = true) => JSON.stringify({ head: "a".repeat(40), complete, files: 9, people });
const alice = { id: 3, name: "Alice", status: "counted", surviving: 75, added: 120, files: 4, oldest: 1_500_000_000, seconds: 0.5 };
const bob = { id: 4, name: "Bob", status: "counted", surviving: 0, added: 30, files: 0, oldest: null, seconds: 0.5 };
const carol = { id: 9, name: "Carol", status: "counted", surviving: 12, added: 12, files: 1, oldest: 1_600_000_000, seconds: 0.5 };

test("a count is everyone's, whoever asked: each person's answer is recorded at the Report's head, the people no one asked for too", async () => {
  let asked: string[] = [];
  const seen: unknown[] = [];
  const { db, ctx } = await setup(async (_cmd, args) => {
    asked = args;
    if (seen.length === 0) seen.push(JSON.parse(await readFile(args[args.indexOf("--accounts") + 1] ?? "", "utf8")));
    return { code: 0, stderr: "", timedOut: false, stdout: everyone([alice, bob, carol]) };
  });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, ctx);
  const home = join(ctx.cfg.work, "repos", "acme", "rocket");
  const accounts = asked[asked.indexOf("--accounts") + 1] ?? "";
  expect(asked).toEqual(["surviving", "--everyone", "--budget-seconds", "60", "--cache-dir", join(ctx.cfg.work, "caches", "acme", "rocket"), "--cache-key", "acme/rocket", "--offline", "--max-changeset-size", "50", "--accounts", accounts, "--", join(home, "full")]);
  expect(accounts.startsWith(join(ctx.cfg.work, "jobs", "surviving-"))).toBe(true);
  expect(seen).toEqual([{ "ada@example.com": "ada" }]);
  expect(await readdir(join(ctx.cfg.work, "jobs"))).toEqual([]);
  expect(await rows(db)).toEqual([
    [3, "counted", 75, 120, "a".repeat(40)],
    [4, "counted", 0, 30, "a".repeat(40)],
    [9, "counted", 12, 12, "a".repeat(40)],
  ]);
  expect(await oldestOf(db, 3)).toBe(1_500_000_000);
  expect(await oldestOf(db, 4)).toBeNull();
});

test("a count waits while another job holds the repository, and saves its State holding it too", async () => {
  const order: string[] = [];
  const { ctx } = await setup(async (_cmd, args) => {
    order.push(args[0] ?? "");
    return { code: 0, stderr: "", timedOut: false, stdout: everyone([alice, bob]) };
  });
  const home = join(ctx.cfg.work, "repos", "acme", "rocket");
  ctx.saveState = async () => void order.push("save");
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const other = holdingRepo(home, async () => {
    order.push("other starts");
    await pause(80);
    order.push("other ends");
  });
  await Promise.all([other, runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, ctx)]);
  expect(order).toEqual(["other starts", "other ends", "surviving", "save"]);
});

test("a count is asked for the Report's head, and one whose clone is at another records nothing", async () => {
  const asked: string[][] = [];
  const { db, ctx } = await setup(
    async (_cmd, args) => {
      asked.push(args);
      return { code: 3, stderr: "commitscape: the repository's head is b, not c\n", timedOut: false };
    },
    { reportHead: "c".repeat(40) },
  );
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4], everyone: true }, ctx);
  expect(asked.map((a) => a[a.indexOf("--head") + 1])).toEqual(["c".repeat(40)]);
  expect((await rows(db)).map((r) => r[1])).toEqual(["stale", "stale"]);
});

test("a count that comes back for another head than the Report's records nothing", async () => {
  const { db, ctx } = await setup(async () => ({ code: 0, stderr: "", timedOut: false, stdout: everyone([alice, bob]) }), { reportHead: "c".repeat(40) });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4], everyone: true }, ctx);
  expect((await rows(db)).map((r) => [r[1], r[2]])).toEqual([
    ["failed", null],
    ["failed", null],
  ]);
});

test("a count that waited while a Build published another Report counts nothing", async () => {
  const asked: string[][] = [];
  const { db, ctx } = await setup(async (_cmd, args) => {
    asked.push(args);
    return { code: 0, stderr: "", timedOut: false, stdout: everyone([alice, bob]) };
  });
  const home = join(ctx.cfg.work, "repos", "acme", "rocket");
  const building = holdingRepo(home, async () => {
    await new Promise((r) => setTimeout(r, 50));
    await db.update(repositories).set({ reportKey: "r/b2" });
  });
  await Promise.all([building, runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4], everyone: true }, ctx)]);
  expect(asked.filter((a) => a[0] === "surviving")).toEqual([]);
  expect((await rows(db)).map((r) => r[1])).toEqual(["stale", "stale"]);
});

test("a count that fails on a blobless clone is never recorded, and is made again from a full clone", async () => {
  const queued: SurvivalJob[] = [];
  const dirs: string[] = [];
  const clones: string[] = [];
  const { db, ctx } = await setup(
    async (_cmd, args) => {
      const dir = args.at(-1) ?? "";
      dirs.push(dir);
      return dir.endsWith("lean") ? { code: 1, stderr: "commitscape: could not fetch file contents 20a3 from the remote\n", timedOut: false } : { code: 0, stderr: "", timedOut: false, stdout: everyone([alice, bob]) };
    },
    {},
    queued,
    clones,
  );
  const home = join(ctx.cfg.work, "repos", "acme", "rocket");
  await mkdir(join(home, "lean", ".git"), { recursive: true });
  const job = { repoId: "acme/rocket", reportKey: "r/b1", personIds: [3], everyone: true };
  await runSurvival(job, ctx);
  expect(dirs).toEqual([join(home, "lean")]);
  expect(queued).toEqual([{ ...job, full: true }]);
  expect((await rows(db)).map((r) => r[1])).toEqual(["queued", "queued"]);
  await runSurvival(queued[0] ?? job, ctx);
  expect(dirs.at(-1)).toBe(join(home, "full"));
  expect(clones).toEqual([join(home, ".full.cloning")]);
  expect((await rows(db)).map((r) => [r[0], r[1], r[2]])).toEqual([
    [3, "counted", 75],
    [4, "counted", 0],
  ]);
});

test("ownership not whole within the budget is asked again for everyone with twice the budget, and its rows stay counting; past four hours they are over budget", async () => {
  const budgets: string[] = [];
  const timers: number[] = [];
  const queued: SurvivalJob[] = [];
  const { db, ctx } = await setup(async (_cmd, args, _env, timeoutMs) => {
    budgets.push(args[args.indexOf("--budget-seconds") + 1] ?? "");
    timers.push(timeoutMs);
    return { code: 0, stderr: "", timedOut: false, stdout: everyone([], false) };
  }, {}, queued);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [], everyone: true }, ctx);
  expect(timers[0]).toBe((60 + ctx.cfg.timeLimit) * 1000);
  expect(queued).toEqual([{ repoId: "acme/rocket", reportKey: "r/b1", personIds: [], everyone: true, attempt: 1 }]);
  expect((await rows(db)).map((r) => r[1])).toEqual(["queued", "queued"]);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4], everyone: true, attempt: 1 }, ctx);
  expect(budgets[1]).toBe("120");
  const last = Math.ceil(Math.log2(SURVIVING_BUDGET_MAX / 60));
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4], everyone: true, attempt: last }, ctx);
  expect(budgets[2]).toBe(String(SURVIVING_BUDGET_MAX));
  expect(queued).toHaveLength(2);
  expect((await rows(db)).map((r) => r[1])).toEqual(["over_budget", "over_budget"]);
  expect([0, 1, 2, last, last + 5].map((a) => budgetOf(60, a))).toEqual([60, 120, 240, SURVIVING_BUDGET_MAX, SURVIVING_BUDGET_MAX]);
});

test("a count stopped past its time is asked again, a Report replaced since it was asked is stale, and a failure says so", async () => {
  const queued: SurvivalJob[] = [];
  const stopped = await setup(async () => ({ code: null, stderr: "", timedOut: true, stdout: "" }), {}, queued);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, stopped.ctx);
  expect(queued).toEqual([{ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3], everyone: true, attempt: 1 }]);
  let ran = 0;
  const count = async (): Promise<Ran> => {
    ran++;
    return { code: 1, stderr: "boom", timedOut: false, stdout: "" };
  };
  const stale = await setup(count, { reportKey: "r/b2" });
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, stale.ctx);
  expect((await rows(stale.db))[0]?.[1]).toBe("stale");
  expect(ran).toBe(0);
  const failed = await setup(count);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, failed.ctx);
  expect((await rows(failed.db))[0]?.[1]).toBe("failed");
  expect(ran).toBe(1);
});

test("someone asked for who is not among the people counted is marked failed", async () => {
  const { db, ctx } = await setup(async () => ({ code: 0, stderr: "", timedOut: false, stdout: everyone([alice]) }));
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3, 4] }, ctx);
  expect((await rows(db)).map((r) => r[1])).toEqual(["counted", "failed"]);
});

test("a kept clone is used as it is, and one missing is cloned in full into the repository's folder", async () => {
  const clones: string[] = [];
  const { ctx } = await setup(async () => ({ code: 0, stderr: "", timedOut: false, stdout: everyone([]) }), {}, [], clones);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, ctx);
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [4] }, ctx);
  expect(clones).toHaveLength(1);
  expect(clones).toEqual([join(ctx.cfg.work, "repos", "acme", "rocket", ".full.cloning")]);
});

test("without signatures the count runs without accounts", async () => {
  let asked: string[] = [];
  const { ctx } = await setup(async (_cmd, args) => {
    asked = args;
    return { code: 0, stderr: "", timedOut: false, stdout: everyone([]) };
  });
  const real = ctx.run;
  ctx.run = async (cmd, args, env, t) => (args[0] === "signatures" ? { code: 2, stderr: "no", timedOut: false } : real(cmd, args, env, t));
  await runSurvival({ repoId: "acme/rocket", reportKey: "r/b1", personIds: [3] }, ctx);
  expect(asked[0]).toBe("surviving");
  expect(asked).not.toContain("--accounts");
});
