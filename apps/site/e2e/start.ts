// Starts everything the Site's end-to-end tests need, on this machine only:
// a stand-in for GitHub's API (github.ts), git remotes that are the
// fixtures, the real Builder, and the built Site under `wrangler dev` with
// fresh local D1 and R2. Playwright runs it (playwright.config.ts); build
// the Site, the Builder, the binary and the fixtures first.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { TEST_SECRET, TEST_WEBHOOK_SECRET } from "./constants.ts";
import { fakeGitHub } from "./github.ts";

const site = resolve(import.meta.dirname, "..");
const root = resolve(site, "../..");
const port = Number(process.env.SITE_PORT ?? 8790);
const githubPort = port + 1;
const builderPort = port + 2;

const state = join(root, "target", "site-e2e-state");
const work = join(root, "target", "site-e2e-work");
const remotes = join(root, "target", "site-e2e-git");
const wrangler = join(site, "node_modules", ".bin", "wrangler");
const bin = [process.env.COMMITSCAPE_BIN, join(root, "target/release/commitscape"), join(root, "target/debug/commitscape")]
  .filter((p): p is string => !!p)
  .find((p) => existsSync(p));
if (!bin) throw new Error("build commitscape first: cargo build --release");
const builderScript = join(root, "apps/builder/dist/builder.mjs");
if (!existsSync(builderScript)) throw new Error("build the Builder first: pnpm --filter @commitscape/builder build");

function run(cmd: string, args: string[]) {
  const done = spawnSync(cmd, args, { cwd: site, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${done.stdout}\n${done.stderr}`);
}

for (const dir of [state, work, remotes]) rmSync(dir, { recursive: true, force: true });
// acme/ownership's remote is the fixture itself.
mkdirSync(join(remotes, "acme"), { recursive: true });
symlinkSync(join(root, "fixtures", "ownership", ".git"), join(remotes, "acme", "ownership.git"));
// acme/private-thing, a Connected Repository in these tests, is the coupling fixture.
symlinkSync(join(root, "fixtures", "coupling", ".git"), join(remotes, "acme", "private-thing.git"));
// The test GitHub App's key: the Site signs with it, the stand-in checks with it.
const app = generateKeyPairSync("rsa", { modulusLength: 2048 });
const appPrivate = Buffer.from(app.privateKey.export({ type: "pkcs1", format: "pem" })).toString("base64");
const appPublic = app.publicKey.export({ type: "spki", format: "pem" }).toString();
run(wrangler, ["d1", "migrations", "apply", "commitscape", "--local", "--persist-to", state, "-c", "wrangler.jsonc"]);

const children: ChildProcess[] = [];
const github = await fakeGitHub(githubPort, appPublic);
children.push(
  spawn(process.execPath, [builderScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(builderPort),
      BUILDER_SECRET: TEST_SECRET,
      SITE_URL: `http://127.0.0.1:${port}`,
      COMMITSCAPE_BIN: join(site, "e2e", "slow-commitscape.sh"),
      COMMITSCAPE_REAL: bin,
      WORK_DIR: work,
      GIT_BASE: `file://${remotes}`,
      TIME_LIMIT_SECONDS: "4",
      // Seeds only when a test asks, from the stand-in's search.
      SEED_HOUR: "off",
      SEED_LANGUAGES: "Shell",
      SEED_PER_LANGUAGE: "5",
      // Typed as the Worker's own variable (worker-configuration.d.ts); here it is the Builder's.
      ...({ GITHUB_API: `http://127.0.0.1:${githubPort}` } as Record<string, string>),
    },
  }),
);
children.push(
  spawn(
    wrangler,
    [
      "dev",
      "--test-scheduled",
      "--port",
      String(port),
      "--persist-to",
      state,
      "--var",
      `BUILDER_URL:http://127.0.0.1:${builderPort}`,
      "--var",
      `GITHUB_API:http://127.0.0.1:${githubPort}`,
      "--var",
      `BUILDER_SECRET:${TEST_SECRET}`,
      "--var",
      "GITHUB_TOKEN:",
      "--var",
      `GITHUB_OAUTH:http://127.0.0.1:${githubPort}`,
      "--var",
      "GITHUB_APP_ID:777",
      "--var",
      "GITHUB_APP_CLIENT_ID:Iv1.test",
      "--var",
      "GITHUB_APP_SLUG:commitscape-test",
      "--var",
      "GITHUB_APP_CLIENT_SECRET:test-client-secret",
      "--var",
      `GITHUB_APP_PRIVATE_KEY:${appPrivate}`,
      "--var",
      `GITHUB_WEBHOOK_SECRET:${TEST_WEBHOOK_SECRET}`,
      "--var",
      "SESSION_KEY:e2e-session-key-e2e-session-key-e2e",
    ],
    { cwd: site, stdio: "inherit" },
  ),
);
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  github.close();
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stop(), process.exit(0)));
for (const c of children) c.on("exit", () => (stop(), process.exit(1)));
