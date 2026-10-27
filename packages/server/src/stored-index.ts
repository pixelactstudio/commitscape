import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { count, eq, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { indexCommits, repositories, storedIndexes, type IndexSnapshot } from "./db/schema";
import { now } from "./time";

export const EXPORT_FORMAT = 4;

export type ExportManifest = {
  format: number;
  lineage: string;
  kept: boolean;
  full: boolean;
  lines: boolean;
  lines_counted: number;
  lines_mainline: boolean;
  lines_left: number | null;
  head: string | null;
  frontier: string[];
  commits: number;
  total: number;
  anchor: number;
  max_changeset_size: number;
  coupling_support: number;
  ownership_min_commits: number;
  mark: string;
  changes_only: boolean;
};

export const LOADED = "stored_index_loaded";

export type LiveIndex = { id: number; lineage: string; kept: boolean; frontier: string[]; lines: boolean; linesLeft: number | null; head: string | null; pack: string | null; mark: string | null; buildFormat: number | null; commits: number };

export type Loaded = { si: number; full: boolean; commits: number; total: number; mainline: number; lines: number; seconds: number };

const STAGING: [file: string, table: string, columns: string, appended: boolean][] = [
  ["commits.tsv", "s_commits", `sha bytea, at bigint, "offset" smallint, author_delta integer, signature integer, kind smallint, flags smallint, arrival bigint, subject text, files integer[], changes smallint[], added integer[], removed integer[]`, false],
  ["mainline.tsv", "s_mainline", "sha bytea, flags smallint, arrival bigint", true],
  ["lines.tsv", "s_lines", "sha bytea, added integer[], removed integer[]", true],
  ["files.tsv", "s_files", "file integer, path text, folder text, born bigint, last bigint, alive boolean, role smallint, language text, guessed_generated boolean, lockfile boolean", false],
  ["file_paths.tsv", "s_file_paths", "file integer, path text", false],
  ["folders.tsv", "s_folders", "path text, parent text, depth smallint", false],
  ["persons.tsv", "s_persons", "person integer, traits smallint, identities integer, commits integer", false],
  ["people.tsv", "s_people", "signature integer, name text, person integer, person_name text, colour smallint, login text, bot boolean", false],
  ["head_files.tsv", "s_head_files", "file integer, blob bytea, bytes bigint, lines integer, class text, indent_levels integer, indent_mean real, indent_stddev real", false],
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
    .select({ id: storedIndexes.id, lineage: storedIndexes.lineage, kept: storedIndexes.kept, frontier: storedIndexes.frontier, lines: storedIndexes.lines, linesLeft: storedIndexes.linesLeft, head: storedIndexes.head, pack: storedIndexes.pack, mark: storedIndexes.mark, buildFormat: storedIndexes.buildFormat, commits: storedIndexes.commits })
    .from(repositories)
    .innerJoin(storedIndexes, eq(storedIndexes.id, repositories.indexId))
    .where(eq(repositories.id, repoId));
  return row ?? null;
}

/** Whether the next export may hold only what is new: the live Stored Index came from a cache that was kept. Lines counted since are filled in on it. */
export function appendable(live: LiveIndex | null): live is LiveIndex {
  return live !== null && live.kept && live.frontier.length > 0;
}

/** Loads what `commitscape export` wrote into Postgres in one transaction, as a new Stored Index, or appended to the live one with its Mainline brought up to date and the Lines Changed counted since filled in. Its lines show once the Mainline's are all counted; how many commits still wait is kept beside. */
export async function loadExport(pool: pg.Pool, repoId: string, dir: string): Promise<Loaded> {
  const started = Date.now();
  const manifest = await readManifest(dir);
  const client = await pool.connect();
  const db = drizzle(client, { schema }) as unknown as Db;
  try {
    await client.query("BEGIN");
    const si = await target(db, repoId, manifest);
    for (const [file, table, columns, appended] of STAGING) {
      if (appended && manifest.full) continue;
      await client.query(`CREATE TEMP TABLE ${table} (${columns}) ON COMMIT DROP`);
      const path = join(dir, file);
      if (existsSync(path)) await pipeline(createReadStream(path), client.query(copyFrom(`COPY ${table} FROM STDIN`)));
      await client.query(`ANALYZE ${table}`);
    }
    const merged = await merge(db, si, manifest);
    const [counted] = await db.select({ commits: count() }).from(indexCommits).where(eq(indexCommits.si, si));
    const commits = counted?.commits ?? 0;
    await db
      .update(storedIndexes)
      .set({
        lineage: manifest.lineage,
        kept: manifest.kept,
        head: manifest.head,
        frontier: manifest.frontier,
        lines: manifest.lines_mainline,
        linesLeft: manifest.lines_left,
        commits,
        state: "live",
        loadedAt: sql`greatest(${now()}, coalesce(${storedIndexes.loadedAt}, 0) + 1)`,
        anchor: manifest.anchor,
        options: { max_changeset_size: manifest.max_changeset_size, coupling_support: manifest.coupling_support, ownership_min_commits: manifest.ownership_min_commits },
        snapshot: await readSnapshot(dir),
        mark: manifest.mark,
      })
      .where(eq(storedIndexes.id, si));
    await db.update(repositories).set({ indexId: si }).where(eq(repositories.id, repoId));
    if (manifest.full) await db.execute(sql`DELETE FROM stored_indexes WHERE repo_id = ${repoId} AND id <> ${si}`);
    await client.query("SELECT pg_notify($1, $2)", [LOADED, String(si)]);
    await client.query("COMMIT");
    if (manifest.full) await client.query("ANALYZE index_commits").catch(() => undefined);
    return { si, full: manifest.full, commits: manifest.commits, total: commits, ...merged, seconds: (Date.now() - started) / 1000 };
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
    .values({ repoId, lineage: manifest.lineage, kept: manifest.kept, state: "loading", lines: manifest.lines_mainline, builtAt: now() })
    .returning({ id: storedIndexes.id });
  if (!row) throw new Error("no Stored Index was made");
  return row.id;
}

function rowCount(result: unknown): number {
  const r = result as { rowCount?: number | null };
  return r.rowCount ?? 0;
}

async function merge(db: Db, si: number, manifest: ExportManifest): Promise<{ mainline: number; lines: number }> {
  await db.execute(sql`
    INSERT INTO index_commits (si, sha, at, "offset", author_delta, signature, kind, flags, arrival, subject, files, changes)
    SELECT ${si}, sha, at, "offset", author_delta, signature, kind, flags, arrival, subject, files, changes FROM s_commits
    ON CONFLICT (si, sha) DO NOTHING`);
  const lines = (from: SQL) =>
    db.execute(sql`
      INSERT INTO index_commit_lines (si, sha, added, removed)
      SELECT ${si}, l.sha, coalesce((SELECT sum(x) FROM unnest(l.added) AS x), 0), coalesce((SELECT sum(x) FROM unnest(l.removed) AS x), 0)
      FROM ${from} l JOIN index_commits c ON c.si = ${si} AND c.sha = l.sha
      WHERE l.added IS NOT NULL
      ON CONFLICT (si, sha) DO NOTHING`);
  await lines(sql`s_commits`);
  const changed = { mainline: 0, lines: 0 };
  if (!manifest.full) {
    changed.mainline = rowCount(
      await db.execute(sql`
        UPDATE index_commits c SET flags = m.flags, arrival = m.arrival FROM s_mainline m
        WHERE c.si = ${si} AND c.sha = m.sha AND (c.flags <> m.flags OR c.arrival IS DISTINCT FROM m.arrival)`),
    );
    changed.lines = rowCount(await lines(sql`s_lines`));
  }
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
  await db.execute(sql`DELETE FROM index_head_files WHERE si = ${si}`);
  await db.execute(sql`
    INSERT INTO index_head_files (si, file, blob, bytes, lines, class, indent_levels, indent_mean, indent_stddev)
    SELECT ${si}, file, blob, bytes, lines, class, indent_levels, indent_mean, indent_stddev FROM s_head_files`);
  return changed;
}

/** Calls `loaded` with the id of each Stored Index a Build loads or publishes, as Postgres announces it, on one connection kept open and opened again when lost; the returned function stops listening. */
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
