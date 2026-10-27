import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { now, schema, type Db } from "@commitscape/server";
import { locked } from "./clone";
import type { Config } from "./config";

const { builds, repositories, surviving } = schema;

export const KEPT_FOR = 24 * 3600;

const REPO_PART = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;

export const holding = new Set<string>();

const LEGACY = /^(clones|health|out|[0-9a-f]{16})$/;

/** Where a public repository's kept clone and commitscape's cache for it live. */
export const repoDir = (cfg: Config, owner: string, name: string) => join(cfg.work, "repos", owner, name);

/** Where commitscape's cache for a public repository lives: apart from its clone, so pruning the clone never loses the history read from it. */
export const cacheDir = (cfg: Config, owner: string, name: string) => join(cfg.work, "caches", owner, name);

/** The cache folder a job hands commitscape: a public repository's lasting one, moved out of its clone's folder where older Builders kept it and marked as just used; a private repository's inside `home`, which its job deletes. */
export async function cacheFor(cfg: Config, repo: { isPrivate: boolean; owner: string; name: string; home: string }): Promise<string> {
  if (repo.isPrivate) return join(repo.home, "cache");
  const dir = cacheDir(cfg, repo.owner, repo.name);
  const old = join(repoDir(cfg, repo.owner, repo.name), "cache");
  await mkdir(dirname(dir), { recursive: true });
  if (existsSync(old) && !existsSync(dir)) await rename(old, dir).catch(() => undefined);
  await mkdir(dir, { recursive: true });
  await utimes(dir, new Date(), new Date()).catch(() => undefined);
  return dir;
}

/** A copy at `into` of the line store a public repository's kept cache holds, such as a fork's parent's, for a fork's first count of lines to start from, made while holding that repository; null when there is none on this disk. */
export async function lineStoreOf(cfg: Config, repo: string, into: string): Promise<string | null> {
  const [owner = "", name = "", ...rest] = repo.split("/");
  if (rest.length > 0 || !REPO_PART.test(owner) || !REPO_PART.test(name) || name === "." || name === "..") return null;
  return holdingRepo(repoDir(cfg, owner, name), async () => {
    const root = cacheDir(cfg, owner, name);
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      const lines = join(root, entry.name, "lines");
      if (!entry.isDirectory() || !existsSync(lines)) continue;
      await copyFile(lines, into);
      return into;
    }
    return null;
  });
}

/** Runs `fn` holding a repository, named by its folder: its kept clones and its cache. A Build, a count of Surviving Lines and a repack of one of its clones never overlap, and each waits for the memory a run takes only while holding it, never the other way round. */
export function holdingRepo<T>(home: string, fn: () => Promise<T>): Promise<T> {
  return locked(`repo:${home}`, fn);
}

/** Where a private repository's clone and cache live while one job uses them. */
export const privateDir = (cfg: Config, key: string) => join(cfg.work, "private", key);

/** Where one Build keeps its quick clone and the files it hands commitscape. */
export const scratchDir = (cfg: Config, key: string) => join(cfg.work, "jobs", key);

async function size(path: string): Promise<number> {
  const s = await stat(path).catch(() => null);
  if (!s) return 0;
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await size(join(path, entry));
  return total;
}

export type Kept = "repos" | "caches";

type Sizes = Record<string, { bytes: number; at: number }>;

const SIZES = "sizes.json";

async function readSizes(work: string): Promise<Sizes> {
  const text = await readFile(join(work, SIZES), "utf8").catch(() => "{}");
  try {
    return JSON.parse(text) as Sizes;
  } catch {
    return {};
  }
}

async function writeSizes(work: string, sizes: Sizes): Promise<void> {
  const tmp = join(work, `${SIZES}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(sizes))
    .then(() => rename(tmp, join(work, SIZES)))
    .catch(() => rm(tmp, { force: true }));
}

async function kept(work: string, folder: Kept): Promise<string[]> {
  const out: string[] = [];
  for (const owner of await readdir(join(work, folder)).catch(() => [])) {
    for (const name of await readdir(join(work, folder, owner)).catch(() => [])) out.push(join(work, folder, owner, name));
  }
  return out;
}

/** The folders (clones by default, or what `where` names) of public repositories with a Build or Surviving Lines still to come, which pruning must leave. */
export async function inUse(db: Db, cfg: Config, where: (cfg: Config, owner: string, name: string) => string = repoDir, at = now()): Promise<string[]> {
  const building = db
    .select({ id: builds.repoId })
    .from(builds)
    .where(and(inArray(builds.state, ["queued", "running"]), gt(builds.requestedAt, at - KEPT_FOR)));
  const counting = db
    .select({ id: surviving.repoId })
    .from(surviving)
    .where(and(eq(surviving.status, "queued"), gt(surviving.askedAt, at - KEPT_FOR)));
  const repos = await db
    .select({ owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(and(eq(repositories.isPrivate, false), or(inArray(repositories.id, building), inArray(repositories.id, counting))));
  return repos.map((r) => where(cfg, r.owner, r.name));
}

/** Deletes the least recently used repository folders (clones, or with `folder` caches) until they fit the budget, and with `maxAgeMs` every one unused for longer, leaving the ones in `keep`. A folder is measured again only when it was used since it was last measured. */
export async function prune(work: string, budget: number, keep: Iterable<string> = [], folder: Kept = "repos", maxAgeMs?: number): Promise<string[]> {
  const left = new Set(keep);
  const known = await readSizes(work);
  const found = await Promise.all(
    (await kept(work, folder)).map(async (path) => {
      const at = (await stat(path)).mtimeMs;
      const was = known[path];
      return { path, bytes: was?.at === at ? was.bytes : await size(path), at };
    }),
  );
  let total = found.reduce((n, c) => n + c.bytes, 0);
  const deleted: string[] = [];
  const oldest = maxAgeMs === undefined ? -Infinity : Date.now() - maxAgeMs;
  for (const c of found.sort((a, b) => a.at - b.at)) {
    if (total <= budget && c.at >= oldest) break;
    if (left.has(c.path)) continue;
    await rm(c.path, { recursive: true, force: true });
    total -= c.bytes;
    deleted.push(c.path);
  }
  const sizes = await readSizes(work);
  const prefix = join(work, folder) + "/";
  for (const path of Object.keys(sizes)) if (path.startsWith(prefix)) delete sizes[path];
  for (const c of found) if (!deleted.includes(c.path)) sizes[c.path] = { bytes: c.bytes, at: c.at };
  await writeSizes(work, sizes);
  return deleted;
}

/** Deletes the private clones and scratch folders no queued or running Build or running job owns, and what older Builders left in the work folder. */
export async function sweep(db: Db, cfg: Config, running: Iterable<string> = holding): Promise<string[]> {
  const open = await db.select({ id: builds.id }).from(builds).where(inArray(builds.state, ["queued", "running"]));
  const owned = new Set([...open.map((b) => b.id), ...running]);
  const deleted: string[] = [];
  for (const kind of ["private", "jobs"]) {
    for (const key of await readdir(join(cfg.work, kind)).catch(() => [])) {
      if (owned.has(key)) continue;
      await rm(join(cfg.work, kind, key), { recursive: true, force: true });
      deleted.push(join(cfg.work, kind, key));
    }
  }
  for (const entry of await readdir(cfg.work).catch(() => [])) {
    if (!LEGACY.test(entry)) continue;
    await rm(join(cfg.work, entry), { recursive: true, force: true });
    deleted.push(join(cfg.work, entry));
  }
  return deleted;
}
