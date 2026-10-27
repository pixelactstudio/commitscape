import { mkdir, mkdtemp, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { atlasKey, BUILD_FORMAT, lendToken, memoryStorage, now, PRIORITY, readManifest, schema, settleRepository, type BuildJob, type Db, type Loaded, type Queue, type SurvivalJob } from "@commitscape/server";
import type { Config } from "./config";
import { cacheDir, inUse, sweep } from "./disk";
import { fakePerson, flagOf, writeBuilt, type FakeBuild } from "./fake";
import { MORE_LINES_AFTER, MORE_LINES_MAX, runJob, type JobAsked, type JobContext } from "./job";
import { BUILD_ATTEMPTS, type Ran } from "./run";
import { headsOf, queueSeeds, type Named } from "./seeds";
import { writeAtlas } from "./universe";
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
  const cfg: Config = { bin: "commitscape", threads: undefined, linesBudget: 120, nice: 10, work, concurrency: 1, maxMb: undefined, timeLimit: 60, cloneLimit: 120, largeMb: 1500, largeConcurrency: 1, logins: 300, diskGb: 20, cacheGb: 5, engineSlots: 1, bulkFiles: 50, moreLinesBudget: 600, gitBase: undefined };
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

test("a Build makes its pack's Atlas in a process of its own, under the engine's slot, and stores it before the pack is published, so the Site never makes it", async () => {
  const db = await database();
  const order: string[] = [];
  const base = tools();
  const ctx = await context(db, {
    run: async (cmd, args) => {
      if (cmd === "node-for-atlas") {
        order.push("atlas");
        const [, , rows = "", dir = "", quality = ""] = args;
        await writeAtlas(rows, dir, Number(quality));
        return ok;
      }
      return base(cmd, args);
    },
  });
  ctx.cfg = { ...ctx.cfg, atlas: { command: "node-for-atlas", args: ["builder.mjs"], quality: 5 } };
  const put = ctx.storage.put.bind(ctx.storage);
  ctx.storage.put = async (key, body, options) => {
    if (key.startsWith("atlas/")) {
      const [row] = await db.select({ pack: storedIndexes.pack }).from(storedIndexes);
      order.push(`${key.split("/").at(-1)} ${row?.pack ? "after" : "before"} the publish`);
    }
    return put(key, body, options);
  };
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, reportKey: "reports/gh/acme/rocket/old", reportLines: true });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  const [si] = await db.select().from(storedIndexes);
  expect(si?.pack).toBeTruthy();
  expect(si?.buildFormat).toBe(BUILD_FORMAT);
  expect(ctx.storage.objects.has(atlasKey(si?.id ?? 0, si?.pack ?? "", "map"))).toBe(true);
  expect(ctx.storage.objects.has(atlasKey(si?.id ?? 0, si?.pack ?? "", "names"))).toBe(true);
  expect(order).toEqual(["atlas", "map.bin.br before the publish", "names.bin.br before the publish"]);
  expect(Object.keys(ctx.captured.at(-1)?.[2] ?? {})).toContain("seconds_atlas_full");
});

test("a Build whose Atlas fails is still published, and the Site makes the Atlas", async () => {
  const db = await database();
  const base = tools();
  const ctx = await context(db, { run: async (cmd, args) => (cmd === "node-for-atlas" ? { code: 1, stderr: "killed", timedOut: false } : base(cmd, args)) });
  ctx.cfg = { ...ctx.cfg, atlas: { command: "node-for-atlas", args: [], quality: 5 } };
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10, reportKey: "reports/gh/acme/rocket/old", reportLines: true });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  expect(await db.select().from(builds)).toMatchObject([{ state: "done" }]);
  expect([...ctx.storage.objects.keys()].filter((k) => k.startsWith("atlas/"))).toEqual([]);
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

async function wholeReport(db: Db, id: string, head: string, over: Partial<typeof repositories.$inferInsert> = {}) {
  const [owner = "", name = ""] = id.split("/");
  await db.insert(repositories).values({ id, owner, name, sizeKb: 10, reportKey: `reports/gh/${id}/b0`, reportAt: now() - 3 * 24 * 3600, reportLines: true, ...over });
  const [si] = await db
    .insert(storedIndexes)
    .values({ repoId: id, lineage: "7", kept: true, head, frontier: [head], lines: true, linesLeft: 0, pack: `packs/${id}/1/${head}-b0-lines.pack`, state: "live", builtAt: 1, buildFormat: BUILD_FORMAT })
    .returning({ id: storedIndexes.id });
  await db.update(repositories).set({ indexId: si?.id ?? null }).where(eq(repositories.id, id));
}

