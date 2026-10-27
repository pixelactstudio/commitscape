import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Storage } from "@commitscape/server";
import { peakMb } from "./admission";
import type { Runner } from "./run";

/** Works out the standard screens of a Build's pack with `commitscape screens` and stores them beside the pack under `key`, as one gzipped JSON object the engine service fetches with the pack and answers from without working them out. Returns how many it stored. */
export async function storeScreens(run: Runner, storage: Storage, made: { bin: string; pack: string; dir: string; key: string; env: NodeJS.ProcessEnv; timeoutMs: number; nice?: number; commits?: number }): Promise<number> {
  const out = join(made.dir, "screens.json");
  const memoryMb = peakMb("screens", { commits: made.commits ?? 0, sizeKb: 0 });
  const ran = await run(made.bin, ["screens", made.pack, "--out", out], made.env, made.timeoutMs, { ...(made.nice === undefined ? {} : { nice: made.nice }), memoryMb });
  if (ran.code !== 0) throw new Error(ran.timedOut ? "working out the screens took too long" : `working out the screens failed: ${ran.stderr.trim().split("\n").at(-1) ?? ""}`);
  const text = await readFile(out);
  const count = Object.keys(JSON.parse(text.toString("utf8")) as Record<string, unknown>).length;
  await storage.put(made.key, gzipSync(text), { type: "application/gzip" });
  return count;
}
