import { mkdir, mkdtemp, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { memoryStorage, now, readEntry, readIndex, schema, settleRepository, type BuildJob, type Db, type Queue, type SurvivalJob } from "@commitscape/server";
import type { Config } from "./config";
import { inUse, sweep } from "./disk";
import { runJob, type JobContext } from "./job";
import { BUILD_ATTEMPTS, type Ran } from "./run";
import { queueSeeds } from "./seeds";

const { builds, commits, repositories, surviving } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const report = {
  meta: { name: "rocket", windows: ["all"], window: "all", anchor: 1, history: "complete", lines: "counted", github: "ready", github_history: "off", avatars: true },
  data: { "/api/overview?window=all": { window: "all" } },
  cards: { all: "<svg/>" },
  stats: { commits: 3, people: 2, bus_factor: 1, maintainers: 1, commits_30d: 3, people_30d: 2, code_lines: 40, untouched_5y: 0 },
};

const commitList = (n: number) => ({
  link: null,
  lines: true,
  kinds: ["other"],
  people: [{ person: { id: 1, name: "Ada", login: "ada" }, emails: [] }],
  ids: Array.from({ length: n }, (_, i) => String(i).padStart(40, "0")),
  times: Array.from({ length: n }, () => 1),
  offsets: Array.from({ length: n }, () => 0),
  person: Array.from({ length: n }, () => 0),
  subjects: Array.from({ length: n }, (_, i) => `commit ${i}`),
  kind: Array.from({ length: n }, () => 0),
  merge: Array.from({ length: n }, () => false),
  files: Array.from({ length: n }, () => 1),
  added: Array.from({ length: n }, () => 1),
  removed: Array.from({ length: n }, () => 0),
});

const person = (id: number, login: string | null, commits: number) => ({ person: { id, name: `P${id}`, login }, commits, lines_added: 1, lines_removed: 0, first: 1, last: 2 });

const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

/** A stand-in for git and commitscape: clones make a folder, signatures name nobody, and reports write `written`, the quick one with fewer commits. */
function tools(written: object, then: (cmd: string, args: string[]) => Ran | Promise<Ran> = () => ({ code: 0, stderr: "", timedOut: false })) {
  return async (cmd: string, args: string[]): Promise<Ran> => {
    const ran = await then(cmd, args);
    if (ran.code !== 0) return ran;
    if (cmd === "git" && args[0] === "clone") await mkdir(join(args.at(-1) ?? "", ".git"), { recursive: true });
    if (args[0] === "signatures") await writeFile(flag(args, "--out") ?? "", "[]");
    if (args[0] === "report") {
      await writeFile(flag(args, "--out") ?? "", gzipSync(JSON.stringify(written)));
      await writeFile(flag(args, "--commits-out") ?? "", gzipSync(JSON.stringify(commitList(args.includes("--no-lines") ? 2 : 3))));
    }
    return ran;
  };
}

async function context(db: Db, over: Partial<JobContext> = {}, written: object = report): Promise<JobContext & { storage: ReturnType<typeof memoryStorage> }> {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const cfg: Config = { bin: "commitscape", work, concurrency: 1, maxMb: undefined, timeLimit: 60, cloneLimit: 120, largeMb: 1500, largeConcurrency: 1, logins: 300, diskGb: 20, gitBase: undefined };
  return { db, storage: memoryStorage(), cfg, app: null, run: tools(written), github: { api: "http://github.test", token: null, fetcher: (async () => new Response("", { status: 404 })) as unknown as typeof fetch }, log: () => {}, ...over } as JobContext & {
    storage: ReturnType<typeof memoryStorage>;
  };
}

test("a Build stores its Report an answer at a time and replaces the one before", async () => {
  const db = await database();
  const ctx = await context(db);
  await ctx.storage.put("reports/gh/acme/rocket/old/index.json", "{}", { type: "application/json" });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, reportKey: "reports/gh/acme/rocket/old" });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, "acme/rocket"));
  expect(repo).toMatchObject({ reportKey: "reports/gh/acme/rocket/b1", reportLines: true, busFactor: 1, codeLines: 40 });
  const [build] = await db.select().from(builds).where(eq(builds.id, "b1"));
  expect(build).toMatchObject({ state: "done", step: null, partial: false });
  expect((await readIndex(ctx.storage, "reports/gh/acme/rocket/b1"))?.keys).toEqual(["/api/overview?window=all"]);
  expect(await readEntry(ctx.storage, "reports/gh/acme/rocket/b1", "/api/overview?window=all")).toEqual({ window: "all" });
  expect(ctx.storage.objects.has("reports/gh/acme/rocket/old/index.json")).toBe(false);

  expect([...ctx.storage.objects.keys()].some((k) => k.includes("b1-quick"))).toBe(false);
  expect((await db.select().from(commits)).map((c) => c.reportKey)).toEqual(Array(3).fill("reports/gh/acme/rocket/b1"));

  await runJob("b1", ctx);
  expect([...ctx.storage.objects.keys()].filter((k) => k.endsWith("index.json"))).toHaveLength(1);
});