test("a Build whose Report is whole and whose head has not moved ends at its head check, without a clone, the engine or an upload", async () => {
  const db = await database();
  const head = "c".repeat(40);
  const ran: string[] = [];
  const ctx = await context(db, {
    run: async (cmd, args) => {
      ran.push(`${cmd} ${args[0]}`);
      return cmd === "git" && args[0] === "ls-remote" ? { ...ok, stdout: `${head}\tHEAD\n` } : ok;
    },
  });
  await wholeReport(db, "acme/rocket", head);
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  expect(ran).toEqual(["git ls-remote"]);
  expect(await db.select().from(builds)).toMatchObject([{ state: "done", partial: false, reason: null }]);
  const repo = await repoRow(db);
  expect(repo?.checkedAt).toBeGreaterThan(now() - 60);
  expect(repo?.reportKey).toBe("reports/gh/acme/rocket/b0");
  expect(ctx.captured.map((c) => c[0])).toEqual(["build started", "build unchanged"]);
  expect(packs(ctx)).toEqual([]);
});

test("a Report published by a Builder of an earlier release is built again even when its head has not moved", async () => {
  const db = await database();
  const head = "c".repeat(40);
  const ran: string[] = [];
  const base = tools();
  const ctx = await context(db, {
    run: async (cmd, args) => {
      ran.push(`${cmd} ${args[0]}`);
      return cmd === "git" && args[0] === "ls-remote" ? { ...ok, stdout: `${head}\tHEAD\n` } : base(cmd, args);
    },
  });
  await wholeReport(db, "acme/rocket", head);
  await db.update(storedIndexes).set({ buildFormat: null });
  await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  await runJob("b1", ctx);
  expect(ran).not.toContain("git ls-remote");
  expect(ran.some((r) => r.startsWith("commitscape build"))).toBe(true);
  const live = await db.select().from(storedIndexes).where(eq(storedIndexes.state, "live"));
  expect(live.map((l) => l.buildFormat)).toEqual([BUILD_FORMAT]);
});

test("a Build goes on when the head moved, when the Report is not whole, or for quiet Builds and retries, and asks the remote only when the Report is whole", async () => {
  const head = "c".repeat(40);
  const cases: [string, Partial<typeof repositories.$inferInsert>, string, number, JobAsked, boolean][] = [
    ["moved", {}, "d".repeat(40), 1, {}, true],
    ["a week old", { reportAt: now() - 8 * 24 * 3600 }, head, 1, {}, false],
    ["without lines", { reportLines: false }, head, 1, {}, false],
    ["quiet", {}, head, 1, { more: 1 }, false],
    ["a retry", {}, head, 2, {}, false],
  ];
  for (const [label, over, remote, attempt, asked, asks] of cases) {
    const db = await database();
    const ran: string[] = [];
    const base = tools();
    const ctx = await context(db, {
      run: async (cmd, args) => {
        ran.push(`${cmd} ${args[0]}`);
        return cmd === "git" && args[0] === "ls-remote" ? { ...ok, stdout: `${remote}\tHEAD\n` } : base(cmd, args);
      },
    });
    await wholeReport(db, "acme/rocket", head, over);
    await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
    await runJob("b1", ctx, attempt, asked);
    expect([label, ran.includes("git ls-remote")]).toEqual([label, asks]);
    expect([label, ran.some((r) => r.startsWith("commitscape build"))]).toEqual([label, true]);
  }
});

