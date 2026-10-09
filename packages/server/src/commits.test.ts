import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { count, eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import { UNKNOWN_PERSON, type CommitList } from "@commitscape/data";
import { commitPage, commitsMetaKey, dropCommits, storeCommits } from "./commits";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { removeReports, settleRepository } from "./repos";
import { memoryStorage } from "./storage";

const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));
const person = (id: number, name: string, login: string | null) => ({ person: { id, name, colour: null, login }, emails: ["hidden@example.com"] });

const list: CommitList = {
  link: "https://github.com/acme/rocket/commit/",
  lines: true,
  kinds: ["features", "fixes", "docs"],
  people: [person(7, "Alice Example", "alice"), person(8, "Bob Builder", null), { person: { id: UNKNOWN_PERSON, name: "someone unknown", colour: null, login: null }, emails: [] }],
  ids: ["a1", "b2", "c3", "d4", "e5", "f6"],
  times: [600, 500, 400, 300, 200, 100],
  offsets: [60, 0, 0, 0, -120, 0],
  person: [0, 1, 0, 2, 1, 0],
  subjects: ["feat: one", "fix: 100% of two", "docs: three_x", "feat: four", "fix: five", "Fix the walk"],
  kind: [0, 1, 2, 0, 1, 1],
  merge: [false, true, false, false, false, false],
  files: [1, 2, 3, 4, 5, 6],
  added: [1, null, 3, 4, 5, 6],
  removed: [0, null, 1, 2, 3, 4],
};

describe("commits as rows", () => {
  let db: Db;
  const storage = memoryStorage();
  const key = "reports/gh/acme/rocket/b1";
  const page = (q: Omit<Parameters<typeof commitPage>[2], "repoId" | "reportKey"> = {}) => commitPage(db, storage, { repoId: "acme/rocket", reportKey: key, ...q });
  const shas = async (q: Parameters<typeof page>[0]) => (await page(q))?.rows.map((r) => r.sha);

  beforeAll(async () => {
    db = drizzle(new PGlite(), { schema }) as unknown as Db;
    await migrate(db as never, { migrationsFolder: migrations });
    await db.insert(schema.repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket", githubId: 1, reportKey: key });
    expect(await storeCommits(db, storage, "acme/rocket", key, gzipSync(JSON.stringify(list)))).toEqual({ rows: 6 });
  });

  test("a stored list is paged newest first with an opaque cursor", async () => {
    const first = await page({ limit: 4 });
    expect(first).toMatchObject({ link: list.link, lines: true, kinds: list.kinds, all: 6, total: 6 });
    expect(first?.rows.map((r) => r.sha)).toEqual(["a1", "b2", "c3", "d4"]);
    expect(first?.rows[3]).toEqual({ sha: "d4", at: 300, offset: 0, personId: UNKNOWN_PERSON, subject: "feat: four", kind: 0, merge: false, files: 4, added: 4, removed: 2 });
    expect(Object.keys(first?.people ?? {}).sort()).toEqual(["4294967295", "7", "8"]);
    expect(JSON.stringify(first)).not.toContain("hidden@example.com");
    const second = await page({ limit: 4, cursor: first?.next });
    expect(second?.rows.map((r) => r.sha)).toEqual(["e5", "f6"]);
    expect(second?.next).toBeNull();
    expect(second?.total).toBeNull();
  });

  test("every word must be in the subject or the name or login of who made it, in any case", async () => {
    expect(await shas({ q: "FIX" })).toEqual(["b2", "e5", "f6"]);
    expect(await shas({ q: "alice fix" })).toEqual(["f6"]);
    expect(await shas({ q: "bob" })).toEqual(["b2", "e5"]);
    expect(await shas({ q: "hidden@example" })).toEqual([]);
    expect(await shas({ q: "100%" })).toEqual(["b2"]);
    expect(await shas({ q: "_x" })).toEqual(["c3"]);
    expect(await shas({ q: "%" })).toEqual(["b2"]);
    expect((await page({ q: "fix" }))?.total).toBe(3);
  });

  test("person, kind and time narrow it", async () => {
    expect(await shas({ person: 7 })).toEqual(["a1", "c3", "f6"]);
    expect(await shas({ person: UNKNOWN_PERSON })).toEqual(["d4"]);
    expect(await shas({ kind: 1, person: 8 })).toEqual(["b2", "e5"]);
    expect(await shas({ from: 200, to: 400 })).toEqual(["c3", "d4", "e5"]);
  });

  test("a Report stored before commits were rows has none", async () => {
    expect(await commitPage(db, storage, { repoId: "acme/rocket", reportKey: "reports/gh/acme/rocket/old" })).toBeNull();
  });

  test("a newer Report's rows replace the older's, and go with the repository", async () => {
    const next = "reports/gh/acme/rocket/b2";
    await storeCommits(db, storage, "acme/rocket", next, gzipSync(JSON.stringify(list)));
    await storeCommits(db, storage, "acme/rocket", next, gzipSync(JSON.stringify(list)));
    expect(storage.objects.has(commitsMetaKey(next))).toBe(true);
    await dropCommits(db, "acme/rocket", next);
    const left = await db.select({ key: schema.commits.reportKey, n: count() }).from(schema.commits).groupBy(schema.commits.reportKey);
    expect(left).toEqual([{ key: next, n: 6 }]);
    await db.update(schema.repositories).set({ reportKey: next }).where(eq(schema.repositories.id, "acme/rocket"));
    const moved = await settleRepository(db, storage, { githubId: 1, owner: "acme", name: "rocket-2" });
    expect(moved.reportKey).toBe(next);
    expect((await db.select({ n: count() }).from(schema.commits).where(eq(schema.commits.repoId, "acme/rocket-2")))[0]?.n).toBe(6);
    await removeReports(db, storage, [moved]);
    expect((await db.select({ n: count() }).from(schema.commits))[0]?.n).toBe(0);
  });
});
