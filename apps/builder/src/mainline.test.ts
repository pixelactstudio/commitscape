import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { MAINLINE, schema, type Db } from "@commitscape/server";
import { repo } from "./gitdata/fixture";
import { mainlineOf, markMainline } from "./mainline";

const { indexCommits, repositories, storedIndexes } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));
const { reachable, firstParent } = MAINLINE;

const of = (m: ReturnType<typeof mainlineOf>) => Object.fromEntries(m.shas.map((s, i) => [s, [m.bits[i], m.arrival[i]]]));

test("a merge brings in what its other parents reach, at the merge's time; the first-parent line arrives by itself", () => {
  const revList = ["50 m3 m2 f2", "40 f2 f1", "30 m2 m1", "20 f1 m1", "10 m1"].join("\n");
  expect(of(mainlineOf(revList, "m3"))).toEqual({
    m3: [reachable | firstParent, 50],
    m2: [reachable | firstParent, 30],
    m1: [reachable | firstParent, 10],
    f2: [reachable, 50],
    f1: [reachable, 50],
  });
});

test("a branch merged twice arrives with the first merge, and its later work with the second", () => {
  const revList = ["90 m5 m4 b3", "80 b3 b2", "70 m4 m3", "60 m3 m2 b2", "50 b2 b1", "40 m2 m1", "30 b1 m1", "10 m1"].join("\n");
  const m = of(mainlineOf(revList, "m5"));
  expect([m.b1, m.b2, m.b3]).toEqual([
    [reachable, 60],
    [reachable, 60],
    [reachable, 90],
  ]);
  expect(m.m3).toEqual([reachable | firstParent, 60]);
});

test("a Build marks the Stored Index's commits from its clone: what reached the default branch and when, and what never did", async () => {
  const r = repo();
  const m0 = r.commit({ "a.ts": "1\n" }, "m0", "Ada", 0);
  r.sh(r.origin, "checkout", "-q", "-b", "feat");
  const f1 = r.commit({ "b.ts": "1\n" }, "f1", "Bob", 1);
  r.sh(r.origin, "checkout", "-q", "main");
  const m1 = r.commit({ "c.ts": "1\n" }, "m1", "Ada", 2);
  r.sh(r.origin, "merge", "-q", "--no-ff", "-m", "merge feat", "feat");
  const merge = r.sh(r.origin, "rev-parse", "HEAD").trim();
  r.sh(r.origin, "tag", "-a", "v1.0", "-m", "one", merge);
  r.sh(r.origin, "checkout", "-q", "-b", "wip");
  const w1 = r.commit({ "d.ts": "1\n" }, "w1", "Cy", 4);
  r.sh(r.origin, "checkout", "-q", "main");
  r.sync();
  const mergedAt = Number(r.sh(r.clone, "log", "-1", "--format=%ct", merge).trim());

  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  await db.insert(repositories).values({ id: "acme/rocket", owner: "acme", name: "rocket" });
  const [row] = await db
    .insert(storedIndexes)
    .values({ repoId: "acme/rocket", lineage: "1", kept: true, state: "live", lines: true, builtAt: 1, head: merge, snapshot: { commits: 5, merges: 1, oldest: 0, newest: 0, languages: [], code_age: [], suspects: [], releases: [["v1.0", mergedAt]] } })
    .returning({ id: storedIndexes.id });
  const si = row?.id ?? 0;
  await db.insert(indexCommits).values(
    [m0, f1, m1, merge, w1].map((sha, i) => ({ si, sha: Buffer.from(sha, "hex"), at: i, offset: 0, authorDelta: 0, signature: 0, kind: 10, flags: sha === merge ? 1 : 0, subject: "", files: [], changes: [] })),
  );

  const marked = await markMainline(db, r.git, si);
  expect(marked).toMatchObject({ commits: 4, firstParent: 3, changed: 4, releases: 1 });
  const rows = await db.select({ sha: sql<string>`encode(${indexCommits.sha}, 'hex')`, flags: indexCommits.flags, arrival: indexCommits.arrival }).from(indexCommits).where(eq(indexCommits.si, si));
  const by = Object.fromEntries(rows.map((x) => [x.sha, [x.flags, x.arrival]]));
  expect(by[m0]).toEqual([reachable | firstParent, r.at(0)]);
  expect(by[f1]).toEqual([reachable, mergedAt]);
  expect(by[m1]).toEqual([reachable | firstParent, r.at(2)]);
  expect(by[merge]).toEqual([1 | reachable | firstParent, mergedAt]);
  expect(by[w1]).toEqual([0, null]);
  const [index] = await db.select({ snapshot: storedIndexes.snapshot }).from(storedIndexes).where(eq(storedIndexes.id, si));
  expect(index?.snapshot?.release_shas).toEqual({ "v1.0": merge });
});
