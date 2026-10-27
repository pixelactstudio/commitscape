import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atlasKey, type Storage } from "@commitscape/server";
import { peakMb } from "./admission";
import type { Runner } from "./run";

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