test("a repository with no Report gets the quick one without lines while its lines are counted, then the full one in its place", async () => {
  const db = await database();
  const seen: unknown[] = [];
  const ctx = await context(db);
  ctx.run = tools(report, async (cmd, args) => {
    if (cmd === "git" && !args.includes("--filter=blob:none")) {
      for (let i = 0; i < 100 && !(await db.select().from(repositories))[0]?.reportKey; i++) await new Promise((r) => setTimeout(r, 50));
    }
    if (args[0] === "report" && !args.includes("--no-lines")) {
      const [repo] = await db.select().from(repositories);
      const [build] = await db.select().from(builds);
      seen.push([repo?.reportKey, repo?.reportLines, build?.state, build?.partial, (await db.select().from(commits)).length]);
    }
    return { code: 0, stderr: "", timedOut: false };
  });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10 });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  expect(seen).toEqual([["reports/gh/acme/rocket/b1-quick", false, "running", true, 2]]);
  const [repo] = await db.select().from(repositories);
  expect(repo).toMatchObject({ reportKey: "reports/gh/acme/rocket/b1", reportLines: true });
  expect(await db.select().from(builds)).toMatchObject([{ state: "done", partial: false, reason: null }]);
  expect((await db.select().from(commits)).map((c) => c.reportKey)).toEqual(Array(3).fill("reports/gh/acme/rocket/b1"));
  expect([...ctx.storage.objects.keys()].some((k) => k.includes("b1-quick"))).toBe(false);
});

test("a full Report that fails leaves the quick one published and says why", async () => {
  const db = await database();
  const ctx = await context(db);
  ctx.run = tools(report, (_cmd, args) => (args[0] === "report" && !args.includes("--no-lines") ? { code: 101, stderr: "thread panicked\nout of memory", timedOut: false } : { code: 0, stderr: "", timedOut: false }));
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10 });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  expect(await db.select().from(builds)).toMatchObject([{ state: "done", partial: true, reason: "error", detail: "out of memory" }]);
  expect(await db.select().from(repositories)).toMatchObject([{ reportKey: "reports/gh/acme/rocket/b1-quick", reportLines: false }]);
});

test("a Build that throws after commitscape has run still ends, and one claimed twice runs once", async () => {
  const db = await database();
  let reports = 0;
  const ctx = await context(db, {
    log: (line) => {
      if (/: (full|quick|nothing) published/.test(line)) throw new Error("log down");
    },
  });
  const run = ctx.run;
  ctx.run = async (cmd, args, env, t) => {
    if (args[0] === "report") reports++;
    return run(cmd, args, env, t);
  };
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, reportKey: "r/old" });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await Promise.all([runJob("b1", ctx), runJob("b1", ctx)]);
  expect(await db.select().from(builds)).toMatchObject([{ state: "failed", reason: "error" }]);
  expect(reports).toBe(2);
});

test("a Build of a repository found renamed while it ran stores its Report and people under the current name", async () => {
  const db = await database();
  const ctx = await context(db, {}, { ...report, data: { ...report.data, "/api/people?window=all": { people: [person(1, "dan", 5)] } } });
  await db.insert(repositories).values({ id: "facebook/react", owner: "facebook", name: "react", githubId: 10, sizeKb: 10 });
  await db.insert(builds).values({ id: "b9", repoId: "facebook/react", state: "queued", requestedAt: 1 });
  const run = ctx.run;
  ctx.run = async (cmd, args, env, t) => {
    await settleRepository(db, ctx.storage, { githubId: 10, owner: "react", name: "react" });
    return run(cmd, args, env, t);
  };
  await runJob("b9", ctx);
  const rows = await db.select().from(repositories);
  expect(rows.map((r) => [r.id, r.reportKey])).toEqual([["react/react", "reports/gh/react/react/b9"]]);
  expect((await db.select().from(schema.repoPeople)).map((p) => [p.repoId, p.login])).toEqual([["react/react", "dan"]]);
  expect((await db.select().from(builds)).map((b) => [b.repoId, b.state])).toEqual([["react/react", "done"]]);
});

