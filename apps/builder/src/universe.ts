import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { atlasKey, isQuickPack, randomId, schema, type AtlasJob, type Db, type Storage } from "@commitscape/server";
import { peakMb } from "./admission";
import type { Config } from "./config";
import { holding, scratchDir } from "./disk";
import type { Runner } from "./run";

const { repositories, storedIndexes } = schema;

export const ATLAS_QUALITY = 5;

/** Makes the Universe's Atlas of a Build's pack with `commitscape atlas`, in a process of its own let in by the memory it takes, and stores it where the Site reads it first, so the Site never makes it. Throws when it could not be made; the Site then makes it as before. */
export async function storeAtlas(run: Runner, storage: Storage, made: { bin: string; quality: number; si: number; pack: string; file: string; dir: string; timeoutMs: number; nice?: number; commits?: number }): Promise<void> {
  const out = join(made.dir, "atlas");
  const memoryMb = peakMb("atlas", { commits: made.commits ?? 0, sizeKb: 0 });
  const ran = await run(made.bin, ["atlas", made.file, "--out", out, "--quality", String(made.quality)], {}, made.timeoutMs, { ...(made.nice === undefined ? {} : { nice: made.nice }), memoryMb });
  if (ran.code !== 0) throw new Error(ran.timedOut ? "making the Atlas took too long" : `making the Atlas failed: ${ran.stderr.trim().split("\n").at(-1) ?? ""}`);
  for (const part of ["map", "names"] as const) {
    await storage.put(atlasKey(made.si, made.pack, part), await readFile(join(out, `${part}.bin.br`)), { type: "application/octet-stream", encoding: "br" });
  }
}

/** Makes the Atlas of a published pack the Builder could not make while publishing it, or one a Builder of an earlier release never made: fetches the pack from R2 and makes the Atlas as a Build does, under the memory gate. Does nothing when the pack is no longer the repository's, is a quick one, or has its Atlas already. */
export async function atlasJob(job: AtlasJob, ctx: { db: Db; storage: Storage; run: Runner; cfg: Config }): Promise<"made" | "gone" | "kept"> {
  if (isQuickPack(job.pack)) return "gone";
  const [live] = await ctx.db
    .select({ pack: storedIndexes.pack, commits: storedIndexes.commits })
    .from(repositories)
    .innerJoin(storedIndexes, eq(storedIndexes.id, repositories.indexId))
    .where(and(eq(repositories.id, job.repoId), eq(storedIndexes.id, job.si)));
  if (live?.pack !== job.pack) return "gone";
  const parts = await Promise.all((["map", "names"] as const).map((part) => ctx.storage.get(atlasKey(job.si, job.pack, part)).catch(() => null)));
  if (parts.every(Boolean)) return "kept";
  const pack = await ctx.storage.get(job.pack);
  if (!pack) return "gone";
  const key = `atlas-${randomId()}`;
  const dir = scratchDir(ctx.cfg, key);
  holding.add(key);
  try {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "pack.bin");
    await writeFile(file, pack.body);
    await storeAtlas(ctx.run, ctx.storage, { bin: ctx.cfg.bin, quality: ctx.cfg.atlas?.quality ?? ATLAS_QUALITY, si: job.si, pack: job.pack, file, dir, timeoutMs: ctx.cfg.timeLimit * 1000, nice: ctx.cfg.nice, commits: live.commits });
    return "made";
  } finally {
    await rm(dir, { recursive: true, force: true });
    holding.delete(key);
  }
}
