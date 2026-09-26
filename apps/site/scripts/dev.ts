// `pnpm dev:site` from the root: the Site and the Builder together, on this
// machine, with local D1 and R2, in one terminal. It builds what is missing,
// makes the local tables, gives both halves the same fresh BUILDER_SECRET,
// and borrows the GitHub CLI's own sign-in for GITHUB_TOKEN when there is
// one (nothing new is created; without it GitHub allows 60 lookups an hour
// and the Leaderboards can't be seeded). Ctrl+C stops both.
//
// `apps/site/.dev.vars`, when it exists, is still read (the GitHub App's
// secrets for signing in); what this script sets wins over it.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const site = resolve(import.meta.dirname, "..");
const root = resolve(site, "../..");
const port = Number(process.env.SITE_PORT ?? 8787);
const builderPort = port + 1;
const wrangler = join(site, "node_modules", ".bin", "wrangler");
const builderScript = join(root, "apps/builder/dist/builder.mjs");
const bin = process.env.COMMITSCAPE_BIN ?? join(root, "target/release/commitscape");

/** 64 random hexadecimal characters. */
const hex32 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");

/** The system's certificate bundle, from the first of the usual places that has one. */
function certificates(): string | undefined {
  return [process.env.NIX_SSL_CERT_FILE, "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem"]
    .find((p): p is string => !!p && existsSync(p));
}

function step(what: string, cmd: string, args: string[], cwd = root) {
  console.log(`\n▸ ${what}`);
  const done = spawnSync(cmd, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
  if (done.status !== 0) {
    console.error(`✗ ${what} failed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
}

if (!existsSync(bin)) step("building the commitscape binary (the first time takes a few minutes)", "cargo", ["build", "--release"]);
// Turborepo skips whatever hasn't changed, so this is quick after the first time.
step("building the Site and the Builder", "pnpm", ["exec", "turbo", "run", "build", "--filter=@commitscape/site", "--filter=@commitscape/builder", "--output-logs=errors-only"]);
step("making the local database's tables", wrangler, ["d1", "migrations", "apply", "commitscape", "--local"], site);

const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
const token = gh.status === 0 ? gh.stdout.trim() : "";

const secret = hex32();
const vars: Record<string, string> = {
  BUILDER_SECRET: secret,
  BUILDER_URL: `http://127.0.0.1:${builderPort}`,
  ...(token ? { GITHUB_TOKEN: token } : {}),
};
const devVars = join(site, ".dev.vars");
if (!existsSync(devVars)) vars.SESSION_KEY = hex32();

// The secrets go to wrangler in a file only this user can read, not on its
// command line, where anyone on the machine could see them; it is removed on exit.
const scratch = join(root, "target", "site-dev");
mkdirSync(scratch, { recursive: true });
const envFile = join(scratch, "dev.env");
writeFileSync(envFile, Object.entries(vars).map(([k, v]) => `${k}=${v}\n`).join(""), { mode: 0o600 });

const certs = process.env.SSL_CERT_FILE ?? certificates();
const children: ChildProcess[] = [
  spawn(process.execPath, [builderScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(builderPort),
      BUILDER_SECRET: secret,
      SITE_URL: `http://127.0.0.1:${port}`,
      COMMITSCAPE_BIN: bin,
      WORK_DIR: join(root, "target", "builder-work"),
      SEED_HOUR: "off",
      ...(token ? { GITHUB_TOKEN: token } : {}),
    },
  }),
  spawn(
    wrangler,
    ["dev", "--port", String(port), "--show-interactive-dev-session=false", ...(existsSync(devVars) ? ["--env-file", devVars] : []), "--env-file", envFile],
    // workerd looks for the system's certificates where Debian keeps them, so
    // on NixOS and elsewhere every call to GitHub fails TLS unless it is told.
    { cwd: site, stdio: "inherit", env: { ...process.env, ...(certs ? { SSL_CERT_FILE: certs } : {}) } },
  ),
];

console.log(`
  The Site      http://127.0.0.1:${port}
  The Builder   http://127.0.0.1:${builderPort}/health
  GitHub        ${token ? "signed in through the GitHub CLI" : "not signed in (gh auth login): 60 lookups an hour, no Leaderboards"}

  From another machine on your tailnet: tailscale serve --bg ${port}
  Fill the Leaderboards:                 pnpm dev:site:seed
  Ctrl+C stops both.
`);
// `pnpm dev:site:seed` needs the running Builder's secret.
writeFileSync(join(scratch, "builder.env"), `BUILDER_SECRET=${secret}\nSITE_URL=http://127.0.0.1:${port}\nPORT=${builderPort}\n`, { mode: 0o600 });

let stopping = false;
const stop = (code: number) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  rmSync(scratch, { recursive: true, force: true });
  process.exit(code);
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop(0));
for (const c of children) c.on("exit", () => stop(1));
