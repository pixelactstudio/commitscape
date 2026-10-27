import { eq } from "drizzle-orm";
import {
  BUILD_LARGE_QUEUE,
  BUILD_QUEUE,
  bossQueue,
  buildJobStates,
  buildKey,
  cleanup,
  createDb,
  PRIORITY,
  PULLS_QUEUE,
  reapBuilds,
  runMigrations,
  s3Storage,
  schema,
  siteToken,
  startQueue,
  LONGEST_JOB_SECONDS,
  SURVIVAL_QUEUE,
  survivalKey,
  type BuildJob,
  type Db,
  type PullsJob,
  type SurvivalJob,
} from "@commitscape/server";
import { configOf, loadEnv, type Config } from "./config";
import { inQueueSpan, log, monitored, startTelemetry } from "./telemetry";
import { cacheDir, inUse, prune, sweep } from "./disk";
import { runJob } from "./job";
import { admitting } from "./admission";
import { jobLimitOf, run } from "./run";
import { pullsToken, readPulls } from "./pulls";
import { repackClones } from "./repack";
import { budgetOf, runSurvival } from "./survival";
import { queueRebuilds } from "./rebuild";
import { forgetStates, saveState as saveRepoState, stateKeys } from "./state";
import { writeAtlas } from "./universe";
import { headsOf, queueSeeds, seedConfig, seedList } from "./seeds";

const command = process.argv[2] ?? "work";
if (command === "atlas") {
  const [rows = "", dir = "", quality = ""] = process.argv.slice(3);
  await writeAtlas(rows, dir, Number(quality));
  process.exit(0);
}

