import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BuildFailure } from "@commitscape/data";
import type { Config } from "./config";
import type { run as runCommand } from "./run";

export type Cloned = { ok: true; fresh: boolean; seconds: number } | { ok: false; reason: BuildFailure; detail?: string };

/** The environment git runs in: no prompts, and a private repository's token as a header, never in an argument, a URL or the clone's config. */
export function gitEnv(token: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };
  if (token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
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

/** Brings a kept clone up to date, or clones the repository afresh beside `dir` and moves it there once whole; `blobless` leaves old file contents on GitHub. */
export async function ensureClone(
  run: typeof runCommand,
  how: { url: string; dir: string; blobless: boolean; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<Cloned> {
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
      ["reset", "--quiet", "--hard", "origin/HEAD"],
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
  const args = ["clone", "--quiet", ...(how.blobless ? ["--filter=blob:none"] : []), "--", how.url, temp];
  const ran = await run("git", args, { ...how.env, GIT_CEILING_DIRECTORIES: parent }, left());
  if (ran.timedOut || ran.code !== 0) {
    await rm(temp, { recursive: true, force: true });
    return ran.timedOut ? timedOut : { ok: false, reason: failure(ran.stderr), detail: lastLine(ran.stderr) };
  }
  await rm(how.dir, { recursive: true, force: true });
  await rename(temp, how.dir);
  return { ok: true, fresh: true, seconds: seconds() };
}
