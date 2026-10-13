import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { indexCommits, indexPeople, indexPersons, repositories, storedIndexes, type IndexSnapshot } from "./db/schema";
import type { HeadFile, IndexView } from "@commitscape/data/answers";
import { now } from "./time";

export const EXPORT_FORMAT = 2;

export type ExportManifest = {
  format: number;
  lineage: string;
  kept: boolean;
  full: boolean;
  lines: boolean;
  folders_full: boolean;
  head: string | null;
  frontier: string[];
  commits: number;
  total: number;
  days: number;
  anchor: number;
  max_changeset_size: number;
  coupling_support: number;
  ownership_min_commits: number;
};

export const LOADED = "stored_index_loaded";

export type LiveIndex = { id: number; lineage: string; kept: boolean; frontier: string[]; lines: boolean; head: string | null };

export type Loaded = { si: number; full: boolean; commits: number; total: number; seconds: number };

const STAGING: [file: string, table: string, columns: string][] = [
  ["commits.tsv", "s_commits", `sha bytea, at bigint, "offset" smallint, author_delta integer, signature integer, kind smallint, flags smallint, subject text, files integer[], changes smallint[], added integer[], removed integer[]`],
  ["files.tsv", "s_files", "file integer, path text, folder text, born bigint, last bigint, alive boolean, role smallint, language text, guessed_generated boolean, lockfile boolean"],
  ["file_paths.tsv", "s_file_paths", "file integer, path text"],
  ["folders.tsv", "s_folders", "path text, parent text, depth smallint"],
  ["persons.tsv", "s_persons", "person integer, traits smallint, identities integer, commits integer"],
  ["people.tsv", "s_people", "signature integer, name text, person integer, person_name text, colour smallint, login text, bot boolean"],
  ["days.tsv", "s_days", "day integer, commits integer, merges integer, bulk integer, changes integer, added bigint, removed bigint"],
  ["signature_days.tsv", "s_signature_days", "day integer, signature integer, commits integer, merges integer, bulk integer, changes integer, added bigint, removed bigint"],
  ["folder_days.tsv", "s_folder_days", "day integer, folder text, commits integer, changes integer, added bigint, removed bigint"],
  ["signature_folder_days.tsv", "s_signature_folder_days", "day integer, signature integer, folder text, commits integer, changes integer, added bigint, removed bigint"],
  ["head_files.tsv", "s_head_files", "file integer, blob bytea, bytes bigint, lines integer, class text, indent_levels integer, indent_mean real, indent_stddev real"],
];

/** Reads the manifest `commitscape export` wrote beside its files. */
export async function readManifest(dir: string): Promise<ExportManifest> {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as ExportManifest;
  if (manifest.format !== EXPORT_FORMAT) throw new Error(`export format ${manifest.format}, expected ${EXPORT_FORMAT}`);
  return manifest;
}

async function readSnapshot(dir: string): Promise<IndexSnapshot | null> {
  const path = join(dir, "snapshot.json");
  return existsSync(path) ? (JSON.parse(await readFile(path, "utf8")) as IndexSnapshot) : null;
}

/** The repository's live Stored Index, or null when it has none. */
export async function liveIndex(db: Db, repoId: string): Promise<LiveIndex | null> {
  const [row] = await db
    .select({ id: storedIndexes.id, lineage: storedIndexes.lineage, kept: storedIndexes.kept, frontier: storedIndexes.frontier, lines: storedIndexes.lines, head: storedIndexes.head })
    .from(repositories)
    .innerJoin(storedIndexes, eq(storedIndexes.id, repositories.indexId))
    .where(eq(repositories.id, repoId));
  return row ?? null;
}

/** Whether the next export may hold only what is new: the live Stored Index came from a cache that was kept, and counted lines when this one will. */
export function appendable(live: LiveIndex | null, lines: boolean): live is LiveIndex {
  return live !== null && live.kept && live.frontier.length > 0 && (live.lines || !lines);
}