test("seeds are kept under the name GitHub's search gives, and a row under an older name moves there", async () => {
  const db = await database();
  const storage = memoryStorage();
  await db.insert(repositories).values({ id: "facebook/react", owner: "facebook", name: "react", githubId: 10, reportKey: "reports/gh/facebook/react/b1", reportAt: now() });
  const sent: string[] = [];
  const queue: Queue = { send: async (job) => void sent.push(job.buildId) };
  await queueSeeds(db, queue, [{ owner: "react", name: "react", language: "JavaScript", stars: 9, sizeKb: 10, githubId: 10 }, { owner: "a", name: "one", language: "Rust", stars: 1, sizeKb: 1 }], 5, storage);
  const rows = await db.select().from(repositories);
  expect(rows.map((r) => [r.id, r.seed, r.reportKey]).sort()).toEqual([
    ["a/one", true, null],
    ["react/react", true, "reports/gh/facebook/react/b1"],
  ]);
  expect((await db.select().from(builds)).map((b) => b.repoId)).toEqual(["a/one"]);
});

test("a private repository with no installation token fails as private and reads nothing", async () => {
  const db = await database();
  let ran = 0;
  const ctx = await context(db, {
    run: async () => {
      ran++;
      return { code: 0, stderr: "", timedOut: false };
    },
  });
  await db.insert(repositories).values({ id: "acme/secret", owner: "acme", name: "secret", isPrivate: true, installationId: 7 });
  await db.insert(builds).values({ id: "b2", repoId: "acme/secret", state: "queued", requestedAt: 1 });
  await runJob("b2", ctx);
  const [build] = await db.select().from(builds).where(eq(builds.id, "b2"));
  expect(build).toMatchObject({ state: "failed", reason: "private" });
  expect(ran).toBe(0);
});

test("a seed repository's Build asks for the Surviving Lines of its people with most commits, bots and people with no login left out", async () => {
  const db = await database();
  const people = [person(1, "bot[bot]", 900), person(2, null, 800), ...Array.from({ length: 34 }, (_, i) => person(10 + i, `p${i}`, 100 - i))];
  const asked: SurvivalJob[] = [];
  const ctx = await context(db, { queueCounts: async (job) => void asked.push(job) }, { ...report, data: { ...report.data, "/api/people?window=all": { people } } });
  await db.insert(repositories).values({ id: "acme/seed", owner: "acme", name: "seed", sizeKb: 10, seed: true });
  await db.insert(builds).values({ id: "b3", repoId: "acme/seed", state: "queued", requestedAt: 1 });
  await runJob("b3", ctx);
  expect(asked.map((j) => j.personIds.length)).toEqual([10, 10, 10]);
  expect(asked.flatMap((j) => j.personIds)).toEqual(Array.from({ length: 30 }, (_, i) => 10 + i));
  expect(asked.every((j) => j.reportKey === "reports/gh/acme/seed/b3")).toBe(true);
  expect(await db.select({ status: surviving.status }).from(surviving)).toHaveLength(30);

  await db.insert(repositories).values({ id: "acme/other", owner: "acme", name: "other", sizeKb: 10 });
  await db.insert(builds).values({ id: "b4", repoId: "acme/other", state: "queued", requestedAt: 1 });
  await runJob("b4", ctx);
  expect(asked).toHaveLength(3);
});

