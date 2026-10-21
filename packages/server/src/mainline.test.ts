import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { MAINLINE, writeMainline } from "./mainline";
import { LOADED } from "./stored-index";

const { indexCommits, indexDays, indexFiles, repositories, storedIndexes } = schema;
const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));

const hex = (n: number) => n.toString(16).padStart(40, "0");

async function database(): Promise<Db> {
  return (await databaseOn(new PGlite())).db;
}

async function databaseOn(pg: PGlite): Promise<{ db: Db; pg: PGlite }> {
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: migrations });
  return { db: db as unknown as Db, pg };
}

async function indexed(db: Db, commits: { n: number; flags: number }[]) {
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  const [si] = await db
    .insert(storedIndexes)
    .values({
      repoId: "acme/rocket",
      lineage: "1",
      kept: true,
      state: "live",
      lines: true,
      builtAt: 1,
      loadedAt: 100,
      head: hex(3),
      snapshot: { commits: 3, merges: 0, oldest: 1, newest: 3, languages: [], code_age: [], suspects: [], releases: [["v1", 2], ["v2", 3]] },
    })
    .returning({ id: storedIndexes.id });
  const id = si?.id ?? 0;
  await db.insert(indexCommits).values(
    commits.map((c) => ({ si: id, sha: Buffer.from(hex(c.n), "hex"), at: c.n, offset: 0, authorDelta: 0, signature: 0, kind: 10, flags: c.flags, subject: `c${c.n}`, files: [], changes: [] })),
  );
  return id;
}

const rows = (db: Db, si: number) =>
  db
    .select({ sha: sql<string>`encode(${indexCommits.sha}, 'hex')`, flags: indexCommits.flags, arrival: indexCommits.arrival })
    .from(indexCommits)
    .where(eq(indexCommits.si, si))
    .orderBy(asc(indexCommits.at));

const { reachable, firstParent } = MAINLINE;

test("the Mainline is written over every commit of the index, keeping the other flags, and only what changed is written again", async () => {
  const db = await database();
  const si = await indexed(db, [
    { n: 1, flags: 0 },
    { n: 2, flags: 1 },
    { n: 3, flags: 4 | reachable },
    { n: 4, flags: firstParent },
  ]);
  const m = { shas: [hex(3), hex(2), hex(1)], bits: [reachable | firstParent, reachable | firstParent, reachable], arrival: [3, 2, 2] };
  expect(await writeMainline(db, si, m, new Map([["v1", hex(2)], ["v9", hex(9)]]))).toEqual({ changed: 4, releases: 1 });
  expect((await rows(db, si)).map((r) => [r.flags, r.arrival])).toEqual([
    [reachable, 2],
    [1 | reachable | firstParent, 2],
    [4 | reachable | firstParent, 3],
    [0, null],
  ]);
  const [index] = await db.select().from(storedIndexes).where(eq(storedIndexes.id, si));
  expect(index?.snapshot?.release_shas).toEqual({ v1: hex(2) });
  expect(index?.loadedAt).toBeGreaterThan(100);
  expect(await writeMainline(db, si, m, new Map([["v1", hex(2)]]))).toEqual({ changed: 0, releases: 1 });
  const [again] = await db.select({ loadedAt: storedIndexes.loadedAt }).from(storedIndexes).where(eq(storedIndexes.id, si));
  expect(again?.loadedAt).toBe(index?.loadedAt);
});

test("the Site is told when a Mainline written changes an index, and not when it changes nothing", async () => {
  const { db, pg } = await databaseOn(new PGlite());
  const si = await indexed(db, [{ n: 1, flags: 0 }]);
  const heard: string[] = [];
  await pg.listen(LOADED, (payload) => heard.push(payload));
  const m = { shas: [hex(1)], bits: [reachable | firstParent], arrival: [1] };
  await writeMainline(db, si, m);
  await writeMainline(db, si, m);
  await new Promise((done) => setTimeout(done, 50));
  expect(heard).toEqual([String(si)]);
});

test("deleting a Stored Index deletes its rows, with no foreign key checked on each row loaded", async () => {
  const db = await database();
  const si = await indexed(db, [{ n: 1, flags: 0 }]);
  await db.insert(indexDays).values({ si, day: 1, commits: 1, merges: 0, bulk: 0, changes: 0, added: 0, removed: 0 });
  await db.insert(indexFiles).values({ si, file: 0, path: "a", folder: 0, born: 1, last: 1, alive: true });
  await db.delete(repositories).where(eq(repositories.id, "acme/rocket"));
  expect(await db.select().from(indexCommits)).toEqual([]);
  expect(await db.select().from(indexDays)).toEqual([]);
  expect(await db.select().from(indexFiles)).toEqual([]);
});
