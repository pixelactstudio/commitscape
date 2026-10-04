import { realpath, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { now, schema, type Db } from "@commitscape/server";
import type { Config } from "./config";
import { clonePath } from "./run";

const { builds, repositories, surviving } = schema;

export const KEPT_FOR = 24 * 3600;

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
  for (const kind of ["clones", "health"]) {
    for (const owner of await readdir(join(work, kind)).catch(() => [])) {
      for (const name of await readdir(join(work, kind, owner)).catch(() => [])) out.push(join(work, kind, owner, name));
    }
  }
  for (const entry of await readdir(work).catch(() => [])) if (/^[0-9a-f]{16}$/.test(entry)) out.push(join(work, entry));
  return out;
}

/** The name commitscape gives a repository's folder in its cache: a hash of the clone's git directory. */
export function cacheKey(gitDir: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const b of Buffer.from(gitDir)) {
    hash ^= BigInt(b);
    hash = (hash * 0x1000000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The clones and cache folders of public repositories with a Build or Surviving Lines still to come, which pruning must leave. */
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
    .select({ id: repositories.id, owner: repositories.owner, name: repositories.name })
    .from(repositories)
    .where(and(eq(repositories.isPrivate, false), or(inArray(repositories.id, building), inArray(repositories.id, counting))));
  const paths: string[] = [];
  for (const r of repos) {
    const clone = clonePath(cfg, { id: r.id, owner: r.owner, name: r.name, sizeKb: 0, private: false, token: null, seed: false });
    paths.push(clone);
    const gitDir = await realpath(join(clone, ".git")).catch(() => null);
    if (gitDir) paths.push(join(cfg.work, cacheKey(gitDir)));
  }
  return paths;
}

/** Deletes the least recently built clones until the work folder fits the budget, leaving the ones in `keep`. */
export async function prune(work: string, budget: number, keep: Iterable<string> = []): Promise<string[]> {
  const left = new Set(keep);
  const found = await Promise.all(
    (await kept(work)).map(async (path) => ({ path, bytes: await size(path), at: (await stat(path)).mtimeMs })),
  );
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