const env = loadEnv();
const telemetry = startTelemetry({
  sentryDsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT,
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  posthogKey: env.POSTHOG_KEY,
  posthogHost: env.POSTHOG_HOST,
  analyticsSecret: env.TOKEN_SECRET,
});
const cfg = { ...configOf(env), atlas: { command: process.execPath, args: [process.argv[1] ?? "builder.mjs"], quality: env.ATLAS_QUALITY } };
const storage = s3Storage({
  endpoint: env.S3_ENDPOINT,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
const app = env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY ? { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY, api: env.GITHUB_API } : null;

const site = siteToken(app, env.GITHUB_APP_INSTALLATION_ID ?? null, env.GITHUB_TOKEN);

const REAP_MINUTES = 5;
const TIDY_MINUTES = 15;
const PULLS_AGAIN_SECONDS = 60;

/** The lane a Build runs in: large repositories wait for each other, never for small ones. */
async function laneOf(db: Db, config: Config, buildId: string): Promise<{ queue: string; seed: boolean; repoId: string } | null> {
  const [row] = await db
    .select({ sizeKb: schema.repositories.sizeKb, seed: schema.repositories.seed, repoId: schema.repositories.id })
    .from(schema.builds)
    .innerJoin(schema.repositories, eq(schema.repositories.id, schema.builds.repoId))
    .where(eq(schema.builds.id, buildId));
  if (!row) return null;
  return { queue: (row.sizeKb ?? 0) / 1024 > config.largeMb ? BUILD_LARGE_QUEUE : BUILD_QUEUE, seed: row.seed, repoId: row.repoId };
}

async function work() {
  await runMigrations(env.DATABASE_URL, env.MIGRATIONS_DIR);
  const { db, pool } = createDb(env.DATABASE_URL, cfg.concurrency + cfg.largeConcurrency + 3);
  const boss = await startQueue(env.DATABASE_URL, { worker: true, expireInSeconds: Math.min(LONGEST_JOB_SECONDS, jobLimitOf(cfg, 1)) });
  const github = {
    api: env.GITHUB_API,
    get token() {
      return site.current() ?? null;
    },
  };
  const queuePulls = async (repoId: string) => {
    await boss.send(PULLS_QUEUE, { repoId }, { singletonKey: repoId });
  };
  const queueCounts = async (job: SurvivalJob) => {
    const seconds = budgetOf(env.SURVIVING_BUDGET_SECONDS, job.attempt) * job.personIds.length + cfg.timeLimit + cfg.cloneLimit + 300;
    await boss.send(SURVIVAL_QUEUE, job, { singletonKey: survivalKey(job), expireInSeconds: Math.min(LONGEST_JOB_SECONDS, Math.ceil(seconds)) });
  };
  const sendBuild = async (queue: string, job: BuildJob, priority: number, startAfter?: number) => {
    await boss.send(queue, job, { priority, singletonKey: buildKey(job), expireInSeconds: Math.min(LONGEST_JOB_SECONDS, jobLimitOf(cfg, job.attempt ?? 1)), ...(startAfter ? { startAfter } : {}) });
  };
  const queueBuild = async (job: BuildJob & { attempt: number }, priority: number, startAfter?: number) => {
    const lane = await laneOf(db, cfg, job.buildId);
    await sendBuild(lane?.queue ?? BUILD_QUEUE, { queuedAt: Date.now(), ...job }, priority, startAfter);
  };
  const engine = admitting(run, [cfg.bin, cfg.atlas.command], cfg.engineMemoryMb);
  let forgotAt = 0;
  const tidy = async () => {
    for (const p of await sweep(db, cfg).catch(() => [])) log(`swept ${p}`);
    const keep = await inUse(db, cfg).catch(() => null);
    if (keep) for (const p of await prune(cfg.work, cfg.diskGb * 1024 ** 3, keep)) log(`pruned ${p}`);
    const caches = await inUse(db, cfg, cacheDir).catch(() => null);
    const days = cfg.state ? cfg.state.diskDays * 86_400_000 : undefined;
    if (caches) for (const p of await prune(cfg.work, cfg.cacheGb * 1024 ** 3, caches, "caches", days)) log(`pruned ${p}`);
    for (const p of await repackClones(engine, cfg.work, cfg.cloneLimit * 1000).catch(() => [])) log(`repacked ${p}`);
    if (cfg.state && Date.now() - forgotAt > 86_400_000) {
      forgotAt = Date.now();
      const gone = await forgetStates({ storage, db }, cfg.state.keepDays).catch((e: unknown) => (log(`states not forgotten: ${(e as Error).message}`), []));
      if (gone.length > 0) log(`forgot the States of ${gone.length} repositories unused for ${cfg.state.keepDays} days`);
    }
  };
  const reap = async () => {
    const reaped = await reapBuilds(db, (id) => buildJobStates(boss, id), bossQueue(boss));
    if (reaped.failed + reaped.resent > 0) log(`reaper: ${reaped.failed} Builds ended, ${reaped.resent} sent again`);
  };
  const timed = (slug: string, minutes: number, fn: () => Promise<void>) => () => monitored(slug, minutes, fn).catch((e: unknown) => log(`${slug}: ${(e as Error).message}`));
  const reapTimed = timed("builder-reaper", REAP_MINUTES, reap);
  const tidyTimed = timed("builder-tidy", TIDY_MINUTES, tidy);
  const tier = cfg.state ? { storage, keys: stateKeys(cfg.state.secret), db, log } : null;
  const saveState = tier ? (repoId: string, root: string) => saveRepoState(tier, repoId, root) : undefined;
  const ctx = { db, pool, storage, cfg, app, run: engine, github, tokenSecret: env.TOKEN_SECRET, log, telemetry, queuePulls, queueCounts, queueBuild, ...(saveState ? { saveState } : {}) };
  const building = (queue: string, job: { id: string; data: BuildJob }) =>
    inQueueSpan(job, queue, () => runJob(job.data.buildId, ctx, job.data.attempt ?? 1, { ...(job.data.userId ? { userId: job.data.userId } : {}), ...(job.data.more ? { more: job.data.more } : {}) }));
  await reapTimed();
  await tidyTimed();
  const reaper = setInterval(() => void reapTimed(), REAP_MINUTES * 60_000);
  const tidier = setInterval(() => void tidyTimed(), TIDY_MINUTES * 60_000);
  await boss.work<BuildJob>(BUILD_QUEUE, { localConcurrency: cfg.concurrency, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await site.ready();
    const lane = await laneOf(db, cfg, job.data.buildId);
    if (lane?.queue === BUILD_LARGE_QUEUE) {
      await sendBuild(BUILD_LARGE_QUEUE, { ...job.data, repoId: lane.repoId }, job.data.more ? PRIORITY.lines : lane.seed ? PRIORITY.seed : PRIORITY.person);
      return;
    }
    await building(BUILD_QUEUE, job);
    await tidy();
  });
  await boss.work<BuildJob>(BUILD_LARGE_QUEUE, { localConcurrency: cfg.largeConcurrency, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await site.ready();
    await building(BUILD_LARGE_QUEUE, job);
    await tidy();
  });
  await boss.work<SurvivalJob>(SURVIVAL_QUEUE, { localConcurrency: 1, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await site.ready();
    await runSurvival(job.data, { ...ctx, budget: env.SURVIVING_BUDGET_SECONDS });
  });
  await boss.work<PullsJob>(PULLS_QUEUE, { localConcurrency: 1, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await site.ready();
    const [repo] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, job.data.repoId));
    if (!repo) return;
    const token = await pullsToken(db, app, env.TOKEN_SECRET, repo, github.token);
    if (!token) return;
    const before = repo.pullsCursor;
    const read = await readPulls(db, { ...github, token }, repo.id, repo.owner, repo.name, Date.now() + env.PULLS_TIME_LIMIT_SECONDS * 1000).catch(async (e: unknown) => {
      log(`pulls ${repo.id}: ${(e as Error).message}`);
      const [after] = await db.select({ cursor: schema.repositories.pullsCursor }).from(schema.repositories).where(eq(schema.repositories.id, repo.id));
      if (after?.cursor && after.cursor !== before) await boss.send(PULLS_QUEUE, { repoId: repo.id }, { singletonKey: repo.id, startAfter: PULLS_AGAIN_SECONDS }).catch(() => undefined);
      return null;
    });
    if (read) log(`pulls ${repo.id}: ${read.pulls} pull requests in ${read.pages} pages, ${read.seconds.toFixed(1)} s${read.whole ? ", all of them" : ""}${read.done ? "" : ", stopped at the time limit"}`);
    if (read && !read.done && read.pages > 0) await boss.send(PULLS_QUEUE, { repoId: repo.id }, { singletonKey: repo.id, startAfter: PULLS_AGAIN_SECONDS }).catch(() => undefined);
  });
  log(`builder working, ${cfg.concurrency} Build${cfg.concurrency > 1 ? "s" : ""} at a time and ${cfg.largeConcurrency} over ${cfg.largeMb} MB; clones in ${cfg.work}`);
  const stop = async () => {
    log("builder stopping");
    clearInterval(reaper);
    clearInterval(tidier);
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
    await telemetry.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

async function once(what: string) {
  const { db, pool } = createDb(env.DATABASE_URL, 2);
  try {
    if (what === "cleanup") {
      console.log("cleanup:", JSON.stringify(await cleanup(db, storage)));
    } else if (what === "seed") {
      const s = { ...seedConfig(env), token: await site.ready() };
      const list = await seedList(s);
      const boss = await startQueue(env.DATABASE_URL, { worker: false });
      const queued = await queueSeeds(db, bossQueue(boss), list, s.budget, storage, (repos) => headsOf({ api: env.GITHUB_API, token: s.token ?? null }, repos));
      await boss.stop();
      console.log(`seeds: ${list.length} from GitHub's search, ${queued} queued`);
    } else if (what === "rebuild") {
      const boss = await startQueue(env.DATABASE_URL, { worker: false });
      const { queued } = await queueRebuilds(db, bossQueue(boss));
      await boss.stop();
      console.log(`rebuild: ${queued} Builds queued for repositories whose Stored Index has no pack`);
    }
  } finally {
    await pool.end();
  }
}

if (command === "migrate") {
  await runMigrations(env.DATABASE_URL, env.MIGRATIONS_DIR);
  console.log("migrations applied");
  await telemetry.stop();
} else if (command === "cleanup" || command === "seed" || command === "rebuild") {
  await once(command);
  await telemetry.stop();
} else if (command === "work") {
  await work();
} else {
  console.error(`unknown command ${command}: work, seed, rebuild, cleanup, migrate or atlas`);
  process.exit(2);
}
