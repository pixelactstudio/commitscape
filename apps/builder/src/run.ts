import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { setPriority } from "node:os";
import { join } from "node:path";
import type { BuildFailure, BuildStep } from "@commitscape/data";
import { appendable, type LiveIndex, type Loaded } from "@commitscape/server";
import { readSignatures, writeAccountsFile, type Signature } from "./accounts";
import { peakMb } from "./admission";
import { cloneUrl, ensureClone, gitEnv, locked, missingIn, tipsOf, type Cloned } from "./clone";
import type { Config } from "./config";
import { cacheFor, holdingCache, lineStoreOf, privateDir, repoDir, scratchDir } from "./disk";
import { readBuilt, readEvents, type Built } from "./engine";
import { prefetch } from "./lean";
import { hasCache } from "./state";
import { engineSpans, Phases } from "./telemetry";

export type BuildTarget = {
  id: string;
  repo: string;
  owner: string;
  name: string;
  sizeKb: number;
  private: boolean;
  token: string | null;
  seed: boolean;
  attempt?: number;
  hasLines?: boolean;
  more?: boolean;
  lean?: boolean;
  forkOf?: string | null;
};

export type Phase = "quick" | "full";

export type Made = Built & { phase: Phase; dir: string; loaded: Loaded; before: LiveIndex | null; seconds: number };

type Failed = { reason: BuildFailure; detail?: string };

export type Outcome = { published: Phase | null; seconds: number; failure?: Failed; resumable: boolean; kind: Phases["kind"]; made: Made | null };

export const BUILD_ATTEMPTS = 4;

const CHECK_MS = 60_000;

const doubled = (base: number, attempt: number) => base * 2 ** (Math.min(Math.max(attempt, 1), BUILD_ATTEMPTS) - 1);

/** How long commitscape may take over one run in one attempt at a Build: the time limit, doubled for each attempt after the first. */
export function timeLimitOf(cfg: Config, attempt = 1): number {
  return doubled(cfg.timeLimit, attempt);
}

/** How long one clone may take in one attempt at a Build: the clone time limit, doubled for each attempt after the first. */
export function cloneLimitOf(cfg: Config, attempt = 1): number {
  return doubled(cfg.cloneLimit, attempt);
}

/** How long the queue lets one attempt at a Build run: its clone, its two runs of commitscape, its git data and the time to store what they wrote. */
/** The seconds a full build may count lines for: the person-facing budget, or for a quiet Build counting the lines left the longer one, kept two minutes inside the engine's time limit for the history walk and the export. */
export function linesBudgetOf(cfg: Config, binLimit: number, more: boolean): number {
  if (!more) return cfg.linesBudget;
  return Math.max(cfg.linesBudget, Math.min(cfg.moreLinesBudget, binLimit - 120));
}

export function jobLimitOf(cfg: Config, attempt = 1): number {
  return cloneLimitOf(cfg, attempt) + 2 * timeLimitOf(cfg, attempt) + (cfg.git?.seconds ?? 0) + 600;
}

export type Ran = { code: number | null; stderr: string; timedOut: boolean; stdout?: string };

export type RunOptions = { nice?: number; input?: string; maxStdout?: number; memoryMb?: number };

const PASSED = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "PATHEXT", "USERPROFILE", "SSL_CERT_FILE", "SSL_CERT_DIR"];
export function passed(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => PASSED.includes(k) || k.startsWith("COMMITSCAPE_")));
}

function lowered(pid: number, nice: number): boolean {
  try {
    setPriority(pid, nice);
    return true;
  } catch {
    return false;
  }
}

/** Runs a command with only safe environment variables, at a lower priority when `nice` is given, killing it and its children after `timeoutMs`. */
export type Runner = (cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, opts?: RunOptions) => Promise<Ran>;

export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number, opts: RunOptions = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...passed(), ...env }, stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"], detached: true });
    if (opts.nice !== undefined && child.pid) lowered(child.pid, opts.nice);
    let stderr = "";
    const most = opts.maxStdout ?? 1_000_000;
    const chunks: Buffer[] = [];
    let held = 0;
    child.stdout?.on("data", (d: Buffer) => {
      if (held >= most) return;
      chunks.push(d);
      held += d.length;
    });
    let timedOut = false;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr, timedOut, stdout: Buffer.concat(chunks).toString() });
    };
    child.stderr?.on("data", (d: Buffer) => {
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
    if (opts.input !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(opts.input);
    }
  });
}

