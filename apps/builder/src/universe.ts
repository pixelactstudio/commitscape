import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import { atlasOf, encodeAtlas, encodeNames, type AtlasCommitRow, type AtlasFileRow, type AtlasPersonRow, type AtlasRows } from "@commitscape/data/universe";
import { atlasKey, type Storage } from "@commitscape/server";
import type { AtlasSettings } from "./config";
import type { Runner } from "./run";

const brotliAsync = promisify(brotliCompress);

export const ATLAS_QUALITY = 5;

export const ROWS = "universe.jsonl";

type Counts = { mainline: boolean; newest: number; releases: [string, number][]; commits: number; files: number; people: number };

/** Reads the rows `commitscape build` wrote to `universe.jsonl` one line at a time: the counts first, then the commits, the files and the people. */
export async function readRows(file: string): Promise<AtlasRows> {
  const lines = createInterface({ input: createReadStream(file, { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  let counts: Counts | null = null;
  const commits: AtlasCommitRow[] = [];
  const files: AtlasFileRow[] = [];
  const people: AtlasPersonRow[] = [];
  for await (const line of lines) {
    if (!line) continue;
    if (!counts) {
      counts = JSON.parse(line) as Counts;
      continue;
    }
    if (commits.length < counts.commits) commits.push(JSON.parse(line) as AtlasCommitRow);
    else if (files.length < counts.files) files.push(JSON.parse(line) as AtlasFileRow);
    else if (people.length < counts.people) people.push(JSON.parse(line) as AtlasPersonRow);
  }
  if (!counts || commits.length !== counts.commits || files.length !== counts.files || people.length !== counts.people) throw new Error(`${file} ended before its rows did`);
  return { mainline: counts.mainline, newest: counts.newest, releases: counts.releases, commits, files, people };
}

const brotli = async (bytes: Uint8Array, quality: number) => {
  const b = await brotliAsync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength } });
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
};

/** The Universe's Atlas from the rows a Build wrote: its map and its names, each packed with brotli as the Site sends them. */
export async function atlasFrom(file: string, quality = ATLAS_QUALITY): Promise<{ map: Uint8Array; names: Uint8Array }> {
  const { atlas, names } = atlasOf(await readRows(file));
  const [map, named] = [encodeAtlas(atlas), encodeNames(names)];
  return { map: await brotli(map, quality), names: await brotli(named, quality) };
}

/** `node builder.mjs atlas ROWS DIR QUALITY`: writes the Atlas of the rows in ROWS into DIR as `map.bin.br` and `names.bin.br`. */
export async function writeAtlas(rows: string, dir: string, quality: number): Promise<void> {
  const { map, names } = await atlasFrom(rows, quality);
  await writeFile(join(dir, "map.bin.br"), map);
  await writeFile(join(dir, "names.bin.br"), names);
}

/** Makes the Atlas of a Build's pack from the rows `commitscape build` wrote beside it, in a process of its own that takes an engine slot, and stores it where the Site reads it first, so the Site never makes it. False when the Build wrote no rows; throws when the Atlas could not be made. Either way the Site makes it as before. */
export async function storeAtlas(run: Runner, atlas: AtlasSettings, storage: Storage, made: { si: number; pack: string; dir: string; timeoutMs: number; nice?: number }): Promise<boolean> {
  const rows = join(made.dir, ROWS);
  if (!existsSync(rows)) return false;
  const ran = await run(atlas.command, [...atlas.args, "atlas", rows, made.dir, String(atlas.quality)], {}, made.timeoutMs, made.nice === undefined ? {} : { nice: made.nice });
  if (ran.code !== 0) throw new Error(ran.timedOut ? "making the Atlas took too long" : `making the Atlas failed: ${ran.stderr.trim().split("\n").at(-1) ?? ""}`);
  for (const part of ["map", "names"] as const) {
    await storage.put(atlasKey(made.si, made.pack, part), await readFile(join(made.dir, `${part}.bin.br`)), { type: "application/octet-stream", encoding: "br" });
  }
  return true;
}
