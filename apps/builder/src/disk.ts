import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

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

/** Deletes the least recently built clones until the work folder fits the budget. */
export async function prune(work: string, budget: number, keep?: string): Promise<string[]> {
  const found = await Promise.all(
    (await kept(work)).map(async (path) => ({ path, bytes: await size(path), at: (await stat(path)).mtimeMs })),
  );
  let total = found.reduce((n, c) => n + c.bytes, 0);
  const deleted: string[] = [];
  for (const c of found.sort((a, b) => a.at - b.at)) {
    if (total <= budget) break;
    if (c.path === keep) continue;
    await rm(c.path, { recursive: true, force: true });
    total -= c.bytes;
    deleted.push(c.path);
  }
  return deleted;
}
