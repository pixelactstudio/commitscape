import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { BuildFailure, BuildStats, BuildStep } from "@commitscape/data";
import { writeAccounts, type Signature } from "./accounts";
import { cloneUrl, ensureClone, gitEnv, locked, type Cloned } from "./clone";
import type { Config } from "./config";
import { privateDir, repoDir, scratchDir } from "./disk";

export type BuildTarget = {
  id: string;
  owner: string;
  name: string;
  sizeKb: number;
  private: boolean;
  token: string | null;
  seed: boolean;
  attempt?: number;
};

export type Phase = "quick" | "full";

export type Made = { report: Uint8Array; commits: Uint8Array | null; stats: BuildStats | null; seconds: number };

type Failed = { reason: BuildFailure; detail?: string };

export type Outcome = { published: Phase | null; seconds: number; failure?: Failed; resumable: boolean };

export const REPORT_MAX = 64 * 1024 * 1024;

export const BUILD_ATTEMPTS = 4;

const doubled = (base: number, attempt: number) => base * 2 ** (Math.min(Math.max(attempt, 1), BUILD_ATTEMPTS) - 1);

/** How long commitscape may take over one Report in one attempt at a Build: the time limit, doubled for each attempt after the first. */
export function timeLimitOf(cfg: Config, attempt = 1): number {
  return doubled(cfg.timeLimit, attempt);
}

/** How long one clone may take in one attempt at a Build: the clone time limit, doubled for each attempt after the first. */
export function cloneLimitOf(cfg: Config, attempt = 1): number {
  return doubled(cfg.cloneLimit, attempt);
}

/** How long the queue lets one attempt at a Build run: its clone, its two runs of commitscape and the time to store what they wrote. */
export function jobLimitOf(cfg: Config, attempt = 1): number {
  return cloneLimitOf(cfg, attempt) + 2 * timeLimitOf(cfg, attempt) + 600;
}

export type Ran = { code: number | null; stderr: string; timedOut: boolean; stdout?: string };

export function statsOf(gzipped: Uint8Array): BuildStats | null {
  try {
    const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as { stats?: BuildStats | null };
    return report.stats ?? null;
  } catch {
    return null;
  }
}

const PASSED = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "PATHEXT", "USERPROFILE", "SSL_CERT_FILE", "SSL_CERT_DIR"];
function passed(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => PASSED.includes(k) || k.startsWith("COMMITSCAPE_")));
}

