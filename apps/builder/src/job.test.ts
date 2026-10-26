import { mkdir, mkdtemp, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { lendToken, memoryStorage, now, PRIORITY, readManifest, schema, settleRepository, type BuildJob, type Db, type Loaded, type Queue, type SurvivalJob } from "@commitscape/server";
import type { Config } from "./config";
import { inUse, sweep } from "./disk";
import { fakePerson, flagOf, writeBuilt, type FakeBuild } from "./fake";
import { MORE_LINES_AFTER, MORE_LINES_MAX, runJob, type JobContext } from "./job";
import { BUILD_ATTEMPTS, type Ran } from "./run";
import { queueSeeds } from "./seeds";
import type { Telemetry, Who } from "./telemetry";

const { builds, repoPeople, repositories, storedIndexes, surviving } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const ok: Ran = { code: 0, stderr: "", timedOut: false };

function tools(built: FakeBuild | ((args: string[]) => FakeBuild) = {}, then: (cmd: string, args: string[]) => Ran | Promise<Ran> = () => ok) {
  return async (cmd: string, args: string[]): Promise<Ran> => {
    const ran = await then(cmd, args);
    if (ran.code !== 0) return ran;
    if (cmd === "git" && args[0] === "clone") await mkdir(join(args.at(-1) ?? "", ".git"), { recursive: true });
    if (args[0] === "signatures") await writeFile(flagOf(args, "--out") ?? "", "[]");
    if (args[0] === "build") await writeBuilt(args, typeof built === "function" ? built(args) : built);
    return ran;
  };
}

function loader(db: Db) {
  return async (repoId: string, dir: string): Promise<Loaded> => {
    const m = await readManifest(dir);
    const fields = { lineage: m.lineage, kept: m.kept, head: m.head, frontier: m.frontier, lines: m.lines_mainline, linesLeft: m.lines_left, commits: m.total, state: "live", loadedAt: now() };
    let si: number;
    if (m.full) {
      const [row] = await db
        .insert(storedIndexes)
        .values({ repoId, builtAt: now(), ...fields })
        .returning({ id: storedIndexes.id });
      si = row?.id ?? 0;
      await db.delete(storedIndexes).where(and(eq(storedIndexes.repoId, repoId), ne(storedIndexes.id, si)));
      await db.update(repositories).set({ indexId: si }).where(eq(repositories.id, repoId));
    } else {
      const [repo] = await db.select({ indexId: repositories.indexId }).from(repositories).where(eq(repositories.id, repoId));
      si = repo?.indexId ?? 0;
      await db.update(storedIndexes).set(fields).where(eq(storedIndexes.id, si));
    }
    return { si, full: m.full, commits: m.commits, total: m.total, mainline: 0, lines: 0, seconds: 0 };
  };
}

type Captured = [string, Who, Record<string, unknown>];

async function context(db: Db, over: Partial<JobContext> = {}, built: FakeBuild | ((args: string[]) => FakeBuild) = {}): Promise<JobContext & { storage: ReturnType<typeof memoryStorage>; captured: Captured[] }> {
  const work = await mkdtemp(join(tmpdir(), "builder-"));
  const cfg: Config = { bin: "commitscape", threads: undefined, linesBudget: 120, nice: 10, work, concurrency: 1, maxMb: undefined, timeLimit: 60, cloneLimit: 120, largeMb: 1500, largeConcurrency: 1, logins: 300, diskGb: 20, gitBase: undefined };
  const captured: Captured[] = [];
  const telemetry: Telemetry = { capture: (event, who, properties) => void captured.push([event, who, properties]), stop: async () => {} };
  return {
    db,
    storage: memoryStorage(),
    cfg,
    app: null,
    run: tools(built),
    loadIndex: loader(db),
    telemetry,
    captured,
    github: { api: "http://github.test", token: null, fetcher: (async () => new Response("", { status: 404 })) as unknown as typeof fetch },
    log: () => {},
    ...over,
  } as JobContext & { storage: ReturnType<typeof memoryStorage>; captured: Captured[] };
}

const repoRow = async (db: Db, id = "acme/rocket") => (await db.select().from(repositories).where(eq(repositories.id, id)))[0];
const packs = (ctx: { storage: ReturnType<typeof memoryStorage> }) => [...ctx.storage.objects.keys()].filter((k) => k.startsWith("packs/")).sort();

test("a Build publishes its Stored Index: the pack in R2 and on the Stored Index, the Report's meta and stats on the repository, its people, and the old Report's objects deleted", async () => {
  const db = await database();
  const ctx = await context(db, {}, { people: [fakePerson(1, "ada", 5), fakePerson(2, null, 3)] });
  await ctx.storage.put("reports/gh/acme/rocket/old/index.json", "{}", { type: "application/json" });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, reportKey: "reports/gh/acme/rocket/old", reportLines: true });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);

  const repo = await repoRow(db);
  expect(repo).toMatchObject({ reportKey: "reports/gh/acme/rocket/b1", reportLines: true, busFactor: 1, codeLines: 40, maintainers: 1, commits30d: 3 });
  expect(repo?.reportMeta).toEqual({ name: "rocket", windows: ["all"], window: "all", anchor: 1, history: "complete", lines: "counted", avatars: false });
  expect(repo?.reportStats).toMatchObject({ commits: 3, people: 2, bus_factor: 1 });
  const [si] = await db.select().from(storedIndexes).where(eq(storedIndexes.repoId, "acme/rocket"));
  expect(repo?.indexId).toBe(si?.id);
  expect(si?.pack).toBe(`packs/acme/rocket/${si?.id}/${"a".repeat(40)}-b1-lines.pack`);
  expect(packs(ctx)).toEqual([si?.pack]);
  expect(repo?.reportBytes).toBe(ctx.storage.objects.get(si?.pack ?? "")?.body.length);
  expect((await db.select().from(repoPeople)).map((p) => [p.personId, p.login, p.commits, p.linesAdded, p.reportKey])).toEqual([
    [1, "ada", 5, 10, "reports/gh/acme/rocket/b1"],
    [2, null, 3, 20, "reports/gh/acme/rocket/b1"],
  ]);
  expect(await db.select().from(builds)).toMatchObject([{ state: "done", step: null, partial: false }]);
  expect([...ctx.storage.objects.keys()].filter((k) => k.startsWith("reports/"))).toEqual([]);
  expect(ctx.captured.map((c) => c[0])).toEqual(["build started", "build done"]);
  expect(ctx.captured.at(-1)?.[1]).toEqual({ userId: undefined, repo: "acme/rocket" });
  expect(ctx.captured.at(-1)?.[2]).toMatchObject({ kind: "cold", commits: 3, lines_left: 0 });
  expect(Object.keys(ctx.captured.at(-1)?.[2] ?? {})).toEqual(expect.arrayContaining(["seconds_clone_full", "seconds_build_full", "seconds_load_full", "seconds_upload_full", "seconds_publish_full"]));
});

