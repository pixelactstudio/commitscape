/**
 * One Build (ADR-0015): pick the clone by size, run `commitscape report
 * --data` on the project (it clones into the work folder, or fetches only
 * what is new), draw its card, upload both to the Site, and say how it
 * ended. Anything that goes wrong is one of the failures the Site has
 * words for.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { BuildFailure, BuildOutcome, BuildRequest, BuildStats } from "@commitscape/data";
import type { Config } from "./config";
import type { Site } from "./site";

export type Ran = { code: number | null; stderr: string; timedOut: boolean; stdout?: string };

/** A Report's `stats`, read from its gzipped JSON. */
export function statsOf(gzipped: Uint8Array): BuildStats | null {
  try {
    const report = JSON.parse(gunzipSync(gzipped).toString("utf8")) as { stats?: BuildStats | null };
    return report.stats ?? null;
  } catch {
    return null;
  }
}

/** `health --json`'s issue answers. */
export function answersOf(text: string): { answered: number; typical_hours: number | null } | null {
  try {
    const h = JSON.parse(text) as { answers?: { answered: number; typical_hours: number | null } | null };
    return h.answers ?? null;
  } catch {
    return null;
  }
}

/**
 * The Builder's own environment a command may see: what finding programs,
 * a home and temporary files need, and commitscape's own settings
 * (`COMMITSCAPE_*`), never the Builder's secrets (`BUILDER_SECRET`,
 * `GITHUB_TOKEN`). A command that needs a token is given it by name.
 */
const PASSED = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "PATHEXT", "USERPROFILE", "SSL_CERT_FILE", "SSL_CERT_DIR"];
function passed(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => PASSED.includes(k) || k.startsWith("COMMITSCAPE_")));
}

/**
 * Runs a command, stopping it after `timeoutMs`: it and everything it
 * started (a `git clone`, say), as one process group.
 */
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
  site: Site;
  /** Draws a card's SVG as a PNG, when the machine can. */
  png: (svg: string) => Uint8Array | null;
};

/** What a failed `git` or `commitscape` said, in the Site's words. */
export function failure(stderr: string): BuildFailure {
  if (/repository ['"]?[^\n]*['"]? not found|Repository not found|does not appear to be a git repository|\b404\b/i.test(stderr)) return "not_found";
  if (/Authentication failed|could not read Username|terminal prompts disabled|\b403\b/i.test(stderr)) return "private";
  return "error";
}

/**
 * The cache folder a Build gives `commitscape`: the work folder, where
 * public repositories' clones and indexes are kept for the next Build, or
 * for a Connected Repository a folder of its own, deleted when its Build
 * ends, so nothing of its history stays (ADR-0017).
 */
export function cacheRoot(cfg: Config, req: BuildRequest): string {
  return req.private ? join(cfg.work, "private", req.id) : cfg.work;
}

/** Where `commitscape` keeps a project's clone in its cache folder. */
export function clonePath(cfg: Config, req: BuildRequest, partial: boolean): string {
  return join(cacheRoot(cfg, req), partial ? "health" : "clones", req.owner, req.name);
}

export async function build(req: BuildRequest, cfg: Config, deps: Deps): Promise<BuildOutcome> {
  const started = Date.now();
  const sizeMb = req.sizeKb / 1024;
  if (sizeMb > cfg.maxMb) return { ok: false, reason: "too_big", detail: `${Math.round(sizeMb)} MB` };
  const partial = sizeMb > cfg.fullUpToMb;
  const out = join(cfg.work, "out");
  await mkdir(out, { recursive: true });
  const report = join(out, `${req.id}.json.gz`);
  const card = join(out, `${req.id}.svg`);
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };
  if (req.token) {
    env.GH_TOKEN = req.token;
    // git reads the installation token from its environment only: never a
    // command line others can see, nor a file left behind (ADR-0017).
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${req.token}`).toString("base64")}`;
  }
  if (cfg.gitBase) env.COMMITSCAPE_GIT_BASE = cfg.gitBase;
  const left = () => Math.max(1000, cfg.timeLimit * 1000 - (Date.now() - started));
  try {
    await deps.site.progress(req.id, "reading");
    const args = ["report", "--data", "--no-emails", "--offline", "--window", "all", "--cache-dir", cacheRoot(cfg, req), "--out", report];
    if (partial) args.push("--partial");
    args.push(`${req.owner}/${req.name}`);
    const made = await deps.run(cfg.bin, args, env, left());
    if (made.timedOut) return { ok: false, reason: "timed_out", detail: `${cfg.timeLimit} s` };
    if (made.code !== 0) return { ok: false, reason: failure(made.stderr), detail: made.stderr.trim().split("\n").at(-1) };
    const drew = await deps.run(cfg.bin, ["card", "--window", "all", "--offline", "--cache-dir", cacheRoot(cfg, req), "--out", card, clonePath(cfg, req, partial)], env, left());
    const bytes = new Uint8Array(await readFile(report));
    // The Leaderboards' numbers: the Report's own, and for a seed, how fast
    // its issues are answered (`health`, which asks GitHub through gh).
    let stats = statsOf(bytes);
    if (req.seed && stats) {
      // A seed is public: `gh` asks GitHub with the Builder's own token, given by name.
      const seedEnv = process.env.GITHUB_TOKEN ? { ...env, GH_TOKEN: process.env.GITHUB_TOKEN } : env;
      const health = await deps.run(cfg.bin, ["health", "--json", "--cache-dir", cfg.work, `${req.owner}/${req.name}`], seedEnv, left());
      const answers = health.code === 0 ? answersOf(health.stdout ?? "") : null;
      stats = { ...stats, answered: answers?.answered ?? null, answer_hours: answers?.typical_hours ?? null };
    }
    await deps.site.progress(req.id, "uploading");
    await deps.site.upload(req.id, "report", bytes, "application/gzip", req.uploadToken);
    if (drew.code === 0) {
      const svg = await readFile(card, "utf8");
      const png = deps.png(svg);
      if (png) await deps.site.upload(req.id, "card", png, "image/png", req.uploadToken);
      else await deps.site.upload(req.id, "card", new TextEncoder().encode(svg), "image/svg+xml", req.uploadToken);
    }
    return { ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, lines: !partial, partial, ...(stats ? { stats } : {}) };
  } catch (e) {
    return { ok: false, reason: "error", detail: (e as Error).message };
  } finally {
    await rm(report, { force: true });
    await rm(card, { force: true });
    // A Connected Repository's history, its clone and index, is not kept once its Report is made (ADR-0017).
    if (req.private) await rm(cacheRoot(cfg, req), { recursive: true, force: true });
  }
}