/** Loads what `commitscape export` wrote into Postgres in one transaction, as a new Stored Index or appended to the live one. */
export async function loadExport(pool: pg.Pool, repoId: string, dir: string): Promise<Loaded> {
  const started = Date.now();
  const manifest = await readManifest(dir);
  const client = await pool.connect();
  const db = drizzle(client, { schema }) as unknown as Db;
  try {
    await client.query("BEGIN");
    const si = await target(db, repoId, manifest);
    for (const [file, table, columns] of STAGING) {
      await client.query(`CREATE TEMP TABLE ${table} (${columns}) ON COMMIT DROP`);
      const path = join(dir, file);
      if (existsSync(path)) await pipeline(createReadStream(path), client.query(copyFrom(`COPY ${table} FROM STDIN`)));
      await client.query(`ANALYZE ${table}`);
    }
    await merge(db, si, manifest);
    const [counted] = await db.select({ commits: count() }).from(indexCommits).where(eq(indexCommits.si, si));
    const commits = counted?.commits ?? 0;
    await db
      .update(storedIndexes)
      .set({
        lineage: manifest.lineage,
        kept: manifest.kept,
        head: manifest.head,
        frontier: manifest.frontier,
        lines: manifest.full ? manifest.lines : sql`${storedIndexes.lines} AND ${manifest.lines}`,
        commits,
        state: "live",
        loadedAt: now(),
        anchor: manifest.anchor,
        options: { max_changeset_size: manifest.max_changeset_size, coupling_support: manifest.coupling_support, ownership_min_commits: manifest.ownership_min_commits },
        snapshot: await readSnapshot(dir),
      })
      .where(eq(storedIndexes.id, si));
    await db.update(repositories).set({ indexId: si }).where(eq(repositories.id, repoId));
    if (manifest.full) await db.execute(sql`DELETE FROM stored_indexes WHERE repo_id = ${repoId} AND id <> ${si}`);
    await client.query("SELECT pg_notify($1, $2)", [LOADED, String(si)]);
    await client.query("COMMIT");
    if (manifest.full) await client.query("ANALYZE index_commits").catch(() => undefined);
    return { si, full: manifest.full, commits: manifest.commits, total: commits, seconds: (Date.now() - started) / 1000 };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function target(db: Db, repoId: string, manifest: ExportManifest): Promise<number> {
  if (!manifest.full) {
    const live = await liveIndex(db, repoId);
    if (!live || live.lineage !== manifest.lineage) throw new Error("an export of what is new needs the live Stored Index it was made after");
    return live.id;
  }
  const [row] = await db
    .insert(storedIndexes)
    .values({ repoId, lineage: manifest.lineage, kept: manifest.kept, state: "loading", lines: manifest.lines, builtAt: now() })
    .returning({ id: storedIndexes.id });
  if (!row) throw new Error("no Stored Index was made");
  return row.id;
}

async function merge(db: Db, si: number, manifest: ExportManifest): Promise<void> {
  const touched = sql`day IN (SELECT day FROM s_days)`;
  const folders = manifest.folders_full ? sql`true` : touched;
  await db.execute(sql`
    INSERT INTO index_commits (si, sha, at, "offset", author_delta, signature, kind, flags, subject, files, changes, added, removed)
    SELECT ${si}, sha, at, "offset", author_delta, signature, kind, flags, subject, files, changes, added, removed FROM s_commits
    ON CONFLICT (si, sha) DO UPDATE SET added = excluded.added, removed = excluded.removed
    WHERE index_commits.added IS NULL AND excluded.added IS NOT NULL`);
  await db.execute(sql`
    WITH existing AS (SELECT id, path FROM index_folders WHERE si = ${si}),
    fresh AS (
      SELECT s.path, s.parent, s.depth, (SELECT coalesce(max(id), -1) FROM existing) + row_number() OVER (ORDER BY s.path) AS id
      FROM s_folders s WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.path = s.path)
    ),
    ids AS (SELECT id, path FROM existing UNION ALL SELECT id, path FROM fresh)
    INSERT INTO index_folders (si, id, path, parent, depth)
    SELECT ${si}, f.id, f.path, p.id, f.depth FROM fresh f LEFT JOIN ids p ON p.path = f.parent`);
  await db.execute(sql`ANALYZE index_folders`);
  await db.execute(sql`
    INSERT INTO index_files (si, file, path, folder, born, last, alive, role, language, guessed_generated, lockfile)
    SELECT ${si}, s.file, s.path, f.id, s.born, s.last, s.alive, s.role, s.language, s.guessed_generated, s.lockfile
    FROM s_files s JOIN index_folders f ON f.si = ${si} AND f.path = s.folder
    ON CONFLICT (si, file) DO UPDATE SET path = excluded.path, folder = excluded.folder, born = excluded.born, last = excluded.last, alive = excluded.alive,
      role = excluded.role, language = excluded.language, guessed_generated = excluded.guessed_generated, lockfile = excluded.lockfile`);
  await db.execute(sql`INSERT INTO index_file_paths (si, file, path) SELECT ${si}, file, path FROM s_file_paths ON CONFLICT DO NOTHING`);
  await db.execute(sql`DELETE FROM index_persons WHERE si = ${si}`);
  await db.execute(sql`INSERT INTO index_persons (si, person, traits, identities, commits) SELECT ${si}, person, traits, identities, commits FROM s_persons`);
  await db.execute(sql`DELETE FROM index_people WHERE si = ${si}`);
  await db.execute(sql`
    INSERT INTO index_people (si, signature, name, person, person_name, colour, login, bot)
    SELECT ${si}, signature, name, person, person_name, colour, login, bot FROM s_people`);
  await db.execute(sql`DELETE FROM index_days WHERE si = ${si} AND ${touched}`);
  await db.execute(sql`
    INSERT INTO index_days (si, day, commits, merges, bulk, changes, added, removed)
    SELECT ${si}, day, commits, merges, bulk, changes, added, removed FROM s_days`);
  await db.execute(sql`DELETE FROM index_signature_days WHERE si = ${si} AND ${touched}`);
  await db.execute(sql`
    INSERT INTO index_signature_days (si, day, signature, commits, merges, bulk, changes, added, removed)
    SELECT ${si}, day, signature, commits, merges, bulk, changes, added, removed FROM s_signature_days`);
  await db.execute(sql`DELETE FROM index_folder_days WHERE si = ${si} AND ${folders}`);
  await db.execute(sql`
    INSERT INTO index_folder_days (si, day, folder, commits, changes, added, removed)
    SELECT ${si}, s.day, f.id, s.commits, s.changes, s.added, s.removed FROM s_folder_days s JOIN index_folders f ON f.si = ${si} AND f.path = s.folder`);
  await db.execute(sql`DELETE FROM index_signature_folder_days WHERE si = ${si} AND ${folders}`);
  await db.execute(sql`
    INSERT INTO index_signature_folder_days (si, day, signature, folder, commits, changes, added, removed)
    SELECT ${si}, s.day, s.signature, f.id, s.commits, s.changes, s.added, s.removed FROM s_signature_folder_days s JOIN index_folders f ON f.si = ${si} AND f.path = s.folder`);
  await db.execute(sql`DELETE FROM index_head_files WHERE si = ${si}`);
  await db.execute(sql`
    INSERT INTO index_head_files (si, file, blob, bytes, lines, class, indent_levels, indent_mean, indent_stddev)
    SELECT ${si}, file, blob, bytes, lines, class, indent_levels, indent_mean, indent_stddev FROM s_head_files`);
}

/** What changes whenever a Stored Index is loaded again: its load time and head. */
export function indexStamp(row: { loadedAt: number | null; head: string | null }): string {
  return `${row.loadedAt ?? 0}:${row.head ?? ""}`;
}

type Rows<T> = { rows: T[] };

type CommitRow = { sha: string; at: number | string; offset: number; author_delta: number; signature: number; kind: number; flags: number; n: number; files: string; added: string | null; removed: string | null };

type FileRow = { file: number; path: string; born: number | string; last: number | string; role: number; language: string | null; guessed_generated: boolean; lockfile: boolean };

type HeadRow = { file: number; blob: string; lines: number; bytes: number | string; class: string };

function intsInto(text: string | null, out: Int32Array, at: number): number {
  if (text === null) return at;
  let n = 0;
  let negative = false;
  let digits = false;
  let word = false;
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      n = n * 10 + (c - 48);
      digits = true;
    } else if (c === 45) negative = true;
    else if (c === 44 || c === 125) {
      if (digits) out[at++] = negative ? -n : n;
      else if (word) out[at++] = -1;
      n = 0;
      negative = false;
      digits = false;
      word = false;
    } else word = true;
  }
  return at;
}