export type IndexStore = { live: () => Promise<LiveIndex | null>; load: (dir: string) => Promise<Loaded> };

export type StateStore = { restore: (root: string) => Promise<{ restored: boolean; bytes: number }>; save: (root: string) => Promise<{ uploaded: number; sent: number; bytes: number }> };

export type Deps = {
  run: typeof run;
  state?: StateStore;
  prefetch?: typeof prefetch;
  progress: (step: BuildStep) => Promise<void>;
  accounts: (signatures: Signature[]) => Promise<Record<string, string>>;
  index: IndexStore;
  publish: (made: Made) => Promise<boolean>;
  git?: (dir: string, env: NodeJS.ProcessEnv) => Promise<void>;
  log?: (line: string) => void;
  phases?: Phases;
};

export const NAME = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;

type Step = { ok: true } | ({ ok: false } & Failed);
type Engined = { ok: true; made: Made } | ({ ok: false } & Failed);

const lastLine = (text: string) => text.trim().split("\n").at(-1);
const failed = (c: Cloned): Step => (c.ok ? { ok: true } : { ok: false, reason: c.reason, ...(c.detail ? { detail: c.detail } : {}) });

/** Reads a repository with as little work as it needs. Cold, with no clone kept and no Stored Index with lines: a clone without old file contents gives a Stored Index without Lines Changed to publish at once, while a full clone fills its lines in. Warm, the kept clone is brought up to date and built once. The full build's line pass stops at the lines budget, and git data is read from the full clone beside it. */
export async function build(req: BuildTarget, cfg: Config, deps: Deps): Promise<Outcome> {
  const phases = deps.phases ?? new Phases();
  if (!NAME.test(req.owner) || !NAME.test(req.name) || req.name === "." || req.name === "..") {
    return { published: null, seconds: 0, failure: { reason: "not_found", detail: "not a repository name" }, resumable: false, kind: phases.kind, made: null };
  }
  const sizeMb = req.sizeKb / 1024;
  if (cfg.maxMb !== undefined && sizeMb > cfg.maxMb) return { published: null, seconds: 0, failure: { reason: "too_big", detail: `${Math.round(sizeMb)} MB` }, resumable: false, kind: phases.kind, made: null };
  const started = Date.now();
  const attempt = req.attempt ?? 1;
  const binLimit = timeLimitOf(cfg, attempt);
  const cloneLimit = cloneLimitOf(cfg, attempt) * 1000;
  const home = req.private ? privateDir(cfg, req.id) : repoDir(cfg, req.owner, req.name);
  const lean = !req.private && !!req.lean && attempt === 1;
  const full = join(home, lean ? "lean" : "full");
  const scratch = scratchDir(cfg, req.id);
  const quick = join(scratch, "quick");
  const env = gitEnv(req.token);
  const engineEnv: NodeJS.ProcessEnv = { ...env, ...(cfg.threads ? { COMMITSCAPE_THREADS: String(cfg.threads) } : {}) };
  const url = cloneUrl(cfg, req.owner, req.name);
  const cacheRoot = await cacheFor(cfg, { isPrivate: !!req.private, owner: req.owner, name: req.name, home });
  const cache = ["--cache-dir", cacheRoot, "--cache-key", req.repo];
  const cached: typeof deps.run = (cmd, args, env, timeoutMs, opts) => holdingCache(cacheRoot, () => deps.run(cmd, args, env, timeoutMs, opts));
  const state = req.private ? undefined : deps.state;
  let restoring: Promise<unknown> = Promise.resolve();
  const warm = existsSync(join(full, ".git"));
  phases.kind = warm ? "warm" : "cold";
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  let resumable = false;
  let quickMade: Made | null = null;
  let fullMade: Made | null = null;
  let fullCloned = false;

  const engine = async (phase: Phase, dir: string, accounts: string | null): Promise<Engined> => {
    await restoring;
    const out = join(scratch, `${phase}.out`);
    const events = join(scratch, `${phase}.events`);
    await rm(out, { recursive: true, force: true });
    await rm(events, { force: true });
    const before = await deps.index.live();
    const kind = (await hasCache(cacheRoot)) ? "build" : "cold";
    const memoryMb = peakMb(kind, { commits: before?.commits ?? 0, sizeKb: req.sizeKb });
    const args = ["build", ...(phase === "quick" ? ["--no-lines"] : ["--lines-budget", String(linesBudgetOf(cfg, binLimit, !!req.more))]), "--offline", "--max-changeset-size", String(cfg.bulkFiles), ...cache, "--events", events, "--out", out];
    if (accounts) args.push("--accounts", accounts);
    const seed = phase === "full" && req.forkOf ? await lineStoreOf(cfg, req.forkOf) : null;
    if (seed) args.push("--lines-from", seed);
    if (appendable(before)) {
      const frontier = join(scratch, `${phase}.frontier`);
      await writeFile(frontier, before.frontier.join("\n"));
      args.push("--after", frontier, "--lineage", before.lineage, ...(before.mark ? ["--since", before.mark] : []));
    }
    args.push("--", dir);
    const t = Date.now();
    const ran = await phases.time(`build ${phase}`, "engine", async () => {
      const done = await cached(cfg.bin, args, engineEnv, binLimit * 1000, { nice: cfg.nice, memoryMb });
      engineSpans(await readEvents(events));
      return done;
    });
    const took = Math.round((Date.now() - t) / 100) / 10;
    if (ran.timedOut) return { ok: false, reason: "timed_out", detail: `${binLimit} s` };
    if (ran.code !== 0) return { ok: false, reason: "error", ...(ran.stderr ? { detail: lastLine(ran.stderr) } : {}) };
    try {
      const built = await readBuilt(out);
      const loaded = await phases.time(`load ${phase}`, "db", () => deps.index.load(out));
      deps.log?.(
        `index of ${req.owner}/${req.name}: ${loaded.full ? "loaded" : "appended"} ${loaded.commits} of ${loaded.total} commits, ${loaded.mainline} moved on the Mainline, ${loaded.lines} given lines, in ${loaded.seconds.toFixed(1)} s`,
      );
      return { ok: true, made: { ...built, phase, dir: out, loaded, before, seconds: took } };
    } catch (e) {
      return { ok: false, reason: "error", detail: (e as Error).message };
    }
  };

  const accountsFrom = async (dir: string): Promise<string | null> => {
    await restoring;
    const events = join(scratch, "signatures.events");
    const signatures = await phases.time("signatures", "engine", async () => {
      const sized = { commits: (await deps.index.live())?.commits ?? 0, sizeKb: req.sizeKb };
      const found = await readSignatures(cached, { bin: cfg.bin, dir, scratch, cache, env: engineEnv, timeoutMs: binLimit * 1000, nice: cfg.nice, memoryMb: peakMb("signatures", sized), events, ...(deps.log ? { log: deps.log } : {}) });
      engineSpans(await readEvents(events));
      return found;
    });
    if (!signatures) return null;
    try {
      return await writeAccountsFile(scratch, await phases.time("logins", "http.client", () => deps.accounts(signatures)));
    } catch (e) {
      deps.log?.(`accounts: ${(e as Error).message}`);
      return null;
    }
  };

  const leanClone = async (): Promise<Cloned> => {
    const c = await ensureClone(deps.run, { url, dir: full, blobless: true, checkout: false, env, timeoutMs: cloneLimit });
    if (!c.ok) return c;
    const live = await deps.index.live();
    const fetched = await (deps.prefetch ?? prefetch)(full, env, live?.frontier ?? [], cloneLimit, cfg.bulkFiles);
    deps.log?.(`clone of ${req.owner}/${req.name}: blobless, ${fetched} file versions fetched for this Build`);
    return c;
  };
  const fullClone = () => locked(full, () => (lean ? leanClone() : ensureClone(deps.run, { url, dir: full, blobless: false, env, timeoutMs: cloneLimit })));

  const caughtUp = async () => {
    const missing = await missingIn(deps.run, full, await tipsOf(deps.run, quick, env, CHECK_MS), env, CHECK_MS);
    if (missing.length === 0) return;
    deps.log?.(`clone of ${req.owner}/${req.name}: the full clone lacked ${missing.length} of the quick clone's tips, so it is brought up to date again`);
    await phases.time("clone again", "git.clone", fullClone);
  };

  const guarded = (fn: () => Promise<Step>): Promise<Step> => fn().catch((e: unknown) => ({ ok: false, reason: "error", detail: (e as Error).message }));

  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    await mkdir(home, { recursive: true });
    await utimes(home, new Date(), new Date());
    if (state) {
      restoring = phases
        .time("restore state", "state", () => holdingCache(cacheRoot, () => state.restore(cacheRoot)))
        .then((r) => r.restored && deps.log?.(`state of ${req.owner}/${req.name}: restored ${Math.round(r.bytes / 1e6)} MB from R2`))
        .catch((e: unknown) => deps.log?.(`state of ${req.owner}/${req.name} not restored: ${(e as Error).message}`));
    }
    const live = await deps.index.live();
    const quickWanted = attempt === 1 && !warm && !req.hasLines && !live?.lines;
    await deps.progress("cloning");
    const fullDone = phases.time("clone full", "git.clone", fullClone).catch((e: unknown): Cloned => ({ ok: false, reason: "error", detail: (e as Error).message }));
    void fullDone.then(() => {
      fullCloned = true;
    });
    const quickDone: Promise<Cloned | null> = quickWanted
      ? phases.time("clone quick", "git.clone", () => ensureClone(deps.run, { url, dir: quick, blobless: true, env, timeoutMs: cloneLimit })).catch((e: unknown): Cloned => ({ ok: false, reason: "error", detail: (e as Error).message }))
      : Promise.resolve(null);
    const firstClone = new Promise<string | null>((resolve) => {
      let waiting = quickWanted ? 2 : 1;
      const settle = (dir: string | null) => {
        if (dir) resolve(dir);
        else if (--waiting === 0) resolve(null);
      };
      void quickDone.then((c) => c && settle(c.ok ? quick : null));
      void fullDone.then((c) => settle(c.ok ? full : null));
    });
    const accounts = firstClone.then((d) => (d ? accountsFrom(d) : null));

    const quickPhase = guarded(async () => {
      const c = await quickDone;
      if (!c) return { ok: false, reason: "error", detail: "no quick phase" };
      if (!c.ok) return failed(c);
      const file = await accounts;
      await deps.progress("reading");
      const done = await engine("quick", quick, file);
      if (!done.ok) return done;
      await deps.progress("uploading");
      if (await phases.time("publish quick", "publish", () => deps.publish(done.made))) quickMade = done.made;
      await deps.progress(fullCloned ? "reading" : "cloning");
      return { ok: true };
    });

    const fullPhase = guarded(async () => {
      const c = await fullDone;
      if (!c.ok) return failed(c);
      deps.log?.(`clone of ${req.owner}/${req.name}: ${c.fresh ? "cloned" : "brought up to date"} in ${c.seconds} s`);
      if ((await quickDone)?.ok) await caughtUp();
      const git = deps.git;
      const gitData =
        git && !req.more
          ? phases.time("git data", "git", () => git(full, env)).catch((e: unknown) => deps.log?.(`git data of ${req.owner}/${req.name}: ${(e as Error).message}`))
          : Promise.resolve();
      try {
        await quickPhase;
        const file = await accounts;
        await deps.progress("reading");
        const done = await engine("full", full, file);
        if (!done.ok) return done;
        await deps.progress("uploading");
        if (await phases.time("publish full", "publish", () => deps.publish(done.made))) fullMade = done.made;
        return { ok: true };
      } finally {
        await gitData;
      }
    });

    const [, f] = await Promise.all([quickPhase, fullPhase]);
    const made = fullMade ?? quickMade;
    if (state && made) {
      await phases
        .time("save state", "state", () => holdingCache(cacheRoot, () => state.save(cacheRoot)))
        .then((s) => deps.log?.(`state of ${req.owner}/${req.name}: ${s.uploaded} new chunks, ${Math.round(s.sent / 1e6)} MB sent, ${Math.round(s.bytes / 1e6)} MB kept`))
        .catch((e: unknown) => deps.log?.(`state of ${req.owner}/${req.name} not saved: ${(e as Error).message}`));
    }
    const published: Phase | null = fullMade ? "full" : quickMade ? "quick" : null;
    if (f.ok && lean && fullMade) await rm(join(home, "full"), { recursive: true, force: true });
    if (f.ok) return { published, seconds: seconds(), resumable: false, kind: phases.kind, made };
    resumable = f.reason === "timed_out" && attempt < BUILD_ATTEMPTS;
    return { published, seconds: seconds(), failure: { reason: f.reason, ...(f.detail ? { detail: f.detail } : {}) }, resumable, kind: phases.kind, made };
  } catch (e) {
    return { published: null, seconds: seconds(), failure: { reason: "error", detail: (e as Error).message }, resumable: false, kind: phases.kind, made: null };
  } finally {
    await rm(scratch, { recursive: true, force: true });
    if (req.private && !resumable) await rm(home, { recursive: true, force: true });
    else await utimes(home, new Date(), new Date()).catch(() => undefined);
  }
}
