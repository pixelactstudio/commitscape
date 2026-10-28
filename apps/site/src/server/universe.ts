import "@tanstack/react-start/server-only";
import { promisify } from "node:util";
import { brotliDecompress, gzip } from "node:zlib";
import { atlasKey, isQuickPack, sha256, type AtlasPart, type Storage } from "@commitscape/server";
import { withPack } from "./answers";
import { SiteError } from "./http";
import { readable, type Deps, type Viewer } from "./repos";

const unbrotliAsync = promisify(brotliDecompress);
const gzipAsync = promisify(gzip);

export type { AtlasPart };

const NO_HISTORY = "This repository's history is read at its next Build.";
const NOT_YET = "The Universe is drawn once this Build has read the whole history.";
const YEAR = 31_536_000;
const KEPT = 6;
const ASKED_MOST = 10_000;

type Packed = { br: Uint8Array; gzip: Promise<Uint8Array> | null };
type Stored = Record<AtlasPart, Packed>;

const storedFor = new WeakMap<Storage, Map<string, Promise<Stored | null>>>();
const asked = new Set<string>();

export type ServedAtlas = { body: Packed | null; etag: string; cacheControl: string };

const versionOf = (pack: string) => sha256(pack).slice(0, 16);

async function read(storage: Storage, si: number, pack: string): Promise<Stored | null> {
  const [map, names] = await Promise.all([storage.get(atlasKey(si, pack, "map")).catch(() => null), storage.get(atlasKey(si, pack, "names")).catch(() => null)]);
  return map && names ? { map: { br: map.body, gzip: null }, names: { br: names.body, gzip: null } } : null;
}

/** The Atlas the Builder stored for a Stored Index's pack, read once per pack and kept for the few packs read last; null while there is none. The Site never makes one. */
export function storedAtlas(storage: Storage, si: number, pack: string): Promise<Stored | null> {
  const key = `${si}@${pack}`;
  let kept = storedFor.get(storage);
  if (!kept) storedFor.set(storage, (kept = new Map()));
  let found = kept.get(key);
  if (!found) {
    const reading = read(storage, si, pack);
    found = reading;
    kept.set(key, reading);
    void reading.then(
      (s) => s === null && kept.delete(key),
      () => kept.delete(key),
    );
    while (kept.size > KEPT) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
  }
  return found;
}

async function askForAtlas(deps: Deps, repoId: string, si: number, pack: string): Promise<void> {
  if (asked.has(pack)) return;
  if (asked.size >= ASKED_MOST) asked.clear();
  asked.add(pack);
  const queue = await deps.queue();
  await queue.atlas?.({ repoId, si, pack }).catch(() => asked.delete(pack));
}

const matches = (seen: string | null | undefined, etag: string) => !!seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

/** One part of a repository's Atlas, the Universe's compact binary history: `map` (people, folders, files and every commit on the default branch) or `names` (file names, read after the first frame). Kept for a year when the address names the Report it is of. */
export async function atlasFile(deps: Deps, viewer: Viewer, owner: string, name: string, part: AtlasPart, version: number | null, seen?: string | null): Promise<ServedAtlas> {
  const row = await readable(deps, viewer, owner, name);
  const si = row.indexId;
  if (si === null) throw new SiteError(404, NO_HISTORY);
  const pinned = version !== null && version === row.reportAt;
  const cacheControl = row.isPrivate ? "private, max-age=300" : pinned ? `public, max-age=${YEAR}, immutable` : "public, max-age=300";
  const made = await withPack(
    deps.db,
    si,
    async (pack) => {
      const etag = `"atlas-${si}-${versionOf(pack)}-${part}"`;
      if (matches(seen, etag)) return { body: null, etag };
      const stored = await storedAtlas(deps.storage, si, pack);
      if (stored) return { body: stored[part], etag };
      if (isQuickPack(pack)) throw new SiteError(404, NOT_YET);
      await askForAtlas(deps, row.id, si, pack);
      throw new SiteError(404, NO_HISTORY);
    },
    row.reportAt,
  );
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