test("a repository with no Report gets the quick Stored Index without lines while its lines are counted, then the same one with them", async () => {
  const db = await database();
  const seen: unknown[] = [];
  const ctx = await context(db);
  ctx.run = tools({}, async (cmd, args) => {
    if (cmd === "git" && args[0] === "clone" && !args.includes("--filter=blob:none")) {
      for (let i = 0; i < 100 && !(await repoRow(db))?.reportKey; i++) await new Promise((r) => setTimeout(r, 50));
    }
    if (args[0] === "build" && !args.includes("--no-lines")) {
      const repo = await repoRow(db);
      const [build] = await db.select().from(builds);
      const [si] = await db.select().from(storedIndexes);
      seen.push([repo?.reportKey, repo?.reportLines, repo?.reportMeta?.lines, build?.state, build?.partial, si?.pack?.endsWith("-quick.pack"), packs(ctx).length]);
    }
    return ok;
  });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10 });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx, 1, { userId: "u1" });
  expect(seen).toEqual([["reports/gh/acme/rocket/b1-quick", false, "counting", "running", true, true, 1]]);
  const repo = await repoRow(db);
  expect(repo).toMatchObject({ reportKey: "reports/gh/acme/rocket/b1", reportLines: true });
  expect(await db.select().from(storedIndexes)).toHaveLength(1);
  const [si] = await db.select().from(storedIndexes);
  expect(packs(ctx)).toEqual([`packs/acme/rocket/${si?.id}/${"a".repeat(40)}-b1-lines.pack`]);
  expect(await db.select().from(builds)).toMatchObject([{ state: "done", partial: false, reason: null }]);
  expect(ctx.captured.map((c) => c[0])).toEqual(["build started", "build quick published", "build done"]);
  expect(ctx.captured.every((c) => c[1].userId === "u1")).toBe(true);
});

