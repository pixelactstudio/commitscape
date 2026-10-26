import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, test } from "vitest";
import { createDb, runMigrations, type Db } from "./db/client";
import * as schema from "./db/schema";
import { indexCommitLines, indexCommits, indexFiles, indexFolders, indexPeople, repositories, storedIndexes } from "./db/schema";
import { appendable, EXPORT_FORMAT, listenForLoads, liveIndex, loadExport, type ExportManifest } from "./stored-index";

const url = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

const hex = (n: number) => n.toString(16).padStart(40, "0");
const sha = (n: number) => `\\\\x${hex(n)}`;

type Commit = { n: number; at: number; signature: number; files: number[]; added: number[] | null; flags?: number; arrival?: number | null };

type Extra = { mainline?: { n: number; flags: number; arrival: number | null }[]; lines?: { n: number; added: number[] }[]; releases?: Record<string, string> };

function writeExport(manifest: Partial<ExportManifest>, commits: Commit[], extra: Extra = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "export-"));
  const full: ExportManifest = {
    format: EXPORT_FORMAT,
    lineage: "7",
    kept: true,
    full: true,
    lines: true,
    lines_counted: commits.length,
    lines_mainline: true,
    lines_left: 0,
    head: "a".repeat(40),
    frontier: ["a".repeat(40)],
    commits: commits.length,
    total: commits.length,
    anchor: 3 * 86_400,
    max_changeset_size: 50,
    coupling_support: 5,
    ownership_min_commits: 10,
    mark: "full mark",
    changes_only: false,
    ...manifest,
  };
  const arr = (xs: number[] | null) => (xs ? `{${xs.join(",")}}` : "\\N");
  const tsv = (rows: (string | number)[][]) => rows.map((r) => `${r.join("\t")}\n`).join("");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(full));
  writeFileSync(
    join(dir, "commits.tsv"),
    tsv(commits.map((c) => [sha(c.n), c.at, 0, 0, c.signature, 10, c.flags ?? 24, c.arrival === undefined ? c.at : (c.arrival ?? "\\N"), `commit ${c.n}`, arr(c.files), arr(c.files.map(() => 1)), arr(c.added), arr(c.added ? c.added.map(() => 0) : null)])),
  );
  writeFileSync(join(dir, "mainline.tsv"), tsv((extra.mainline ?? []).map((m) => [sha(m.n), m.flags, m.arrival ?? "\\N"])));
  writeFileSync(join(dir, "lines.tsv"), tsv((extra.lines ?? []).map((l) => [sha(l.n), arr(l.added), arr(l.added.map(() => 0))])));
  writeFileSync(join(dir, "files.tsv"), tsv([[0, "src/a.ts", "src", 0, 10, "t", 0, "TypeScript", "f", "f"], [1, "b.md", "", 0, 10, "t", 3, "\\N", "f", "f"]]));
  writeFileSync(join(dir, "persons.tsv"), tsv([[0, 0, 1, 2], [1, 0, 1, 1]]));
  writeFileSync(join(dir, "folders.tsv"), tsv([["", "\\N", 0], ["src", "", 1]]));
  writeFileSync(join(dir, "people.tsv"), tsv([[0, "Ada", 0, "Ada", 1, "ada", "f"], [1, "Bob", 1, "Bob", "\\N", "\\N", "f"]]));
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify({ commits: commits.length, merges: 0, oldest: null, newest: null, languages: [], code_age: [], suspects: [], releases: Object.keys(extra.releases ?? {}).map((name) => [name, 1]), release_shas: extra.releases ?? {} }));
  return dir;
}

describe("appendable", () => {
  const live = { id: 1, lineage: "7", kept: true, frontier: ["a"], lines: true, linesLeft: 0, head: "a", pack: null, mark: null };
  test("only a kept Stored Index with a frontier takes what is new", () => {
    expect(appendable(live)).toBe(true);
    expect(appendable(null)).toBe(false);
    expect(appendable({ ...live, kept: false })).toBe(false);
    expect(appendable({ ...live, frontier: [] })).toBe(false);
  });

  test("a Stored Index without lines takes the lines counted since", () => {
    expect(appendable({ ...live, lines: false })).toBe(true);
  });
});

