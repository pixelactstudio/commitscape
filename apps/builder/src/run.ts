import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { BuildFailure, BuildStats, BuildStep } from "@commitscape/data";
import type { Config } from "./config";

export type BuildTarget = {
  id: string;
  owner: string;
  name: string;
  sizeKb: number;
  private: boolean;
  token: string | null;
  seed: boolean;
};

export type Outcome =
  | {
      ok: true;
      seconds: number;
      lines: boolean;
      partial: boolean;
      stats?: BuildStats;
      report: Uint8Array;
    }
  | { ok: false; reason: BuildFailure; detail?: string };

export const REPORT_MAX = 64 * 1024 * 1024;

export type Ran = { code: number | null; stderr: string; timedOut: boolean; stdout?: string };

export function statsOf(gzipped: Uint8Array): BuildStats | null {
  try {
    const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as { stats?: BuildStats | null };
    return report.stats ?? null;
  } catch {
    return null;
  }
}

export function answersOf(text: string): { answered: number; typical_hours: number | null } | null {
  try {
    const h = JSON.parse(text) as { answers?: { answered: number; typical_hours: number | null } | null };
    return h.answers ?? null;
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
};

export function failure(stderr: string): BuildFailure {
  if (/repository ['"]?[^\n]*['"]? not found|Repository not found|does not appear to be a git repository|\b404\b/i.test(stderr)) return "not_found";
  if (/Authentication failed|could not read Username|terminal prompts disabled|\b403\b/i.test(stderr)) return "private";
  return "error";
}

export function cacheRoot(cfg: Config, req: BuildTarget): string {
  return req.private ? join(cfg.work, "private", req.id) : cfg.work;
}

export function clonePath(cfg: Config, req: BuildTarget, partial: boolean): string {
  return join(cacheRoot(cfg, req), partial ? "health" : "clones", req.owner, req.name);
}

export const NAME = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;

/** The environment a commitscape command runs in: no prompts, the token as a header for private clones, the git base for tests. */
export function gitEnv(cfg: Config, token: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    env.GH_TOKEN = token;
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  if (cfg.gitBase) env.COMMITSCAPE_GIT_BASE = cfg.gitBase;
  return env;
}

/** Clones and reads a repository with the commitscape binary and returns its Report. */
export async function build(req: BuildTarget, cfg: Config, deps: Deps): Promise<Outcome> {
  if (!NAME.test(req.owner) || !NAME.test(req.name) || req.name === "." || req.name === "..") {
    return { ok: false, reason: "not_found", detail: "not a repository name" };
  }
  const started = Date.now();
  const sizeMb = req.sizeKb / 1024;
  if (sizeMb > cfg.maxMb) return { ok: false, reason: "too_big", detail: `${Math.round(sizeMb)} MB` };
  const partial = sizeMb > cfg.fullUpToMb;
  const out = join(cfg.work, "out");
  await mkdir(out, { recursive: true });
  const report = join(out, `${req.id}.json.gz`);
  const env = gitEnv(cfg, req.token);
  const left = () => Math.max(1000, cfg.timeLimit * 1000 - (Date.now() - started));
  try {
    await deps.progress("reading");
    const args = ["report", "--no-emails", "--offline", "--window", "all", "--cache-dir", cacheRoot(cfg, req), "--out", report];
    if (partial) args.push("--partial");
    args.push("--", `${req.owner}/${req.name}`);
    const made = await deps.run(cfg.bin, args, env, left());
    if (made.timedOut) return { ok: false, reason: "timed_out", detail: `${cfg.timeLimit} s` };
    if (made.code !== 0) return { ok: false, reason: failure(made.stderr), detail: made.stderr.trim().split("\n").at(-1) };
    const bytes = new Uint8Array(await readFile(report));
    if (bytes.length > REPORT_MAX) return { ok: false, reason: "too_big", detail: `a ${Math.round(bytes.length / 1024 ** 2)} MB Report` };
    let stats = statsOf(bytes);
    if (req.seed && stats) {
      const seedEnv = process.env.GITHUB_TOKEN ? { ...env, GH_TOKEN: process.env.GITHUB_TOKEN } : env;
      const health = await deps.run(cfg.bin, ["health", "--json", "--cache-dir", cfg.work, "--", `${req.owner}/${req.name}`], seedEnv, left());
      const answers = health.code === 0 ? answersOf(health.stdout ?? "") : null;
      stats = { ...stats, answered: answers?.answered ?? null, answer_hours: answers?.typical_hours ?? null };
    }
    await deps.progress("uploading");
    return {
      ok: true,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      lines: !partial,
      partial,
      ...(stats ? { stats } : {}),
      report: bytes,
    };
  } catch (e) {
    return { ok: false, reason: "error", detail: (e as Error).message };
  } finally {
    await rm(report, { force: true });
    if (req.private) await rm(cacheRoot(cfg, req), { recursive: true, force: true });
  }
}