test("a full build that fails leaves the quick Stored Index published, says why, and stops saying lines are being counted", async () => {
  const db = await database();
  const ctx = await context(db);
  ctx.run = tools({}, (_cmd, args) => (args[0] === "build" && !args.includes("--no-lines") ? { code: 101, stderr: "thread panicked\nout of memory", timedOut: false } : ok));
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10 });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  expect(await db.select().from(builds)).toMatchObject([{ state: "done", partial: true, reason: "error", detail: "out of memory" }]);
  const repo = await repoRow(db);
  expect(repo).toMatchObject({ reportKey: "reports/gh/acme/rocket/b1-quick", reportLines: false });
  expect(repo?.reportMeta?.lines).toBe("off");
  expect(ctx.captured.map((c) => c[0])).toEqual(["build started", "build quick published", "build failed"]);
});

test("lines show once the Mainline's are counted; commits still left are counted by quiet Builds queued a few times, which keep the Report's version while its head stays", async () => {
  const db = await database();
  const queued: [BuildJob & { attempt: number }, number, number | undefined][] = [];
  const counts: SurvivalJob[] = [];
  let left = 40;
  const ctx = await context(db, { queueBuild: async (job, priority, startAfter) => void queued.push([job, priority, startAfter]), queueCounts: async (job) => void counts.push(job) }, () => ({ left, people: [fakePerson(1, "ada", 5)] }));
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, seed: true });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  let repo = await repoRow(db);
  expect(repo).toMatchObject({ reportKey: "reports/gh/acme/rocket/b1", reportLines: true });
  expect(repo?.reportMeta?.lines).toBe("counted");
  expect(await db.select({ lines: storedIndexes.lines, left: storedIndexes.linesLeft }).from(storedIndexes)).toEqual([{ lines: true, left: 40 }]);
  expect((await db.select().from(repoPeople))[0]?.linesAdded).toBe(10);
  expect(queued).toHaveLength(1);
  const [job, priority, after] = queued[0] ?? [];
  expect(job).toMatchObject({ repoId: "acme/rocket", attempt: 1, more: 1 });
  expect([priority, after]).toEqual([PRIORITY.lines, MORE_LINES_AFTER]);
  expect(await db.select({ state: builds.state }).from(builds).where(eq(builds.id, job?.buildId ?? ""))).toEqual([{ state: "queued" }]);
  expect(counts).toHaveLength(1);

  left = 10;
  for (let more = 1; more <= MORE_LINES_MAX; more++) {
    const next = queued.at(-1)?.[0];
    await runJob(next?.buildId ?? "", ctx, 1, { more });
  }
  repo = await repoRow(db);
  expect(repo?.reportKey).toBe("reports/gh/acme/rocket/b1");
  const [si] = await db.select().from(storedIndexes);
  expect(packs(ctx)).toEqual([si?.pack]);
  expect(si?.pack).toContain(queued.at(-1)?.[0].buildId);
  expect(queued.map((q) => q[0].more)).toEqual([1, 2, 3]);
  expect(counts).toHaveLength(1);
  expect(repo?.reportMeta?.lines).toBe("counted");
  const last = await db.select({ state: builds.state }).from(builds).where(eq(builds.id, queued.at(-1)?.[0].buildId ?? ""));
  expect(last).toEqual([{ state: "done" }]);
});

test("a Build whose budget ran out before the Mainline's lines were counted shows no lines yet and says they are being counted", async () => {
  const db = await database();
  const ctx = await context(db, { queueBuild: async () => {} }, { left: 900, mainline: false });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10 });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  const repo = await repoRow(db);
  expect(repo).toMatchObject({ reportLines: false });
  expect(repo?.reportMeta?.lines).toBe("counting");
  expect((await db.select().from(repoPeople))[0]?.linesAdded).toBeNull();
  expect(await db.select({ lines: storedIndexes.lines }).from(storedIndexes)).toEqual([{ lines: false }]);
});