test("a Build reads a blobless clone once its lines and its Report's Surviving Lines are all counted, and a full one before", async () => {
  const head = "c".repeat(40);
  for (const [label, status, lean] of [["counted", "counted", true], ["still counting", "queued", false], ["never counted", null, false]] as const) {
    const db = await database();
    const clones: string[][] = [];
    const base = tools();
    const ctx = await context(db, {
      prefetch: async () => 0,
      run: async (cmd, args) => {
        if (cmd === "git" && args[0] === "clone") clones.push(args);
        return base(cmd, args);
      },
    });
    await wholeReport(db, "acme/rocket", head, { reportAt: now() - 8 * 24 * 3600 });
    if (status) await db.insert(surviving).values({ repoId: "acme/rocket", reportKey: "reports/gh/acme/rocket/b0", personId: 1, status, askedAt: 1 });
    await db.insert(builds).values({ id: "b1", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
    await runJob("b1", ctx);
    expect([label, clones.some((c) => c.includes("--no-checkout"))]).toEqual([label, lean]);
  }
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

test("a whole seed is built again only when its head moved and someone viewed it since, or once it is a week old; an unmoved one is marked checked", async () => {
  const db = await database();
  const head = "c".repeat(40);
  const week = 8 * 24 * 3600;
  const seen = now() - 3 * 24 * 3600 + 60;
  await wholeReport(db, "a/unmoved", head, { seed: true, viewedAt: seen });
  await wholeReport(db, "a/moved-unseen", head, { seed: true });
  await wholeReport(db, "a/moved-seen", head, { seed: true, viewedAt: seen });
  await wholeReport(db, "a/old", head, { seed: true, reportAt: now() - week });
  await wholeReport(db, "a/unknown-unseen", head, { seed: true });
  await db.insert(repositories).values({ id: "a/never", owner: "a", name: "never", seed: true });
  const asked: Named[][] = [];
  const heads = async (repos: Named[]) => {
    asked.push(repos);
    const moved = "d".repeat(40);
    return new Map([
      ["a/unmoved", head],
      ["a/moved-unseen", moved],
      ["a/moved-seen", moved],
      ["a/old", head],
    ]);
  };
  const sent: string[] = [];
  const queue: Queue = { send: async (job) => void sent.push(job.repoId ?? "") };
  expect(await queueSeeds(db, queue, [], 10, null, heads)).toBe(3);
  expect(sent.sort()).toEqual(["a/moved-seen", "a/never", "a/old"]);
  expect(asked.flat().map((r) => r.id).sort()).toEqual(["a/moved-seen", "a/moved-unseen", "a/unknown-unseen", "a/unmoved"]);
  const rows = await db.select().from(repositories);
  expect(rows.filter((r) => r.checkedAt !== null).map((r) => r.id)).toEqual(["a/unmoved"]);
});

test("heads are asked of GitHub's GraphQL API a hundred repositories to a request, and one GitHub does not know is left out", async () => {
  const bodies: { query: string; variables: Record<string, string> }[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, string> };
    bodies.push(body);
    const data = Object.fromEntries(
      Object.keys(body.variables)
        .filter((k) => k.startsWith("o"))
        .map((k) => {
          const j = k.slice(1);
          const name = body.variables[`n${j}`] ?? "";
          return [`r${j}`, name === "gone" ? null : { defaultBranchRef: { target: { oid: name.padEnd(40, "0") } } }];
        }),
    );
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
  const repos = Array.from({ length: 150 }, (_, i) => ({ id: `o/r${i}`, owner: "o", name: i === 7 ? "gone" : `r${i}` }));
  const heads = await headsOf({ api: "http://github.test", token: "t", fetcher }, repos);
  expect(bodies).toHaveLength(2);
  expect(heads.size).toBe(149);
  expect(heads.get("o/r0")).toBe("r0".padEnd(40, "0"));
  expect(heads.has("o/r7")).toBe(false);
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

test("a public repository is fetched with the Builder's own token, which reads nothing private, and never with the token lent for its Build, so a repository gone private since cannot be read with someone's own access", async () => {
  const db = await database();
  const envs: NodeJS.ProcessEnv[] = [];
  const argv: string[] = [];
  const base = tools();
  const ctx = await context(db, {
    tokenSecret: "s".repeat(32),
    run: async (cmd, args, env) => {
      if (cmd === "git") envs.push(env);
      argv.push(`${cmd} ${args.join(" ")}`);
      return base(cmd, args);
    },
  });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", sizeKb: 10 });
  await db.insert(schema.user).values({ id: "u1", name: "Ada", email: "ada@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  await lendToken(db, "s".repeat(32), "acme/rocket", "u1", "ghu_lent");
  await db.insert(builds).values({ id: "b9", repoId: "acme/rocket", state: "queued", requestedAt: 1 });
  ctx.github = { ...ctx.github, token: "ghs_site" };
  await runJob("b9", ctx);
  const carries = (e: NodeJS.ProcessEnv, token: string) => Object.values(e).some((v) => typeof v === "string" && v.includes(Buffer.from(`x-access-token:${token}`).toString("base64")));
  expect(envs.length).toBeGreaterThan(0);
  expect(envs.some((e) => carries(e, "ghu_lent"))).toBe(false);
  expect(envs.every((e) => carries(e, "ghs_site"))).toBe(true);
  expect(argv.some((a) => a.includes("ghs_site"))).toBe(false);
});

test("a Build that publishes a new Report asks for everyone's Surviving Lines once, and one that keeps its Report asks for nothing", async () => {
  const db = await database();
  const asked: SurvivalJob[] = [];
  const ctx = await context(db, { queueCounts: async (job) => void asked.push(job) });
  await db.insert(repositories).values({ id: "acme/seed", owner: "acme", name: "seed", sizeKb: 10, seed: true });
  await db.insert(builds).values({ id: "b3", repoId: "acme/seed", state: "queued", requestedAt: 1 });
  await runJob("b3", ctx);
  expect(asked).toEqual([{ repoId: "acme/seed", reportKey: "reports/gh/acme/seed/b3", personIds: [], everyone: true }]);
  expect((await db.select().from(surviving)).map((r) => [r.personId, r.status, r.reportKey])).toEqual([[1, "queued", "reports/gh/acme/seed/b3"]]);
  await db.insert(repositories).values({ id: "acme/other", owner: "acme", name: "other", sizeKb: 10 });
  await db.insert(builds).values({ id: "b4", repoId: "acme/other", state: "queued", requestedAt: 1 });
  await runJob("b4", ctx);
  expect(asked.map((j) => j.repoId)).toEqual(["acme/seed", "acme/other"]);
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
  expect((await inUse(db, cfg, cacheDir)).sort()).toEqual([join(work, "caches", "acme", "building"), join(work, "caches", "acme", "counting")]);
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
