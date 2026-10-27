import { existsSync } from "node:fs";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { holdingRepo } from "./disk";
import type { Runner } from "./run";

const MOST_PACKS = 16;
const KINDS = [".idx", ".pack", ".rev", ".bitmap", ".promisor"];

type Pack = { name: string; bytes: number; promisor: boolean };

/** The packs a geometric repack merges, as git picks them: walking down from the largest while each pack is at least twice the next, every pack below the first that is not, then any larger pack under twice all of those. None when fewer than two would merge. */
export function smallPacks<P extends { bytes: number }>(packs: P[]): P[] {
  const sorted = [...packs].sort((a, b) => a.bytes - b.bytes);
  let split = sorted.length - 1;
  while (split > 0 && (sorted[split]?.bytes ?? 0) >= 2 * (sorted[split - 1]?.bytes ?? 0)) split--;
  if (split > 0) split++;
  let total = sorted.slice(0, split).reduce((sum, p) => sum + p.bytes, 0);
  while (split < sorted.length && (sorted[split]?.bytes ?? 0) < 2 * total) total += sorted[split++]?.bytes ?? 0;
  return split >= 2 ? sorted.slice(0, split) : [];
}

async function packsOf(dir: string): Promise<Pack[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const packs: Pack[] = [];
  for (const file of names) {
    if (!file.endsWith(".pack")) continue;
    const name = file.slice(0, -".pack".length);
    if (names.includes(`${name}.keep`) || !names.includes(`${name}.idx`)) continue;
    packs.push({ name, bytes: (await stat(join(dir, file))).size, promisor: names.includes(`${name}.promisor`) });
  }
  return packs;
}

async function keptClones(work: string): Promise<string[]> {
  const repos = join(work, "repos");
  const found: string[] = [];
  for (const owner of await readdir(repos).catch(() => [] as string[])) {
    for (const name of await readdir(join(repos, owner)).catch(() => [] as string[])) {
      for (const kind of ["full", "lean"]) {
        const dir = join(repos, owner, name, kind);
        if (existsSync(join(dir, ".git", "objects", "pack"))) found.push(dir);
      }
    }
  }
  return found;
}

/** Merges a clone's small packs into one as `git repack --geometric=2 -d` would, which git 2.39 refuses in a blobless clone: one thread and a bounded delta window, let in by `run` with the memory it takes, a pack holding promised objects staying a promisor pack. Says whether it merged any. */
export async function repackClone(run: Runner, dir: string, timeoutMs: number): Promise<boolean> {
  const packDir = join(dir, ".git", "objects", "pack");
  const packs = await packsOf(packDir);
  const merged = smallPacks(packs);
  if (merged.length === 0) return false;
  const names = new Set(merged.map((p) => p.name));
  const input = packs.map((p) => (names.has(p.name) ? `${p.name}.pack` : `^${p.name}.pack`)).join("\n");
  const mergedMb = merged.reduce((sum, p) => sum + p.bytes, 0) / 2 ** 20;
  const ran = await run("git", ["pack-objects", "--stdin-packs", "--window-memory=64m", "--threads=1", "-q", join(packDir, "pack")], { GIT_DIR: join(dir, ".git") }, timeoutMs, {
    input: `${input}\n`,
    memoryMb: Math.ceil(96 + 2 * mergedMb),
    nice: 19,
  });
  const made = /^[0-9a-f]{40,64}$/m.exec(ran.stdout ?? "")?.[0];
  if (ran.code !== 0 || !made) return false;
  if (merged.some((p) => p.promisor)) await writeFile(join(packDir, `pack-${made}.promisor`), "");
  for (const p of merged) {
    if (p.name === `pack-${made}`) continue;
    for (const kind of KINDS) await rm(join(packDir, `${p.name}${kind}`), { force: true });
  }
  await rm(join(packDir, "multi-pack-index"), { force: true });
  return true;
}

/** Repacks every kept clone holding more than `most` packs, each while holding its lock: the Builder turns git's own upkeep off, so this is the only time a clone is repacked. Returns the clones it repacked. */
export async function repackClones(run: Runner, work: string, timeoutMs: number, most = MOST_PACKS): Promise<string[]> {
  const done: string[] = [];
  for (const dir of await keptClones(work)) {
    if ((await packsOf(join(dir, ".git", "objects", "pack"))).length <= most) continue;
    if (await holdingRepo(dirname(dir), () => repackClone(run, dir, timeoutMs))) done.push(dir);
  }
  return done;
}