/** Runs a command with only safe environment variables, killing it and its children after `timeoutMs`. */
export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...passed(), ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < 1_000_000) stdout += d.toString();
    });
    let timedOut = false;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr, timedOut, stdout });
    };
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish(null);
    }, timeoutMs);
    child.on("error", (e) => {
      stderr += String(e);
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

export type Deps = {
  run: typeof run;
  progress: (step: BuildStep) => Promise<void>;
  accounts: (signatures: Signature[]) => Promise<Record<string, string>>;
  publish: (phase: Phase, made: Made) => Promise<boolean>;
  log?: (line: string) => void;
};

export const NAME = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;

type Step = { ok: true } | ({ ok: false } & Failed);

const lastLine = (text: string) => text.trim().split("\n").at(-1);
const failed = (c: Cloned): Step => (c.ok ? { ok: true } : { ok: false, reason: c.reason, ...(c.detail ? { detail: c.detail } : {}) });

/** Reads a repository in two phases at once: a quick clone without old file contents gives a Report without lines to publish at once, while a full clone gives the Report with its lines that replaces it. */
export async function build(req: BuildTarget, cfg: Config, deps: Deps): Promise<Outcome> {
  if (!NAME.test(req.owner) || !NAME.test(req.name) || req.name === "." || req.name === "..") {
    return { published: null, seconds: 0, failure: { reason: "not_found", detail: "not a repository name" }, resumable: false };
  }
  const sizeMb = req.sizeKb / 1024;
  if (cfg.maxMb !== undefined && sizeMb > cfg.maxMb) return { published: null, seconds: 0, failure: { reason: "too_big", detail: `${Math.round(sizeMb)} MB` }, resumable: false };
  const started = Date.now();
  const attempt = req.attempt ?? 1;
  const binLimit = timeLimitOf(cfg, attempt);
  const cloneLimit = cloneLimitOf(cfg, attempt) * 1000;
  const home = req.private ? privateDir(cfg, req.id) : repoDir(cfg, req.owner, req.name);
  const full = join(home, "full");
  const scratch = scratchDir(cfg, req.id);
  const env = gitEnv(req.token);
  const url = cloneUrl(cfg, req.owner, req.name);
  const warm = existsSync(join(full, ".git"));
  let resumable = false;
  let fullMade = false;
  let quickPublished = false;
  let cloneDone = false;

  const report = async (dir: string, phase: Phase, cache: string, accounts: string | null): Promise<({ ok: true } & Made) | ({ ok: false } & Failed)> => {
    const out = join(scratch, `${phase}.json.gz`);
    const commitsOut = join(scratch, `${phase}.commits.json.gz`);
    const t = Date.now();
    const args = ["report", ...(phase === "quick" ? ["--no-lines"] : []), "--no-emails", "--offline", "--window", "all", "--cache-dir", cache];
    if (accounts) args.push("--accounts", accounts);
    args.push("--out", out, "--commits-out", commitsOut, "--", dir);
    const made = await deps.run(cfg.bin, args, env, binLimit * 1000);
    if (made.timedOut) return { ok: false, reason: "timed_out", detail: `${binLimit} s` };
    if (made.code !== 0) return { ok: false, reason: "error", ...(made.stderr ? { detail: lastLine(made.stderr) } : {}) };
    const bytes = new Uint8Array(await readFile(out));
    if (bytes.length > REPORT_MAX) return { ok: false, reason: "too_big", detail: `a ${Math.round(bytes.length / 1024 ** 2)} MB Report` };
    const commits = existsSync(commitsOut) ? new Uint8Array(await readFile(commitsOut)) : null;
    await rm(out, { force: true });
    await rm(commitsOut, { force: true });
    return { ok: true, report: bytes, commits, stats: statsOf(bytes), seconds: Math.round((Date.now() - t) / 100) / 10 };
  };

  const accountsFrom = (dir: string) => writeAccounts(deps.run, { bin: cfg.bin, dir, scratch, env, timeoutMs: binLimit * 1000, ...(deps.log ? { log: deps.log } : {}) }, deps.accounts);

  const guarded = (fn: () => Promise<Step>): Promise<Step> => fn().catch((e: unknown) => ({ ok: false, reason: "error", detail: (e as Error).message }));

  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    await mkdir(home, { recursive: true });
    await utimes(home, new Date(), new Date());
    await deps.progress("cloning");
    const fullCloned = locked(full, () => ensureClone(deps.run, { url, dir: full, blobless: false, env, timeoutMs: cloneLimit })).catch(
      (e: unknown): Cloned => ({ ok: false, reason: "error", detail: (e as Error).message }),
    );
    void fullCloned.then(() => {
      cloneDone = true;
    });
    const quick = join(scratch, "quick");
    const quickCloned: Promise<Cloned | null> =
      attempt > 1 ? Promise.resolve(null) : warm ? fullCloned : ensureClone(deps.run, { url, dir: quick, blobless: true, env, timeoutMs: cloneLimit });
    const quickDir = quickCloned.then((c) => (c?.ok ? (warm ? full : quick) : null)).catch(() => null);
    const accounts = quickDir.then(async (d) => d ?? ((await fullCloned).ok ? full : null)).then((d) => (d ? accountsFrom(d) : null));

    const quickPhase = guarded(async () => {
      const c = await quickCloned;
      if (!c) return { ok: false, reason: "error", detail: "no quick phase" };
      if (!c.ok) return failed(c);
      const dir = warm ? full : quick;
      const file = await accounts;
      await deps.progress("reading");
      const made = await report(dir, "quick", join(warm ? home : scratch, "cache"), file);
      if (!made.ok || fullMade) return made.ok ? { ok: true } : made;
      await deps.progress("uploading");
      quickPublished = await deps.publish("quick", made);
      if (!fullMade) await deps.progress(cloneDone ? "reading" : "cloning");
      return { ok: true };
    });

    const fullPhase = guarded(async () => {
      const c = await fullCloned;
      if (!c.ok) return failed(c);
      deps.log?.(`clone of ${req.owner}/${req.name}: ${c.fresh ? "cloned" : "brought up to date"} in ${c.seconds} s`);
      if (warm) await quickPhase;
      const file = await accounts;
      const made = await report(full, "full", join(home, "cache"), file);
      if (!made.ok) return made;
      fullMade = true;
      await quickPhase;
      await deps.progress("uploading");
      await deps.publish("full", made);
      return { ok: true };
    });

    const [q, f] = await Promise.all([quickPhase, fullPhase]);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    if (f.ok) return { published: "full", seconds, resumable: false };
    resumable = f.reason === "timed_out" && attempt < BUILD_ATTEMPTS;
    const why = { reason: f.reason, ...(f.detail ? { detail: f.detail } : {}) };
    return { published: q.ok && quickPublished ? "quick" : null, seconds, failure: why, resumable };
  } catch (e) {
    return { published: null, seconds: Math.round((Date.now() - started) / 100) / 10, failure: { reason: "error", detail: (e as Error).message }, resumable: false };
  } finally {
    await rm(scratch, { recursive: true, force: true });
    if (req.private && !resumable) await rm(home, { recursive: true, force: true });
  }
}