test("a Build past its time limit is queued again to go on from the lines it counted, until its last attempt fails", async () => {
  const db = await database();
  const again: [BuildJob, number][] = [];
  const limits: number[] = [];
  const ctx = await context(db, {
    run: async (cmd, args, _env, t) => {
      if (cmd === "git") {
        if (args[0] === "clone") await mkdir(join(args.at(-1) ?? "", ".git"), { recursive: true });
        return { code: 0, stderr: "", timedOut: false };
      }
      if (args[0] === "report") limits.push(t);
      return { code: null, stderr: "", timedOut: true };
    },
    queueBuild: async (job, priority) => void again.push([job, priority]),
  });
  await db.insert(repositories).values({ id: "acme/huge", owner: "acme", name: "huge", sizeKb: 50_000_000 });
  await db.insert(builds).values({ id: "b5", repoId: "acme/huge", state: "queued", requestedAt: 1 });
  await runJob("b5", ctx);
  expect(again).toEqual([[{ buildId: "b5", repoId: "acme/huge", attempt: 2 }, 10]]);
  const [queued] = await db.select().from(builds).where(eq(builds.id, "b5"));
  expect(queued).toMatchObject({ state: "queued", step: null, reason: null });
  expect(queued?.requestedAt).toBeGreaterThan(1);

  await runJob("b5", ctx, 2);
  expect(again.at(-1)).toEqual([{ buildId: "b5", repoId: "acme/huge", attempt: 3 }, 10]);
  expect(limits[0]).toBe(60_000);
  expect(limits.at(-1)).toBe(120_000);

  await runJob("b5", ctx, BUILD_ATTEMPTS);
  expect(again).toHaveLength(2);
  const [failed] = await db.select().from(builds).where(eq(builds.id, "b5"));
  expect(failed).toMatchObject({ state: "failed", reason: "timed_out", detail: `${60 * 2 ** (BUILD_ATTEMPTS - 1)} s` });
});

test("a timed-out Build that cannot be queued again fails as timed out", async () => {
  const db = await database();
  const ctx = await context(db, {
    run: async () => ({ code: null, stderr: "", timedOut: true }),
    queueBuild: async () => {
      throw new Error("queue down");
    },
  });
  await db.insert(repositories).values({ id: "acme/huge", owner: "acme", name: "huge", sizeKb: 10 });
  await db.insert(builds).values({ id: "b6", repoId: "acme/huge", state: "queued", requestedAt: 1 });
  await runJob("b6", ctx);
  const [build] = await db.select().from(builds).where(eq(builds.id, "b6"));
  expect(build).toMatchObject({ state: "failed", reason: "timed_out" });
});

test("pruning leaves the folder of a public repository with a Build or Surviving Lines still to come", async () => {
  const db = await database();
  const ctx = await context(db);
  const work = await realpath(ctx.cfg.work);
  const cfg = { ...ctx.cfg, work };
  await db.insert(repositories).values([
    { id: "acme/building", owner: "acme", name: "building" },
    { id: "acme/counting", owner: "acme", name: "counting", reportKey: "r/c" },
    { id: "acme/done", owner: "acme", name: "done", reportKey: "r/d" },
    { id: "acme/secret", owner: "acme", name: "secret", isPrivate: true },
  ]);
  await db.insert(builds).values([
    { id: "b7", repoId: "acme/building", state: "running", requestedAt: now() },
    { id: "b8", repoId: "acme/done", state: "done", requestedAt: now() },
    { id: "b9", repoId: "acme/secret", state: "queued", requestedAt: now() },
  ]);
  await db.insert(surviving).values([
    { repoId: "acme/counting", reportKey: "r/c", personId: 1, status: "queued", askedAt: now() },
    { repoId: "acme/done", reportKey: "r/d", personId: 1, status: "counted", askedAt: now() },
  ]);
  const kept = await inUse(db, cfg);
  expect(kept.sort()).toEqual([join(work, "repos", "acme", "building"), join(work, "repos", "acme", "counting")]);
});

test("sweeping deletes private clones and scratch folders no open Build or running job owns, and what older Builders left", async () => {
  const db = await database();
  const ctx = await context(db);
  const work = ctx.cfg.work;
  await db.insert(repositories).values({ id: "acme/secret", owner: "acme", name: "secret", isPrivate: true });
  await db.insert(builds).values([
    { id: "open", repoId: "acme/secret", state: "queued", requestedAt: now() },
    { id: "ended", repoId: "acme/secret", state: "failed", requestedAt: now() },
  ]);
  for (const dir of ["private/open", "private/ended", "private/surviving-x", "jobs/ended", "clones/acme/rocket", "health/acme/rocket", "0123456789abcdef", "repos/acme/rocket"]) {
    await mkdir(join(work, dir), { recursive: true });
  }
  await sweep(db, ctx.cfg, ["surviving-x"]);
  expect((await readdir(work)).sort()).toEqual(["jobs", "private", "repos"]);
  expect((await readdir(join(work, "private"))).sort()).toEqual(["open", "surviving-x"]);
  expect(await readdir(join(work, "jobs"))).toEqual([]);
});
