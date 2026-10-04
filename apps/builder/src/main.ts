import { utimes } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  BUILD_QUEUE,
  bossQueue,
  cleanup,
  createDb,
  PULLS_QUEUE,
  runMigrations,
  s3Storage,
  schema,
  startQueue,
  LONGEST_JOB_SECONDS,
  SURVIVAL_QUEUE,
  type BuildJob,
  type PullsJob,
  type SurvivalJob,
} from "@commitscape/server";
import { configOf, loadEnv } from "./config";
import { inUse, prune } from "./disk";
import { runJob } from "./job";
import { run, timeLimitOf } from "./run";
import { pullsToken, readPulls } from "./pulls";
import { budgetOf, runSurvival } from "./survival";
import { queueSeeds, seedConfig, seedList } from "./seeds";

const env = loadEnv();
const cfg = configOf(env);
const storage = s3Storage({
  endpoint: env.S3_ENDPOINT,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
const app = env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY ? { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY, api: env.GITHUB_API } : null;

async function work() {
  await runMigrations(env.DATABASE_URL, env.MIGRATIONS_DIR);
  const { db, pool } = createDb(env.DATABASE_URL, cfg.concurrency + 2);
  const boss = await startQueue(env.DATABASE_URL, { worker: true, expireInSeconds: cfg.timeLimit + 300 });
  const github = { api: env.GITHUB_API, token: env.GITHUB_TOKEN ?? null };
  const queuePulls = async (repoId: string) => {
    await boss.send(PULLS_QUEUE, { repoId }, { singletonKey: repoId });
  };
  const queueCounts = async (job: SurvivalJob) => {
    const seconds = budgetOf(env.SURVIVING_BUDGET_SECONDS, job.attempt) * job.personIds.length + cfg.timeLimit + 300;
    await boss.send(SURVIVAL_QUEUE, job, {
      singletonKey: `${job.repoId}:${job.reportKey}:${job.personIds.join(",")}`,
      expireInSeconds: Math.min(LONGEST_JOB_SECONDS, Math.ceil(seconds)),
    });
  };
  const queueBuild = async (job: BuildJob & { attempt: number }, priority: number) => {
    await boss.send(BUILD_QUEUE, job, { priority, expireInSeconds: Math.min(LONGEST_JOB_SECONDS, timeLimitOf(cfg, job.attempt) + 300) });
  };
  await boss.work<BuildJob>(BUILD_QUEUE, { localConcurrency: cfg.concurrency, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await runJob(job.data.buildId, { db, storage, cfg, app, run, github, log: console.log, queuePulls, queueCounts, queueBuild }, job.data.attempt ?? 1);
    await utimes(cfg.work, new Date(), new Date()).catch(() => {});
    const keep = await inUse(db, cfg).catch(() => null);
    if (keep) for (const p of await prune(cfg.work, cfg.diskGb * 1024 ** 3, keep)) console.log(`pruned ${p}`);
  });
  await boss.work<SurvivalJob>(SURVIVAL_QUEUE, { localConcurrency: 1, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await runSurvival(job.data, { db, storage, cfg, app, run, github, log: console.log, queueCounts, budget: env.SURVIVING_BUDGET_SECONDS });
  });
  await boss.work<PullsJob>(PULLS_QUEUE, { localConcurrency: 1, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    const [repo] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, job.data.repoId));
    if (!repo) return;
    const token = await pullsToken(app, repo, github.token);
    if (!token) return;
    const read = await readPulls(db, { ...github, token }, repo.id, repo.owner, repo.name, Date.now() + env.PULLS_TIME_LIMIT_SECONDS * 1000).catch((e: unknown) => {
      console.log(`pulls ${repo.id}: ${(e as Error).message}`);
      return null;
    });
    if (read) console.log(`pulls ${repo.id}: ${read.pulls} pull requests in ${read.pages} pages, ${read.seconds.toFixed(1)} s${read.done ? "" : ", stopped at the time limit"}`);
  });
  console.log(`builder working, ${cfg.concurrency} Build${cfg.concurrency > 1 ? "s" : ""} at a time; clones in ${cfg.work}`);
  const stop = async () => {
    console.log("builder stopping");
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
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
      const s = seedConfig(env);
      const list = await seedList(s);
      const boss = await startQueue(env.DATABASE_URL, { worker: false });
      const queued = await queueSeeds(db, bossQueue(boss), list, s.budget);
      await boss.stop();
      console.log(`seeds: ${list.length} from GitHub's search, ${queued} queued`);
    }
  } finally {
    await pool.end();
  }
}

const command = process.argv[2] ?? "work";
if (command === "migrate") {
  await runMigrations(env.DATABASE_URL, env.MIGRATIONS_DIR);
  console.log("migrations applied");
} else if (command === "cleanup" || command === "seed") {
  await once(command);
} else if (command === "work") {
  await work();
} else {
  console.error(`unknown command ${command}: work, seed, cleanup or migrate`);
  process.exit(2);
}
