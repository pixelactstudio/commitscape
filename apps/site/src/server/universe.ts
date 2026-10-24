import "@tanstack/react-start/server-only";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gzip } from "node:zlib";
import { sql } from "drizzle-orm";
import { atlasOf, encodeAtlas, encodeNames, type AtlasCommitRow, type AtlasRows } from "@commitscape/data/universe";
import { sha256, type Db, type Storage } from "@commitscape/server";
import { inTurn, stampOf } from "./answers";
import { SiteError } from "./http";
import { readable, type Deps, type Viewer } from "./repos";

const brotliAsync = promisify(brotliCompress);
const unbrotliAsync = promisify(brotliDecompress);
const gzipAsync = promisify(gzip);

export type AtlasPart = "map" | "names";

const NO_HISTORY = "This repository's history is read at its next Build.";
const YEAR = 31_536_000;
const KEPT = 6;
const MAINLINE = 8;
const FIRST_PARENT = 16;
const BULK = 4;
const MERGE = 1;

type Packed = { br: Uint8Array; gzip: Promise<Uint8Array> | null };
type Built = Record<AtlasPart, Packed>;

const builtFor = new WeakMap<Db, Map<string, Promise<Built>>>();

export type ServedAtlas = { body: Packed | null; etag: string; cacheControl: string };

type Rows<T> = { rows: T[] };

function intsOf(text: string | null): number[] {
  if (!text || text.length < 3) return [];
  const out: number[] = [];
  let n = 0;
  let digits = false;
  let negative = false;
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      n = n * 10 + (c - 48);
      digits = true;
    } else if (c === 45) negative = true;
    else if (c === 44 || c === 125) {
      out.push(digits ? (negative ? -n : n) : 1);
      n = 0;
      digits = false;
      negative = false;
    }
  }
  return out;
}

const turn = () => new Promise<void>((done) => setImmediate(done));

const marked = new Set<number>();

/** Whether a Stored Index has its Mainline written, so what is read from it will not change; remembered once true. */
export async function mainlineWritten(db: Db, si: number): Promise<boolean> {
  if (marked.has(si)) return true;
  const [row] = ((await db.execute(sql`SELECT EXISTS (SELECT 1 FROM index_commits WHERE si = ${si} AND flags & ${MAINLINE} <> 0) AS marked`)) as unknown as Rows<{ marked: boolean }>).rows;
  if (row?.marked !== true) return false;
  if (marked.size > 10_000) marked.clear();
  marked.add(si);
  return true;
}

