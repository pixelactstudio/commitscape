import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { memoryStorage, schema, type Db } from "@commitscape/server";
import { CHUNK_BYTES, forgetStates, hasCache, restoreState, saveState, statePrefix, stateKeys } from "./state";

const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const keys = stateKeys("k".repeat(40));

async function cache(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "state-"));
  const dir = join(root, "key-0123456789abcdef");
  await mkdir(join(dir, "blame"), { recursive: true });
  await writeFile(join(dir, "index.current"), "00000000000000aa");
  await writeFile(join(dir, "00000000000000aa.head"), "head ada@example.com");
  await writeFile(join(dir, "00000000000000aa.data"), Buffer.alloc(CHUNK_BYTES + 100, 7));
  await writeFile(join(dir, "lines"), "lines");
  await writeFile(join(dir, "graph"), "made again from git");
  await writeFile(join(dir, "index.lock"), "");
  await writeFile(join(dir, "blame", "x"), "per head");
  return root;
}

const read = (root: string, file: string) => readFile(join(root, "key-0123456789abcdef", file));

test("a State is kept in R2 sealed, so no email address leaves the Builder, and comes back the same", async () => {
  const storage = memoryStorage();
  const root = await cache();
  const saved = await saveState({ storage, keys }, "acme/rocket", root);
  expect(saved).toMatchObject({ files: 4, chunks: 5, uploaded: 5, deleted: 0 });
  const prefix = statePrefix("acme/rocket");
  expect([...storage.objects.keys()].every((k) => k.startsWith(prefix))).toBe(true);
  expect([...storage.objects.values()].some((o) => Buffer.from(o.body).includes("ada@example.com"))).toBe(false);

  const into = join(await mkdtemp(join(tmpdir(), "state-")), "caches", "acme", "rocket");
  expect(await hasCache(into)).toBe(false);
  expect(await restoreState({ storage, keys }, "acme/rocket", into)).toEqual({ restored: true, bytes: CHUNK_BYTES + 100 + 20 + 16 + 5 });
  expect(await hasCache(into)).toBe(true);
  for (const f of ["index.current", "00000000000000aa.head", "00000000000000aa.data", "lines"]) expect((await read(into, f)).equals(await read(root, f))).toBe(true);
  await expect(read(into, "graph")).rejects.toThrow();
  expect(await restoreState({ storage, keys }, "acme/rocket", into)).toEqual({ restored: false, bytes: 0 });
});

test("a later save uploads only the chunks R2 does not hold, and deletes the ones no manifest names", async () => {
  const storage = memoryStorage();
  const root = await cache();
  await saveState({ storage, keys }, "acme/rocket", root);
  const first = new Set(storage.objects.keys());
  expect(await saveState({ storage, keys }, "acme/rocket", root)).toMatchObject({ uploaded: 0, sent: 0, deleted: 0 });
  await appendFile(join(root, "key-0123456789abcdef", "00000000000000aa.data"), "more");
  const again = await saveState({ storage, keys }, "acme/rocket", root);
  expect(again).toMatchObject({ uploaded: 1, deleted: 1 });
  expect(again.sent).toBeLessThan(1024);
  const now = new Set(storage.objects.keys());
  expect([...now].filter((k) => !first.has(k))).toHaveLength(1);
});

test("a State whose chunk was changed or lost is not restored, and nothing is left half in place", async () => {
  const storage = memoryStorage();
  const root = await cache();
  await saveState({ storage, keys }, "acme/rocket", root);
  const prefix = statePrefix("acme/rocket");
  const chunk = [...storage.objects.keys()].find((k) => k !== `${prefix}manifest`) ?? "";
  const body = storage.objects.get(chunk)?.body ?? new Uint8Array();
  const tampered = Uint8Array.from(body);
  tampered[20] = (tampered[20] ?? 0) ^ 1;
  storage.objects.set(chunk, { body: tampered, type: undefined, encoding: undefined });
  const lines: string[] = [];
  const into = join(await mkdtemp(join(tmpdir(), "state-")), "rocket");
  expect(await restoreState({ storage, keys, log: (l) => lines.push(l) }, "acme/rocket", into)).toEqual({ restored: false, bytes: 0 });
  expect(await hasCache(into)).toBe(false);
  expect(lines[0]).toContain("not restored");
  expect(await restoreState({ storage, keys: stateKeys("o".repeat(40)) }, "acme/rocket", into)).toEqual({ restored: false, bytes: 0 });
  expect(await restoreState({ storage, keys }, "acme/other", into)).toEqual({ restored: false, bytes: 0 });
});

test("States unused for the days kept are deleted from R2 with their rows; used ones stay", async () => {
  const db = await database();
  const storage = memoryStorage();
  const day = 24 * 3600;
  await saveState({ storage, keys, db }, "acme/old", await cache(), 1000 * day);
  await saveState({ storage, keys, db }, "acme/new", await cache(), 1170 * day);
  expect(await forgetStates({ storage, db }, 180, 1190 * day)).toEqual(["acme/old"]);
  expect([...storage.objects.keys()].some((k) => k.startsWith(statePrefix("acme/old")))).toBe(false);
  expect([...storage.objects.keys()].some((k) => k.startsWith(statePrefix("acme/new")))).toBe(true);
  expect((await db.select().from(schema.repoStates)).map((r) => r.repoId)).toEqual(["acme/new"]);
  await restoreState({ storage, keys, db }, "acme/new", join(await mkdtemp(join(tmpdir(), "state-")), "x"), 1200 * day);
  expect((await db.select().from(schema.repoStates))[0]?.usedAt).toBe(1200 * day);
});
