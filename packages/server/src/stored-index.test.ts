import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { createDb, runMigrations } from "./db/client";
import { indexCommits, indexDays, indexFolderDays, indexFolders, indexPeople, repositories, storedIndexes } from "./db/schema";
import { appendable, EXPORT_FORMAT, listenForLoads, liveIndex, loadExport, loadView, type ExportManifest } from "./stored-index";

const url = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

const sha = (n: number) => `\\\\x${n.toString(16).padStart(40, "0")}`;

type Commit = { n: number; at: number; signature: number; files: number[]; added: number[] | null };

function writeExport(manifest: Partial<ExportManifest>, commits: Commit[], days: [number, number][], folderDays: [number, string, number][]): string {
  const dir = mkdtempSync(join(tmpdir(), "export-"));
  const full: ExportManifest = {
    format: EXPORT_FORMAT,
    lineage: "7",
    kept: true,
    full: true,
    lines: true,
    folders_full: true,
    head: "a".repeat(40),
    frontier: ["a".repeat(40)],
    commits: commits.length,
    total: commits.length,
    days: days.length,
    anchor: 3 * 86_400,
    max_changeset_size: 50,
    coupling_support: 5,
    ownership_min_commits: 10,
    ...manifest,
  };
  const arr = (xs: number[] | null) => (xs ? `{${xs.join(",")}}` : "\\N");
  const tsv = (rows: (string | number)[][]) => rows.map((r) => `${r.join("\t")}\n`).join("");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(full));
  writeFileSync(
    join(dir, "commits.tsv"),
    tsv(commits.map((c) => [sha(c.n), c.at, 0, 0, c.signature, 10, 0, `commit ${c.n}`, arr(c.files), arr(c.files.map(() => 1)), arr(c.added), arr(c.added ? c.added.map(() => 0) : null)])),
  );
  writeFileSync(join(dir, "files.tsv"), tsv([[0, "src/a.ts", "src", 0, 10, "t", 0, "TypeScript", "f", "f"], [1, "b.md", "", 0, 10, "t", 3, "\\N", "f", "f"]]));
  writeFileSync(join(dir, "persons.tsv"), tsv([[0, 0, 1, 2], [1, 0, 1, 1]]));
  writeFileSync(join(dir, "folders.tsv"), tsv([["", "\\N", 0], ["src", "", 1]]));
  writeFileSync(join(dir, "people.tsv"), tsv([[0, "Ada", 0, "Ada", 1, "ada", "f"], [1, "Bob", 1, "Bob", "\\N", "\\N", "f"]]));
  writeFileSync(join(dir, "days.tsv"), tsv(days.map(([day, n]) => [day, n, 0, 0, n, 0, 0])));
  writeFileSync(join(dir, "folder_days.tsv"), tsv(folderDays.map(([day, folder, n]) => [day, folder, n, n, 0, 0])));
  return dir;
}

