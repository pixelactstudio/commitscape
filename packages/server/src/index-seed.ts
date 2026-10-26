import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { indexCommitLines, indexCommits, indexFiles, indexFolders, indexHeadFiles, indexPeople, indexPersons, repositories, storedIndexes } from "./db/schema";
import { now } from "./time";

export type SeedCommit = { sha: string; at: number; person: number | null; subject?: string; files: number[]; merge?: boolean; kind?: number; offset?: number; added?: number[] | null; removed?: number[] | null };

export type SeedIndex = {
  anchor: number;
  head?: string;
  lines?: boolean;
  persons: { id: number; name: string; login?: string | null; bot?: boolean }[];
  files: { file: number; path: string; born?: number; last?: number; alive?: boolean }[];
  headFiles?: { file: number; blob: string; bytes: number; lines: number; class: string }[];
  commits: SeedCommit[];
};

const UNKNOWN = 1_000_000;

/** Writes a small Stored Index straight into the database and makes it the repository's live one, for tests on PGlite, which has no `COPY`. */
export async function seedIndex(db: Db, repoId: string, seed: SeedIndex): Promise<number> {
  const [row] = await db
    .insert(storedIndexes)
    .values({
      repoId,
      lineage: "1",
      kept: true,
      state: "live",
      head: seed.head ?? seed.commits.at(-1)?.sha ?? null,
      frontier: [],
      lines: seed.lines ?? true,
      commits: seed.commits.length,
      builtAt: now(),
      loadedAt: now(),
      anchor: seed.anchor,
      snapshot: { commits: seed.commits.length, merges: seed.commits.filter((c) => c.merge).length, oldest: seed.commits[0]?.at ?? null, newest: seed.commits.at(-1)?.at ?? null, languages: [], code_age: [], suspects: [], releases: [] },
    })
    .returning({ id: storedIndexes.id });
  if (!row) throw new Error("no Stored Index was made");
  const si = row.id;
  await db.insert(indexPersons).values(seed.persons.map((p) => ({ si, person: p.id, traits: p.bot ? 4 : 0, identities: 1, commits: seed.commits.filter((c) => c.person === p.id).length })));
  await db.insert(indexPeople).values([
    ...seed.persons.map((p) => ({ si, signature: p.id, name: p.name, person: p.id, personName: p.name, colour: null, login: p.login ?? null, bot: p.bot ?? false })),
    { si, signature: UNKNOWN, name: "someone", person: null, personName: null, colour: null, login: null, bot: false },
  ]);
  const folders = new Set<string>([""]);
  for (const f of seed.files) {
    const parts = f.path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  const folderIds = new Map([...folders].sort().map((path, id) => [path, id]));
  await db.insert(indexFolders).values(
    [...folderIds].map(([path, id]) => {
      const parent = path === "" ? null : (folderIds.get(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") ?? null);
      return { si, id, path, parent, depth: path === "" ? 0 : path.split("/").length };
    }),
  );
  await db.insert(indexFiles).values(
    seed.files.map((f) => ({
      si,
      file: f.file,
      path: f.path,
      folder: folderIds.get(f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "") ?? 0,
      born: f.born ?? 0,
      last: f.last ?? 0,
      alive: f.alive ?? true,
    })),
  );
  if (seed.headFiles?.length)
    await db.insert(indexHeadFiles).values(seed.headFiles.map((h) => ({ si, file: h.file, blob: Buffer.from(h.blob, "hex"), bytes: h.bytes, lines: h.lines, class: h.class, indentLevels: 0, indentMean: 0, indentStddev: 0 })));
  if (seed.commits.length)
    await db.insert(indexCommits).values(
      seed.commits.map((c) => ({
        si,
        sha: Buffer.from(c.sha, "hex"),
        at: c.at,
        offset: c.offset ?? 0,
        authorDelta: 0,
        signature: c.person ?? UNKNOWN,
        kind: c.kind ?? 10,
        flags: c.merge ? 1 : 0,
        subject: c.subject ?? "",
        files: c.files,
        changes: c.files.map(() => 1),
      })),
    );
  const total = (list: number[]) => list.reduce((a, b) => a + b, 0);
  if (seed.commits.length && seed.lines !== false)
    await db.insert(indexCommitLines).values(
      seed.commits.map((c) => ({ si, sha: Buffer.from(c.sha, "hex"), added: total(c.added ?? c.files.map(() => 1)), removed: total(c.removed ?? []) })),
    );
  await db.update(repositories).set({ indexId: si }).where(eq(repositories.id, repoId));
  return si;
}