test("a Build that throws after commitscape has run still ends, and one claimed twice runs once", async () => {
  const db = await database();
  let built = 0;
  const ctx = await context(db, {
    log: (line) => {
      if (/: (full|quick|nothing) published/.test(line)) throw new Error("log down");
    },
  });
  const run = ctx.run;
  ctx.run = async (cmd, args, env, t) => {
    if (args[0] === "build") built++;
    return run(cmd, args, env, t);
  };
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, reportKey: "r/old", reportLines: true });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await Promise.all([runJob("b1", ctx), runJob("b1", ctx)]);
  expect(await db.select().from(builds)).toMatchObject([{ state: "done" }]);
  expect(built).toBe(1);
});

test("a Build of a repository found renamed while it ran stores its Report and people under the current name", async () => {
  const db = await database();
  const ctx = await context(db, {}, { people: [fakePerson(1, "dan", 5)] });
  await db.insert(repositories).values({ id: "facebook/react", owner: "facebook", name: "react", githubId: 10, sizeKb: 10 });
  await db.insert(builds).values({ id: "b9", repoId: "facebook/react", state: "queued", requestedAt: 1 });
  const run = ctx.run;
  ctx.run = async (cmd, args, env, t) => {
    if (args[0] === "build" && !args.includes("--no-lines")) await settleRepository(db, ctx.storage, { githubId: 10, owner: "react", name: "react" });
    return run(cmd, args, env, t);
  };
  await runJob("b9", ctx);
  const rows = await db.select().from(repositories);
  expect(rows.map((r) => [r.id, r.reportKey])).toEqual([["react/react", "reports/gh/react/react/b9"]]);
  expect((await db.select().from(repoPeople)).map((p) => [p.repoId, p.login])).toEqual([["react/react", "dan"]]);
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
      return ok;
    },
  });
  await db.insert(repositories).values({ id: "acme/secret", owner: "acme", name: "secret", isPrivate: true, installationId: 7 });
  await db.insert(builds).values({ id: "b2", repoId: "acme/secret", state: "queued", requestedAt: 1 });
  await runJob("b2", ctx);
  const [build] = await db.select().from(builds).where(eq(builds.id, "b2"));
  expect(build).toMatchObject({ state: "failed", reason: "private" });
  expect(ran).toBe(0);
  expect(ctx.captured.at(-1)?.[1].repo).toMatch(/^private:[0-9a-f]{16}$/);
});

test("a public repository is cloned without the token lent for its Build, so a repository gone private since cannot be read with someone's own access", async () => {
  const db = await database();
  const envs: NodeJS.ProcessEnv[] = [];
  const base = tools();
  const ctx = await context(db, {
    tokenSecret: "s".repeat(32),
    run: async (cmd, args, env) => {
      if (cmd === "git") envs.push(env);
      return base(cmd, args);
    },
  });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10 });
  await db.insert(schema.user).values({ id: "u1", name: "Ada", email: "ada@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  await lendToken(db, "s".repeat(32), "acme/rocket", "u1", "ghu_lent");
  await db.insert(builds).values({ id: "b9", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b9", ctx);
  expect(envs.length).toBeGreaterThan(0);
  expect(envs.some((e) => Object.values(e).some((v) => typeof v === "string" && v.includes(Buffer.from("x-access-token:ghu_lent").toString("base64"))))).toBe(false);
});

test("a seed repository's Build asks for the Surviving Lines of its people with most commits, bots and people with no login left out", async () => {
  const db = await database();
  const people = [fakePerson(1, "bot[bot]", 900), fakePerson(2, null, 800), ...Array.from({ length: 34 }, (_, i) => fakePerson(10 + i, `p${i}`, 100 - i))];
  const asked: SurvivalJob[] = [];
  const ctx = await context(db, { queueCounts: async (job) => void asked.push(job) }, { people });
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
        return ok;
      }
      if (args[0] === "build") limits.push(t);
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

  await runJob("b5", ctx, 2, { userId: "u1" });
  expect(again.at(-1)).toEqual([{ buildId: "b5", repoId: "acme/huge", attempt: 3, userId: "u1" }, 10]);
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
