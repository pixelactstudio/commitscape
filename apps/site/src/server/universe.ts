import "@tanstack/react-start/server-only";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gzip } from "node:zlib";
import { atlasOf, encodeAtlas, encodeNames } from "@commitscape/data/universe";
import { atlasKey, isQuickPack, sha256, type AtlasPart, type Storage } from "@commitscape/server";
import { withPack } from "./answers";
import type { EngineService } from "./engine-service";
import { SiteError } from "./http";
import { readable, type Deps, type Viewer } from "./repos";

const brotliAsync = promisify(brotliCompress);
const unbrotliAsync = promisify(brotliDecompress);
const gzipAsync = promisify(gzip);

export type { AtlasPart };

const NO_HISTORY = "This repository's history is read at its next Build.";
const NOT_YET = "The Universe is drawn once this Build has read the whole history.";
const YEAR = 31_536_000;
const KEPT = 6;
const QUICK = 5;
const BEST = 11;

type Packed = { br: Uint8Array; gzip: Promise<Uint8Array> | null };
type Built = Record<AtlasPart, Packed> & { kept: Promise<void> };

type Making = { storage: Storage; engine: EngineService };

const builtFor = new WeakMap<Storage, Map<string, Promise<Built>>>();

export type ServedAtlas = { body: Packed | null; etag: string; cacheControl: string };

const versionOf = (pack: string) => sha256(pack).slice(0, 16);

const keyOf = atlasKey;

const brotli = (bytes: Uint8Array, quality: number) =>
  brotliAsync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength } }).then(
    (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  );

let repacking: Promise<void> = Promise.resolve();

function repack(storage: Storage, si: number, pack: string, raw: Record<AtlasPart, Uint8Array>, built: Record<AtlasPart, Packed>): Promise<void> {
  const run = async () => {
    for (const part of ["map", "names"] as const) {
      const br = await brotli(raw[part], BEST);
      if (br.byteLength < built[part].br.byteLength) built[part].br = br;
      await storage.put(keyOf(si, pack, part), built[part].br, { type: "application/octet-stream", encoding: "br" });
    }
  };
  const done = repacking.then(run).catch(() => undefined);
  repacking = done;
  return done;
}

async function make({ storage, engine }: Making, si: number, pack: string): Promise<Built> {
  const [map, names] = await Promise.all([storage.get(keyOf(si, pack, "map")).catch(() => null), storage.get(keyOf(si, pack, "names")).catch(() => null)]);
  if (map && names) return { map: { br: map.body, gzip: null }, names: { br: names.body, gzip: null }, kept: Promise.resolve() };
  if (isQuickPack(pack)) throw new SiteError(404, NOT_YET);
  const { atlas, names: named } = atlasOf(await engine.universeRows(pack));
  const raw = { map: encodeAtlas(atlas), names: encodeNames(named) };
  const [mapBr, namesBr] = await Promise.all([brotli(raw.map, QUICK), brotli(raw.names, QUICK)]);
  const parts = { map: { br: mapBr, gzip: null }, names: { br: namesBr, gzip: null } };
  return { ...parts, kept: repack(storage, si, pack, raw, parts) };
}

/** The Atlas of a Stored Index's pack, made once per pack: from storage when an earlier process made it, else from the rows the engine service reads from the pack, packed quickly to send at once and again, one pack at a time in the background, as small as brotli makes it, which is what is stored and sent from then on. */
export function atlasOfPack(making: Making, si: number, pack: string): Promise<Built> {
  const key = `${si}@${pack}`;
  let built = builtFor.get(making.storage);
  if (!built) builtFor.set(making.storage, (built = new Map()));
  let made = built.get(key);
  if (!made) {
    made = make(making, si, pack);
    built.set(key, made);
    made.catch(() => built.delete(key));
    while (built.size > KEPT) {
      const oldest = built.keys().next().value;
      if (oldest === undefined) break;
      built.delete(oldest);
    }
  }
  return made;
}

/** Makes the Atlas of a Stored Index's pack ahead of its first visitor, and deletes what its earlier packs left in storage. */
export async function warmAtlas(making: Making, si: number, pack: string): Promise<boolean> {
  if (isQuickPack(pack)) return false;
  await (await atlasOfPack(making, si, pack)).kept;
  const kept = `atlas/${si}/${versionOf(pack)}/`;
  const stale = ((await making.storage.keys?.(`atlas/${si}/`)) ?? []).filter((k) => !k.startsWith(kept));
  if (stale.length > 0) await making.storage.delete(stale);
  return true;
}

const matches = (seen: string | null | undefined, etag: string) => !!seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

/** One part of a repository's Atlas, the Universe's compact binary history: `map` (people, folders, files and every commit on the default branch) or `names` (file names, read after the first frame). Kept for a year when the address names the Report it is of. */
export async function atlasFile(deps: Deps, viewer: Viewer, owner: string, name: string, part: AtlasPart, version: number | null, seen?: string | null): Promise<ServedAtlas> {
  const row = await readable(deps, viewer, owner, name);
  const si = row.indexId;
  if (si === null) throw new SiteError(404, NO_HISTORY);
  const pinned = version !== null && version === row.reportAt;
  const cacheControl = row.isPrivate ? "private, max-age=300" : pinned ? `public, max-age=${YEAR}, immutable` : "public, max-age=300";
  const made = await withPack(deps.db, si, async (pack) => {
    const etag = `"atlas-${si}-${versionOf(pack)}-${part}"`;
    if (matches(seen, etag)) return { body: null, etag };
    return { body: (await atlasOfPack(deps, si, pack))[part], etag };
  }, row.reportAt);
  if (!made) throw new SiteError(404, NO_HISTORY);
  return { ...made.value, cacheControl };
}

/** The bytes to send for what a request accepts: brotli as made, gzip made once when asked for, or plain. */
export async function atlasBody(p: Packed, accept: string | null): Promise<{ body: Uint8Array; encoding: "br" | "gzip" | null }> {
  const wants = (accept ?? "").toLowerCase();
  if (/\bbr\b/.test(wants)) return { body: p.br, encoding: "br" };
  const raw = async () => {
    const b = await unbrotliAsync(p.br);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  };
  if (/\bgzip\b/.test(wants)) {
    p.gzip ??= raw()
      .then((b) => gzipAsync(b, { level: 9 }))
      .then((b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    p.gzip.catch(() => {
      p.gzip = null;
    });
    return { body: await p.gzip, encoding: "gzip" };
  }
  return { body: await raw(), encoding: null };
}