/** Reads a Stored Index into memory as the columns the Site's answers are worked out from, every table from one snapshot so a load in between never tears it. */
export async function loadView(db: Db, si: number): Promise<IndexView | null> {
  const read = await db.transaction(
    async (tx) => {
      const [index] = await tx
        .select({ anchor: storedIndexes.anchor, options: storedIndexes.options, lines: storedIndexes.lines, snapshot: storedIndexes.snapshot, loadedAt: storedIndexes.loadedAt, head: storedIndexes.head })
        .from(storedIndexes)
        .where(eq(storedIndexes.id, si));
      if (!index) return null;
      const commits = ((await tx.execute(sql`
        SELECT encode(sha, 'hex') AS sha, at, "offset", author_delta, signature, kind, flags, cardinality(files) AS n, files::text AS files, added::text AS added, removed::text AS removed
        FROM index_commits WHERE si = ${si} ORDER BY at, sha`)) as unknown as Rows<CommitRow>).rows;
      const files = ((await tx.execute(sql`SELECT file, path, born, last, role, language, guessed_generated, lockfile FROM index_files WHERE si = ${si}`)) as unknown as Rows<FileRow>).rows;
      const head = ((await tx.execute(sql`SELECT file, encode(blob, 'hex') AS blob, lines, bytes, class FROM index_head_files WHERE si = ${si}`)) as unknown as Rows<HeadRow>).rows;
      const persons = await tx.select({ person: indexPersons.person, traits: indexPersons.traits, identities: indexPersons.identities, commits: indexPersons.commits }).from(indexPersons).where(eq(indexPersons.si, si));
      const people = await tx.select({ signature: indexPeople.signature, person: indexPeople.person, name: indexPeople.personName, colour: indexPeople.colour, login: indexPeople.login }).from(indexPeople).where(eq(indexPeople.si, si));
      return { index, commits, files, head, persons, people };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return read && viewOfRows(read.index, read.commits, read.files, read.head, read.persons, read.people);
}

const ROWS_AT_ONCE = 8192;

const turn = () => new Promise<void>((done) => setImmediate(done));

async function viewOfRows(
  index: { anchor: number; options: IndexView["options"]; lines: boolean; snapshot: IndexSnapshot | null; loadedAt: number | null; head: string | null },
  commits: CommitRow[],
  files: FileRow[],
  head: HeadRow[],
  persons: { person: number; traits: number; identities: number; commits: number }[],
  people: { signature: number; person: number | null; name: string | null; colour: number | null; login: string | null }[],
): Promise<IndexView> {
  const personOf = new Map<number, number>();
  const named = new Map<number, { name: string; colour: number | null; login: string | null }>();
  for (const p of people) {
    if (p.person === null) continue;
    personOf.set(p.signature, p.person);
    if (!named.has(p.person)) named.set(p.person, { name: p.name ?? "", colour: p.colour, login: p.login });
  }
  const n = commits.length;
  let changes = 0;
  for (const c of commits) changes += Number(c.n);
  const heads: HeadFile[] = head.map((h) => ({ file: h.file, blob: h.blob, loc: h.lines, bytes: Number(h.bytes), class: h.class as HeadFile["class"] }));
  const view: IndexView = {
    stamp: indexStamp(index),
    anchor: index.anchor,
    options: index.options,
    lines: index.lines,
    snapshot: index.snapshot ?? { commits: n, merges: 0, oldest: null, newest: null, languages: [], code_age: [], suspects: [], releases: [] },
    ids: new Array<string>(n),
    time: new Float64Array(n),
    offset: new Int16Array(n),
    authorDelta: new Int32Array(n),
    person: new Int32Array(n),
    flags: new Uint8Array(n),
    kind: new Uint8Array(n),
    start: new Uint32Array(n + 1),
    file: new Int32Array(changes),
    added: new Int32Array(changes).fill(-1),
    removed: new Int32Array(changes).fill(-1),
    paths: [],
    born: new Float64Array(0),
    last: new Float64Array(0),
    known: new Uint8Array(0),
    role: new Uint8Array(0),
    language: [],
    guessedGenerated: new Uint8Array(0),
    lockfile: new Uint8Array(0),
    head: heads,
    headOf: new Map(),
    persons: new Map(),
    byPath: new Map(),
  };
  let at = 0;
  for (let i = 0; i < n; i++) {
    if (i % ROWS_AT_ONCE === ROWS_AT_ONCE - 1) await turn();
    const c = commits[i] as CommitRow;
    view.ids[i] = c.sha;
    view.time[i] = Number(c.at);
    view.offset[i] = c.offset;
    view.authorDelta[i] = c.author_delta;
    view.person[i] = personOf.get(c.signature) ?? -1;
    view.flags[i] = c.flags;
    view.kind[i] = c.kind;
    view.start[i] = at;
    intsInto(c.added, view.added, at);
    intsInto(c.removed, view.removed, at);
    at = intsInto(c.files, view.file, at);
  }
  view.start[n] = at;
  let size = 0;
  for (const f of files) size = Math.max(size, f.file + 1);
  for (const h of heads) size = Math.max(size, h.file + 1);
  view.paths = new Array<string>(size).fill("");
  view.language = new Array<string | null>(size).fill(null);
  view.born = new Float64Array(size);
  view.last = new Float64Array(size);
  view.known = new Uint8Array(size);
  view.role = new Uint8Array(size);
  view.guessedGenerated = new Uint8Array(size);
  view.lockfile = new Uint8Array(size);
  for (let i = 0; i < files.length; i++) {
    if (i % ROWS_AT_ONCE === ROWS_AT_ONCE - 1) await turn();
    const f = files[i] as FileRow;
    view.paths[f.file] = f.path;
    view.born[f.file] = Number(f.born);
    view.last[f.file] = Number(f.last);
    view.known[f.file] = 1;
    view.role[f.file] = f.role;
    view.language[f.file] = f.language;
    view.guessedGenerated[f.file] = f.guessed_generated ? 1 : 0;
    view.lockfile[f.file] = f.lockfile ? 1 : 0;
    view.byPath.set(f.path, f.file);
  }
  for (const h of heads) view.headOf.set(h.file, h);
  for (const p of persons) {
    const name = named.get(p.person);
    view.persons.set(p.person, { id: p.person, name: name?.name ?? "", colour: name?.colour ?? null, login: name?.login ?? null, traits: p.traits, identities: p.identities, commits: p.commits });
  }
  return view;
}

/** Calls `loaded` with the id of each Stored Index a Build loads, as Postgres announces it, on one connection kept open and opened again when lost; the returned function stops listening. */
export function listenForLoads(url: string, loaded: (si: number) => void): () => Promise<void> {
  let client: pg.Client | null = null;
  let stopped = false;
  let wait = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void open();
    }, wait);
    timer.unref?.();
    wait = Math.min(wait * 2, 60_000);
  };
  const open = async () => {
    const c = new pg.Client({ connectionString: url });
    c.on("notification", (m) => {
      const si = Number(m.payload);
      if (m.channel === LOADED && Number.isInteger(si)) loaded(si);
    });
    c.on("error", () => undefined);
    c.on("end", () => {
      if (client === c) client = null;
      later();
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${LOADED}`);
      if (stopped) await c.end();
      else {
        client = c;
        wait = 1000;
      }
    } catch {
      await c.end().catch(() => undefined);
      later();
    }
  };
  void open();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await client?.end().catch(() => undefined);
  };
}

/** The subject of each of the commits named, by sha, from a Stored Index. */
export async function subjectsOf(db: Db, si: number, shas: string[]): Promise<Map<string, string>> {
  if (shas.length === 0) return new Map();
  const rows = await db
    .select({ sha: sql<string>`encode(${indexCommits.sha}, 'hex')`, subject: indexCommits.subject })
    .from(indexCommits)
    .where(and(eq(indexCommits.si, si), sql`${indexCommits.sha} = ANY (SELECT decode(x, 'hex') FROM unnest(${sql.param(shas)}::text[]) AS x)`));
  return new Map(rows.map((r) => [r.sha, r.subject]));
}
