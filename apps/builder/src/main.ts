import { utimes } from "node:fs/promises";
import { BUILD_QUEUE, bossQueue, cleanup, createDb, runMigrations, s3Storage, startQueue, type BuildJob } from "@commitscape/server";
import { configOf, loadEnv } from "./config";
import { prune } from "./disk";
import { runJob } from "./job";
import { run } from "./run";
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

async function rasterizer(): Promise<(svg: string) => Uint8Array | null> {
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    return (svg) => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
  } catch {
    console.log("no @resvg/resvg-js here: cards are stored as SVG");
    return () => null;
  }
}

async function work() {
  await runMigrations(env.DATABASE_URL, env.MIGRATIONS_DIR);
  const { db, pool } = createDb(env.DATABASE_URL, cfg.concurrency + 2);
  const boss = await startQueue(env.DATABASE_URL, { worker: true, expireInSeconds: cfg.timeLimit + 300 });
  const png = await rasterizer();
  await boss.work<BuildJob>(BUILD_QUEUE, { localConcurrency: cfg.concurrency, batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await runJob(job.data.buildId, { db, storage, cfg, app, run, png, log: console.log });
    await utimes(cfg.work, new Date(), new Date()).catch(() => {});
    for (const p of await prune(cfg.work, cfg.diskGb * 1024 ** 3)) console.log(`pruned ${p}`);
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
