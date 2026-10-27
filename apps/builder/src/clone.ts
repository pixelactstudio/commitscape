import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BuildFailure } from "@commitscape/data";
import type { Config } from "./config";
import type { run as runCommand } from "./run";

export type Cloned = { ok: true; fresh: boolean; seconds: number } | { ok: false; reason: BuildFailure; detail?: string };

/** The environment git runs in: no prompts, a commit-graph kept up to date on every fetch, and a private repository's token as a header, never in an argument, a URL or the clone's config. */
export function gitEnv(token: string | null): NodeJS.ProcessEnv {
  const config: [string, string][] = [
    ["fetch.writeCommitGraph", "true"],
    ["core.commitGraph", "true"],
  ];
  if (token) config.push(["http.https://github.com/.extraheader", `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`]);
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: String(config.length) };
  config.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/** Where a repository is cloned from: GitHub, or the git base tests set. */
export function cloneUrl(cfg: Config, owner: string, name: string): string {
  return `${(cfg.gitBase ?? "https://github.com").replace(/\/$/, "")}/${owner}/${name}.git`;
}

export function failure(stderr: string): BuildFailure {
  if (/repository ['"]?[^\n]*['"]? not found|Repository not found|does not appear to be a git repository|\b404\b/i.test(stderr)) return "not_found";
  if (/Authentication failed|could not read Username|terminal prompts disabled|\b403\b/i.test(stderr)) return "private";
  return "error";
}

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` once every earlier call with the same key has finished. */
export function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = locks.get(key) ?? Promise.resolve();
  const next = before.catch(() => {}).then(fn);
  const held = next.catch(() => {});
  locks.set(key, held);
  void held.then(() => {
    if (locks.get(key) === held) locks.delete(key);
  });
  return next;
}

const lastLine = (text: string) => text.trim().split("\n").at(-1);

/** Brings a kept clone up to date, or clones the repository afresh beside `dir` and moves it there once whole; `blobless` leaves old file contents on GitHub, and `checkout: false` writes no files out, only moving the branch, so a blobless clone fetches none. */
export async function ensureClone(
  run: typeof runCommand,
  how: { url: string; dir: string; blobless: boolean; env: NodeJS.ProcessEnv; timeoutMs: number; checkout?: boolean },
): Promise<Cloned> {
  const checkout = how.checkout ?? true;
  const started = Date.now();
  const left = () => Math.max(1000, how.timeoutMs - (Date.now() - started));
  const seconds = () => Math.round((Date.now() - started) / 100) / 10;
  const timedOut = { ok: false, reason: "timed_out", detail: `${Math.round(how.timeoutMs / 1000)} s` } as const;
  if (existsSync(join(how.dir, ".git"))) {
    const inside = { ...how.env, GIT_DIR: join(how.dir, ".git"), GIT_WORK_TREE: how.dir };
    let ok = true;
    for (const args of [
      ["rev-parse", "--quiet", "--verify", "HEAD"],
      ["fetch", "--quiet", "--prune", "--tags", "origin"],
      ["reset", "--quiet", checkout ? "--hard" : "--soft", "origin/HEAD"],
    ]) {
      const ran = await run("git", args, inside, left());
      if (ran.timedOut) return timedOut;
      if (ran.code !== 0) {
        ok = false;
        break;
      }
    }
    if (ok) return { ok: true, fresh: false, seconds: seconds() };
  }
  const parent = dirname(how.dir);
  const temp = join(parent, `.${basename(how.dir)}.cloning`);
  await mkdir(parent, { recursive: true });
  await rm(temp, { recursive: true, force: true });
  const args = ["clone", "--quiet", ...(how.blobless ? ["--filter=blob:none"] : []), ...(checkout ? [] : ["--no-checkout"]), "--", how.url, temp];
  const ran = await run("git", args, { ...how.env, GIT_CEILING_DIRECTORIES: parent }, left());
  if (ran.timedOut || ran.code !== 0) {
    await rm(temp, { recursive: true, force: true });
    return ran.timedOut ? timedOut : { ok: false, reason: failure(ran.stderr), detail: lastLine(ran.stderr) };
  }
  if (!how.blobless || !checkout) await run("git", ["commit-graph", "write", "--reachable", "--no-progress"], { ...how.env, GIT_DIR: join(temp, ".git") }, left());
  await rm(how.dir, { recursive: true, force: true });
  await rename(temp, how.dir);
  return { ok: true, fresh: true, seconds: seconds() };
}

/** The commit a repository's HEAD points at on its remote, asked without fetching anything; null when the remote cannot tell. */
export async function remoteHead(run: typeof runCommand, url: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string | null> {
  const ran = await run("git", ["ls-remote", "--", url, "HEAD"], env, timeoutMs);
  if (ran.code !== 0) return null;
  return /^([0-9a-f]{40}|[0-9a-f]{64})\tHEAD$/m.exec(ran.stdout ?? "")?.[1] ?? null;
}

const inClone = (dir: string, env: NodeJS.ProcessEnv) => ({ ...env, GIT_DIR: join(dir, ".git") });

/** The objects every ref of a clone points at. */
export async function tipsOf(run: typeof runCommand, dir: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string[]> {
  const ran = await run("git", ["for-each-ref", "--format=%(objectname)"], inClone(dir, env), timeoutMs);
  if (ran.code !== 0) return [];
  return [...new Set((ran.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]{40,64}$/.test(l)))];
}

/** Which of `ids` a clone lacks. */
export async function missingIn(run: typeof runCommand, dir: string, ids: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string[]> {
  if (ids.length === 0) return [];
  const ran = await run("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], inClone(dir, env), timeoutMs, { input: `${ids.join("\n")}\n` });
  if (ran.code !== 0) return [];
  return (ran.stdout ?? "").split("\n").flatMap((l) => (l.endsWith(" missing") ? [l.slice(0, -" missing".length)] : []));
}
