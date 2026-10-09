import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { now, schema, type Db } from "@commitscape/server";
import type { Config } from "./config";

const { builds, repositories, surviving } = schema;

export const KEPT_FOR = 24 * 3600;

export const holding = new Set<string>();

const LEGACY = /^(clones|health|out|[0-9a-f]{16})$/;

/** Where a public repository's kept clone and commitscape's cache for it live. */
export const repoDir = (cfg: Config, owner: string, name: string) => join(cfg.work, "repos", owner, name);

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

async function kept(work: string): Promise<string[]> {
  const out: string[] = [];
  for (const owner of await readdir(join(work, "repos")).catch(() => [])) {
    for (const name of await readdir(join(work, "repos", owner)).catch(() => [])) out.push(join(work, "repos", owner, name));
  }
  return out;
}

/** The folders of public repositories with a Build or Surviving Lines still to come, which pruning must leave. */
export async function inUse(db: Db, cfg: Config, at = now()): Promise<string[]> {
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
  return repos.map((r) => repoDir(cfg, r.owner, r.name));
}

/** Deletes the least recently used repository folders until the work folder fits the budget, leaving the ones in `keep`. */
export async function prune(work: string, budget: number, keep: Iterable<string> = []): Promise<string[]> {
  const left = new Set(keep);
  const found = await Promise.all((await kept(work)).map(async (path) => ({ path, bytes: await size(path), at: (await stat(path)).mtimeMs })));
  let total = found.reduce((n, c) => n + c.bytes, 0);
  const deleted: string[] = [];
  for (const c of found.sort((a, b) => a.at - b.at)) {
    if (total <= budget) break;
    if (left.has(c.path)) continue;
    await rm(c.path, { recursive: true, force: true });
    total -= c.bytes;
    deleted.push(c.path);
  }
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