/** Reads what the Atlas is made from out of a Stored Index, in one snapshot: the commits that reached the default branch by when they did (every commit when the Mainline is not worked out yet), Merge Commits left out. */
export async function atlasRows(db: Db, si: number): Promise<AtlasRows | null> {
  const read = await db.transaction(
    async (tx) => {
      const [index] = ((await tx.execute(sql`SELECT snapshot FROM stored_indexes WHERE id = ${si}`)) as unknown as Rows<{ snapshot: { newest?: number | null; releases?: [string, number][]; release_shas?: Record<string, string> } | null }>).rows;
      if (!index) return null;
      const [marked] = ((await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM index_commits WHERE si = ${si} AND flags & ${MAINLINE} <> 0) AS marked`)) as unknown as Rows<{ marked: boolean }>).rows;
      const mainline = marked?.marked === true;
      const commits = ((await tx.execute(
        mainline
          ? sql`SELECT coalesce(arrival, at) AS t, signature, flags, files::text AS files, changes::text AS changes FROM index_commits WHERE si = ${si} AND flags & ${MERGE} = 0 AND flags & ${MAINLINE} <> 0 ORDER BY coalesce(arrival, at), at, sha`
          : sql`SELECT at AS t, signature, flags, files::text AS files, changes::text AS changes FROM index_commits WHERE si = ${si} AND flags & ${MERGE} = 0 ORDER BY at, sha`,
      )) as unknown as Rows<{ t: string | number; signature: number; flags: number; files: string; changes: string }>).rows;
      const files = ((await tx.execute(
        sql`SELECT f.file, f.path, f.alive, f.role, f.language, f.guessed_generated, f.lockfile, h.lines FROM index_files f LEFT JOIN index_head_files h ON h.si = f.si AND h.file = f.file WHERE f.si = ${si}`,
      )) as unknown as Rows<{ file: number; path: string; alive: boolean; role: number; language: string | null; guessed_generated: boolean; lockfile: boolean; lines: number | null }>).rows;
      const people = ((await tx.execute(
        sql`SELECT p.signature, p.person, coalesce(p.person_name, p.name) AS name, p.login, p.bot OR coalesce(s.traits & 4 <> 0, false) AS bot FROM index_people p LEFT JOIN index_persons s ON s.si = p.si AND s.person = p.person WHERE p.si = ${si}`,
      )) as unknown as Rows<{ signature: number; person: number | null; name: string; login: string | null; bot: boolean }>).rows;
      const shas = Object.values(index.snapshot?.release_shas ?? {});
      const arrivals = shas.length
        ? ((await tx.execute(sql`SELECT encode(sha, 'hex') AS sha, coalesce(arrival, at) AS t FROM index_commits WHERE si = ${si} AND sha = ANY (SELECT decode(x, 'hex') FROM unnest(${sql.param(shas)}::text[]) AS x)`)) as unknown as Rows<{ sha: string; t: string | number }>).rows
        : [];
      return { index, mainline, commits, files, people, arrivals };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (!read) return null;
  const personOf = new Map<number, number>();
  const named = new Map<number, { id: number; name: string; login: string | null; bot: boolean }>();
  for (const p of read.people) {
    if (p.person === null) continue;
    personOf.set(p.signature, p.person);
    const was = named.get(p.person);
    if (!was) named.set(p.person, { id: p.person, name: p.name, login: p.login, bot: p.bot });
    else if (!was.login && p.login) was.login = p.login;
  }
  const commits: AtlasCommitRow[] = [];
  let newest = 0;
  for (let i = 0; i < read.commits.length; i++) {
    if (i % 4096 === 4095) await turn();
    const c = read.commits[i] as (typeof read.commits)[number];
    const time = Number(c.t);
    newest = Math.max(newest, time);
    commits.push({ time, person: personOf.get(c.signature) ?? -1, bulk: (c.flags & BULK) !== 0, firstParent: (c.flags & FIRST_PARENT) !== 0, files: intsOf(c.files), changes: intsOf(c.changes) });
  }
  const arrivalOf = new Map(read.arrivals.map((a) => [a.sha, Number(a.t)]));
  const shaOf = read.index.snapshot?.release_shas ?? {};
  const releases = (read.index.snapshot?.releases ?? []).map(([name, t]): [string, number] => {
    const sha = shaOf[name];
    return [name, (sha && arrivalOf.get(sha)) || t];
  });
  return {
    mainline: read.mainline,
    newest,
    commits,
    files: read.files.map((f) => ({ file: f.file, path: f.path, alive: f.alive, role: f.role, language: f.language, generated: f.guessed_generated, lockfile: f.lockfile, lines: f.lines })),
    people: [...named.values()],
    releases,
  };
}

const keyOf = (si: number, stamp: string, part: AtlasPart) => `atlas/${si}/${sha256(stamp).slice(0, 16)}/${part}.bin.br`;

const brotli = (bytes: Uint8Array) =>
  brotliAsync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength } }).then(
    (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  );

async function make(db: Db, storage: Storage, si: number, stamp: string): Promise<Built> {
  const [map, names] = await Promise.all([storage.get(keyOf(si, stamp, "map")).catch(() => null), storage.get(keyOf(si, stamp, "names")).catch(() => null)]);
  if (map && names) return { map: { br: map.body, gzip: null }, names: { br: names.body, gzip: null } };
  const rows = await atlasRows(db, si);
  if (!rows) throw new SiteError(404, NO_HISTORY);
  const encoded = await inTurn(() => {
    const { atlas, names } = atlasOf(rows);
    return { map: encodeAtlas(atlas), names: encodeNames(names) };
  });
  const [mapBr, namesBr] = await Promise.all([brotli(encoded.map), brotli(encoded.names)]);
  void storage.put(keyOf(si, stamp, "map"), mapBr, { type: "application/octet-stream", encoding: "br" }).catch(() => undefined);
  void storage.put(keyOf(si, stamp, "names"), namesBr, { type: "application/octet-stream", encoding: "br" }).catch(() => undefined);
  return { map: { br: mapBr, gzip: null }, names: { br: namesBr, gzip: null } };
}

/** The Atlas of a Stored Index, made once per load: from storage when an earlier process made it, else from Postgres. */
export function atlasOfIndex(db: Db, storage: Storage, si: number, stamp: string): Promise<Built> {
  const key = `${si}@${stamp}`;
  let built = builtFor.get(db);
  if (!built) builtFor.set(db, (built = new Map()));
  let made = built.get(key);
  if (!made) {
    made = make(db, storage, si, stamp);
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

/** Makes the Atlas of a Stored Index ahead of its first visitor, and deletes what an earlier load of it left in storage. */
export async function warmAtlas(db: Db, storage: Storage, si: number): Promise<boolean> {
  const stamp = await stampOf(db, si);
  if (stamp === null) return false;
  await atlasOfIndex(db, storage, si, stamp);
  const kept = `atlas/${si}/${sha256(stamp).slice(0, 16)}/`;
  const stale = ((await storage.keys?.(`atlas/${si}/`)) ?? []).filter((k) => !k.startsWith(kept));
  if (stale.length > 0) await storage.delete(stale);
  return true;
}

const matches = (seen: string | null | undefined, etag: string) => !!seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

/** One part of a repository's Atlas, the Universe's compact binary history: `map` (people, folders, files and every commit on the default branch) or `names` (file names, read after the first frame). Kept for a year when the address names the Report it is of. */
export async function atlasFile(deps: Deps, viewer: Viewer, owner: string, name: string, part: AtlasPart, version: number | null, seen?: string | null): Promise<ServedAtlas> {
  const row = await readable(deps, viewer, owner, name);
  if (row.indexId === null) throw new SiteError(404, NO_HISTORY);
  const pinned = version !== null && version === row.reportAt;
  const settled = pinned && !row.isPrivate && (await mainlineWritten(deps.db, row.indexId));
  const cacheControl = row.isPrivate ? "private, max-age=300" : settled ? `public, max-age=${YEAR}, immutable` : "public, max-age=300";
  const stamp = await stampOf(deps.db, row.indexId, pinned ? (row.reportAt ?? undefined) : undefined);
  if (stamp === null) throw new SiteError(404, NO_HISTORY);
  const etag = `"atlas-${row.indexId}-${sha256(stamp).slice(0, 16)}-${part}"`;
  if (matches(seen, etag)) return { body: null, etag, cacheControl };
  const made = await atlasOfIndex(deps.db, deps.storage, row.indexId, stamp);
  return { body: made[part], etag, cacheControl };
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
