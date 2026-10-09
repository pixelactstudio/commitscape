import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { fakeGitHub } from "./github.ts";

const site = resolve(import.meta.dirname, "..");
const root = resolve(site, "../..");
const port = Number(process.env.SITE_PORT ?? 8790);
const githubPort = port + 1;
const work = join(root, "target", "site-e2e-work");
const remotes = join(root, "target", "site-e2e-git");
const admin = process.env.E2E_DATABASE_URL ?? "postgres://commitscape:commitscape@localhost:5434/commitscape";
const bin = [process.env.COMMITSCAPE_BIN, join(root, "target/release/commitscape"), join(root, "target/debug/commitscape")]
  .filter((p): p is string => !!p)
  .find((p) => existsSync(p));
if (!bin) throw new Error("build commitscape first: cargo build --release");
const builderScript = join(root, "apps/builder/dist/builder.mjs");
if (!existsSync(builderScript)) throw new Error("build the Builder first: pnpm --filter @commitscape/builder build");

const database = new pg.Client(admin);
await database.connect();
await database.query("DROP DATABASE IF EXISTS commitscape_e2e WITH (FORCE)");
await database.query("CREATE DATABASE commitscape_e2e");
await database.end();

for (const dir of [work, remotes]) rmSync(dir, { recursive: true, force: true });
mkdirSync(join(remotes, "acme"), { recursive: true });
symlinkSync(join(root, "fixtures", "ownership", ".git"), join(remotes, "acme", "ownership.git"));
symlinkSync(join(root, "fixtures", "ownership", ".git"), join(remotes, "acme", "slow.git"));
symlinkSync(join(root, "fixtures", "coupling", ".git"), join(remotes, "acme", "private-thing.git"));
const app = generateKeyPairSync("rsa", { modulusLength: 2048 });
const appPublic = app.publicKey.export({ type: "spki", format: "pem" }).toString();

const shared = {
  DATABASE_URL: admin.replace(/\/[^/?]+(\?|$)/, "/commitscape_e2e$1"),
  S3_ENDPOINT: process.env.E2E_S3_ENDPOINT ?? "http://localhost:9100",
  S3_BUCKET: "commitscape-reports",
  S3_ACCESS_KEY_ID: "commitscape",
  S3_SECRET_ACCESS_KEY: "commitscape",
  S3_FORCE_PATH_STYLE: "true",
  GITHUB_API: `http://127.0.0.1:${githubPort}`,
};
const builderEnv = {
  ...shared,
  MIGRATIONS_DIR: join(root, "packages/server/drizzle"),
  COMMITSCAPE_BIN: join(site, "e2e", "slow-commitscape.sh"),
  COMMITSCAPE_REAL: bin,
  WORK_DIR: work,
  GIT_BASE: `file://${remotes}`,
  TIME_LIMIT_SECONDS: "4",
  MAX_REPOSITORY_MB: "3000",
  SEED_LANGUAGES: "Shell",
  SEED_PER_LANGUAGE: "5",
  GITHUB_TOKEN: "ghs_builder",
};
writeFileSync(join(root, "target", "site-e2e-env.json"), JSON.stringify({ builderScript, builderEnv, databaseUrl: shared.DATABASE_URL }));

const children: ChildProcess[] = [];
const github = await fakeGitHub(githubPort, appPublic);
const builder = spawn(process.execPath, [builderScript, "work"], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ...builderEnv } });
children.push(builder);
await new Promise<void>((ready, fail) => {
  builder.stdout?.on("data", (d: Buffer) => {
    process.stdout.write(d);
    if (d.toString().includes("builder working")) ready();
  });
  builder.on("exit", (code) => fail(new Error(`the Builder exited with ${code}`)));
});
children.push(
  spawn(process.execPath, [join(site, ".output/server/index.mjs")], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...shared,
      PORT: String(port),
      HOST: "127.0.0.1",
      BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
      BOARDS_CACHE_SECONDS: "0",
      GITHUB_TOKEN: "ghs_site",
    },
  }),
);

const stop = () => {
  for (const c of children) c.kill();
  github.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