test("deleting a Stored Index deletes its rows, with no foreign key checked on each row loaded", async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  const [row] = await db.insert(storedIndexes).values({ repoId: "acme/rocket", lineage: "1", kept: true, state: "live", lines: true, builtAt: 1 }).returning({ id: storedIndexes.id });
  const si = row?.id ?? 0;
  await db.insert(indexCommits).values({ si, sha: Buffer.from(hex(1), "hex"), at: 1, offset: 0, authorDelta: 0, signature: 0, kind: 10, flags: 0, subject: "", files: [], changes: [] });
  await db.insert(indexCommitLines).values({ si, sha: Buffer.from(hex(1), "hex"), added: 3, removed: 1 });
  await db.insert(indexFiles).values({ si, file: 0, path: "a", folder: 0, born: 1, last: 1, alive: true });
  await db.delete(repositories).where(eq(repositories.id, "acme/rocket"));
  expect(await db.select().from(indexCommits)).toEqual([]);
  expect(await db.select().from(indexCommitLines)).toEqual([]);
  expect(await db.select().from(indexFiles)).toEqual([]);
});

describe.skipIf(!url)("loading an export into Postgres", async () => {
  if (!url) return;
  await runMigrations(url, migrations);
  const { db, pool } = createDb(url);
  afterAll(() => pool.end());
  const repo = "t/indexed";

  const fresh = async () => {
    await db.delete(repositories).where(eq(repositories.id, repo));
    await db.insert(repositories).values({ id: repo, owner: "t", name: "indexed" });
  };

  const commitRows = (si: number) =>
    db
      .select({ sha: sql<string>`encode(${indexCommits.sha}, 'hex')`, flags: indexCommits.flags, arrival: indexCommits.arrival, added: indexCommitLines.added, removed: indexCommitLines.removed })
      .from(indexCommits)
      .leftJoin(indexCommitLines, and(eq(indexCommitLines.si, indexCommits.si), eq(indexCommitLines.sha, indexCommits.sha)))
      .where(eq(indexCommits.si, si))
      .orderBy(asc(indexCommits.at));

  test("a full export becomes the live Stored Index, with each commit's Mainline", async () => {
    await fresh();
    const dir = writeExport({}, [{ n: 1, at: 86_400, signature: 0, files: [0, 1], added: [3, 4] }, { n: 2, at: 2 * 86_400, signature: 1, files: [0], added: [5], flags: 8, arrival: 3 * 86_400 }], { releases: { "v1.0": hex(2) } });
    const loaded = await loadExport(pool, repo, dir);
    expect(loaded).toMatchObject({ full: true, total: 2, mainline: 0, lines: 0 });
    const live = await liveIndex(db, repo);
    expect(live).toMatchObject({ id: loaded.si, lineage: "7", lines: true, kept: true, mark: "full mark" });
    expect(await db.select({ person: indexPeople.person, login: indexPeople.login }).from(indexPeople).where(eq(indexPeople.si, loaded.si))).toHaveLength(2);
    expect((await commitRows(loaded.si)).map((r) => [r.flags, r.arrival, r.added, r.removed])).toEqual([
      [24, 86_400, 7, 0],
      [8, 3 * 86_400, 5, 0],
    ]);
    const [index] = await db.select({ snapshot: storedIndexes.snapshot }).from(storedIndexes).where(eq(storedIndexes.id, loaded.si));
    expect(index?.snapshot?.release_shas).toEqual({ "v1.0": hex(2) });
  });

  test("what is new is appended, and a merge that brings older commits into the Mainline moves them", async () => {
    const live = await liveIndex(db, repo);
    if (!live) throw new Error("no live Stored Index");
    const [before] = await db.select({ loadedAt: storedIndexes.loadedAt }).from(storedIndexes).where(eq(storedIndexes.id, live.id));
    const dir = writeExport({ full: false, total: 3, mark: "appended mark", changes_only: true }, [{ n: 3, at: 2 * 86_400 + 60, signature: 0, files: [1], added: [1], flags: 25, arrival: 2 * 86_400 + 60 }], {
      mainline: [
        { n: 1, flags: 24, arrival: 86_400 },
        { n: 2, flags: 8, arrival: 2 * 86_400 + 60 },
        { n: 3, flags: 25, arrival: 2 * 86_400 + 60 },
      ],
    });
    const loaded = await loadExport(pool, repo, dir);
    expect(loaded).toMatchObject({ si: live.id, full: false, commits: 1, total: 3, mainline: 1 });
    expect((await liveIndex(db, repo))?.mark).toBe("appended mark");
    expect((await commitRows(live.id)).map((r) => [r.flags, r.arrival])).toEqual([
      [24, 86_400],
      [8, 2 * 86_400 + 60],
      [25, 2 * 86_400 + 60],
    ]);
    const [after] = await db.select({ loadedAt: storedIndexes.loadedAt }).from(storedIndexes).where(eq(storedIndexes.id, live.id));
    expect(after?.loadedAt).toBeGreaterThan(before?.loadedAt ?? 0);
    const tree = await db.select({ id: indexFolders.id, path: indexFolders.path, parent: indexFolders.parent }).from(indexFolders).where(eq(indexFolders.si, live.id)).orderBy(indexFolders.path);
    expect(tree).toEqual([{ id: 0, path: "", parent: null }, { id: 1, path: "src", parent: 0 }]);
  });

  test("lines counted after a quick load are filled in on the same Stored Index, and show once the Mainline's are all counted", async () => {
    await fresh();
    const quick = await loadExport(pool, repo, writeExport({ lines: false, lines_counted: 0, lines_mainline: false, lines_left: null }, [{ n: 1, at: 86_400, signature: 0, files: [0], added: null }, { n: 2, at: 2 * 86_400, signature: 0, files: [0, 1], added: null }]));
    expect(await liveIndex(db, repo)).toMatchObject({ id: quick.si, lines: false, linesLeft: null });
    const partly = await loadExport(pool, repo, writeExport({ full: false, lines: false, lines_counted: 1, lines_mainline: false, lines_left: 1, total: 2 }, [], { lines: [{ n: 2, added: [7, 8] }] }));
    expect(partly).toMatchObject({ si: quick.si, commits: 0, lines: 1 });
    expect(await liveIndex(db, repo)).toMatchObject({ id: quick.si, lines: false, linesLeft: 1 });
    const mainline = await loadExport(pool, repo, writeExport({ full: false, lines: false, lines_counted: 1, lines_mainline: true, lines_left: 1, total: 2 }, []));
    expect(mainline).toMatchObject({ si: quick.si, commits: 0, lines: 0 });
    expect(await liveIndex(db, repo)).toMatchObject({ id: quick.si, lines: true, linesLeft: 1 });
    const filled = await loadExport(pool, repo, writeExport({ full: false, lines: true, total: 2 }, [], { lines: [{ n: 1, added: [9] }, { n: 2, added: [1, 1] }] }));
    expect(filled).toMatchObject({ si: quick.si, commits: 0, lines: 1 });
    expect(await liveIndex(db, repo)).toMatchObject({ id: quick.si, lines: true, linesLeft: 0 });
    expect((await commitRows(quick.si)).map((r) => r.added)).toEqual([9, 15]);
    expect(await db.select().from(storedIndexes).where(eq(storedIndexes.repoId, repo))).toHaveLength(1);
  });

  test("a full export from another lineage replaces the old Stored Index and its rows", async () => {
    const before = await liveIndex(db, repo);
    const loaded = await loadExport(pool, repo, writeExport({ lineage: "8" }, [{ n: 5, at: 86_400, signature: 0, files: [0], added: [1] }]));
    expect(loaded.si).not.toBe(before?.id);
    expect(await db.select().from(storedIndexes).where(eq(storedIndexes.repoId, repo))).toHaveLength(1);
    expect(await db.select().from(indexCommits).where(and(eq(indexCommits.si, before?.id ?? -1)))).toHaveLength(0);
    expect(await db.select().from(indexCommitLines).where(eq(indexCommitLines.si, before?.id ?? -1))).toHaveLength(0);
  });

  test("an export of what is new from another lineage is refused and changes nothing", async () => {
    const before = await liveIndex(db, repo);
    await expect(loadExport(pool, repo, writeExport({ full: false, lineage: "9" }, [{ n: 6, at: 86_400, signature: 0, files: [0], added: [1] }]))).rejects.toThrow();
    expect(await liveIndex(db, repo)).toEqual(before);
    await db.delete(repositories).where(eq(repositories.id, repo));
  });

  test("a load is announced to whoever listens", async () => {
    await fresh();
    const heard: number[] = [];
    const stop = listenForLoads(url, (si) => heard.push(si));
    await new Promise((done) => setTimeout(done, 1000));
    const loaded = await loadExport(pool, repo, writeExport({}, [{ n: 1, at: 86_400, signature: 0, files: [0, 1], added: [3, 4] }, { n: 2, at: 2 * 86_400, signature: 1, files: [0], added: null }]));
    for (let i = 0; i < 50 && !heard.includes(loaded.si); i++) await new Promise((done) => setTimeout(done, 100));
    await stop();
    expect(heard).toContain(loaded.si);
    await db.delete(repositories).where(eq(repositories.id, repo));
  });
});