describe("appendable", () => {
  const live = { id: 1, lineage: "7", kept: true, frontier: ["a"], lines: true, head: "a" };
  test("only a kept Stored Index with a frontier takes what is new", () => {
    expect(appendable(live, true)).toBe(true);
    expect(appendable(null, true)).toBe(false);
    expect(appendable({ ...live, kept: false }, true)).toBe(false);
    expect(appendable({ ...live, frontier: [] }, true)).toBe(false);
  });

  test("lines counted now are never appended to a Stored Index without them", () => {
    expect(appendable({ ...live, lines: false }, true)).toBe(false);
    expect(appendable({ ...live, lines: false }, false)).toBe(true);
  });
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

  test("a full export becomes the live Stored Index", async () => {
    await fresh();
    const dir = writeExport({}, [{ n: 1, at: 86_400, signature: 0, files: [0, 1], added: [3, 4] }, { n: 2, at: 2 * 86_400, signature: 1, files: [0], added: [5] }], [[1, 1], [2, 1]], [[1, "src", 1], [2, "src", 1]]);
    const loaded = await loadExport(pool, repo, dir);
    expect(loaded).toMatchObject({ full: true, total: 2 });
    const live = await liveIndex(db, repo);
    expect(live).toMatchObject({ id: loaded.si, lineage: "7", lines: true, kept: true });
    expect(await db.select({ person: indexPeople.person, login: indexPeople.login }).from(indexPeople).where(eq(indexPeople.si, loaded.si))).toHaveLength(2);
  });

  test("what is new is appended, and only the days it touched are summed again", async () => {
    const live = await liveIndex(db, repo);
    if (!live) throw new Error("no live Stored Index");
    const dir = writeExport({ full: false, folders_full: false }, [{ n: 3, at: 2 * 86_400 + 60, signature: 0, files: [1], added: [1] }], [[2, 2]], [[2, "", 1]]);
    const loaded = await loadExport(pool, repo, dir);
    expect(loaded).toMatchObject({ si: live.id, full: false, commits: 1, total: 3 });
    const days = await db.select({ day: indexDays.day, commits: indexDays.commits }).from(indexDays).where(eq(indexDays.si, live.id)).orderBy(indexDays.day);
    expect(days).toEqual([{ day: 1, commits: 1 }, { day: 2, commits: 2 }]);
    const folders = await db
      .select({ day: indexFolderDays.day, folder: indexFolders.path })
      .from(indexFolderDays)
      .innerJoin(indexFolders, and(eq(indexFolders.si, indexFolderDays.si), eq(indexFolders.id, indexFolderDays.folder)))
      .where(eq(indexFolderDays.si, live.id))
      .orderBy(indexFolderDays.day);
    expect(folders).toEqual([{ day: 1, folder: "src" }, { day: 2, folder: "" }]);
    const tree = await db.select({ id: indexFolders.id, path: indexFolders.path, parent: indexFolders.parent }).from(indexFolders).where(eq(indexFolders.si, live.id)).orderBy(indexFolders.path);
    expect(tree).toEqual([{ id: 0, path: "", parent: null }, { id: 1, path: "src", parent: 0 }]);
  });

  test("a commit stored without lines gets them when an export counts them", async () => {
    await fresh();
    await loadExport(pool, repo, writeExport({ lines: false }, [{ n: 1, at: 86_400, signature: 0, files: [0], added: null }], [[1, 1]], []));
    const live = await liveIndex(db, repo);
    if (!live) throw new Error("no live Stored Index");
    expect(live.lines).toBe(false);
    await loadExport(pool, repo, writeExport({ full: false, lines: true }, [{ n: 1, at: 86_400, signature: 0, files: [0], added: [9] }], [[1, 1]], []));
    const [row] = await db.select({ added: indexCommits.added }).from(indexCommits).where(eq(indexCommits.si, live.id));
    expect(row?.added).toEqual([9]);
  });

  test("a full export from another lineage replaces the old Stored Index and its rows", async () => {
    const before = await liveIndex(db, repo);
    const loaded = await loadExport(pool, repo, writeExport({ lineage: "8" }, [{ n: 5, at: 86_400, signature: 0, files: [0], added: [1] }], [[1, 1]], []));
    expect(loaded.si).not.toBe(before?.id);
    expect(await db.select().from(storedIndexes).where(eq(storedIndexes.repoId, repo))).toHaveLength(1);
    expect(await db.select().from(indexCommits).where(and(eq(indexCommits.si, before?.id ?? -1)))).toHaveLength(0);
  });

  test("an export of what is new from another lineage is refused and changes nothing", async () => {
    const before = await liveIndex(db, repo);
    await expect(loadExport(pool, repo, writeExport({ full: false, lineage: "9" }, [{ n: 6, at: 86_400, signature: 0, files: [0], added: [1] }], [[1, 1]], []))).rejects.toThrow();
    expect(await liveIndex(db, repo)).toEqual(before);
    await db.delete(repositories).where(eq(repositories.id, repo));
  });

  test("a load is announced to whoever listens, and its view is read from one snapshot", async () => {
    await fresh();
    const heard: number[] = [];
    const stop = listenForLoads(url, (si) => heard.push(si));
    await new Promise((done) => setTimeout(done, 1000));
    const loaded = await loadExport(pool, repo, writeExport({}, [{ n: 1, at: 86_400, signature: 0, files: [0, 1], added: [3, 4] }, { n: 2, at: 2 * 86_400, signature: 1, files: [0], added: null }], [[1, 1], [2, 1]], []));
    for (let i = 0; i < 50 && !heard.includes(loaded.si); i++) await new Promise((done) => setTimeout(done, 100));
    await stop();
    expect(heard).toContain(loaded.si);
    const view = await loadView(db, loaded.si);
    expect(view).toMatchObject({ ids: [`${"0".repeat(39)}1`, `${"0".repeat(39)}2`], paths: ["src/a.ts", "b.md"] });
    expect([...(view?.start ?? [])]).toEqual([0, 2, 3]);
    expect([...(view?.file ?? [])]).toEqual([0, 1, 0]);
    expect([...(view?.added ?? [])]).toEqual([3, 4, -1]);
    expect(view?.stamp).toMatch(/^\d+:a{40}$/);
    await db.delete(repositories).where(eq(repositories.id, repo));
  });
});
