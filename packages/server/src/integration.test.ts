import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { busy, queueBuild, waitingBuilds } from "./builds";
import { cleanup } from "./cleanup";
import { createDb, runMigrations } from "./db/client";
import { builds, repoNames, repositories, shares } from "./db/schema";
import { BUILD_QUEUE, bossQueue, PRIORITY, startQueue, type BuildJob } from "./queue";
import { readEntry, readIndex, reportPrefix, storeReport } from "./reports";
import { settleRepository } from "./repos";
import { s3Storage } from "./storage";
import { now } from "./time";

const url = process.env.TEST_DATABASE_URL;
const s3 = process.env.TEST_S3_ENDPOINT;
const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));
const report = process.env.TEST_REPORT_FILE;

describe.skipIf(!url || !s3)("against Postgres and S3", async () => {
  if (!url || !s3) return;
  await runMigrations(url, migrations);
  const { db, pool } = createDb(url);
  const storage = s3Storage({ endpoint: s3, bucket: "commitscape-reports", accessKeyId: "commitscape", secretAccessKey: "commitscape", forcePathStyle: true });
  afterAll(() => pool.end());

  test("migrations apply twice", async () => {
    await runMigrations(url, migrations);
  });

  test("a queued Build reaches a worker, people's before seeds", async () => {
    const boss = await startQueue(url, { worker: true });
    await boss.deleteAllJobs(BUILD_QUEUE);
    const site = await startQueue(url, { worker: false });
    await db.insert(repositories).values({ id: "t/seed", owner: "t", name: "seed" }).onConflictDoNothing();
    await db.insert(repositories).values({ id: "t/person", owner: "t", name: "person" }).onConflictDoNothing();
    const seed = await queueBuild(db, bossQueue(site), "t/seed", PRIORITY.seed);
    const person = await queueBuild(db, bossQueue(site), "t/person", PRIORITY.person);
    expect(await waitingBuilds(db)).toBeGreaterThanOrEqual(2);
    const first = await boss.fetch<BuildJob>(BUILD_QUEUE, { batchSize: 1 });
    const second = await boss.fetch<BuildJob>(BUILD_QUEUE, { batchSize: 1 });
    expect([...first, ...second].map((j) => j.data.buildId)).toEqual([person, seed]);
    const [row] = await db.select().from(builds).where(eq(builds.id, person));
    expect(busy(row)).toBe(true);
    await site.stop();
    await boss.stop();
  });

  test("a renamed repository's rows become one in a transaction, its old name kept as a way to it", async () => {
    await db.delete(repositories).where(inArray(repositories.id, ["t/old-name", "t/new-name"]));
    await db.insert(repositories).values({ id: "t/old-name", owner: "t", name: "old-name", githubId: -42, reportKey: "reports/gh/t/old-name/b1", reportAt: now() });
    await db.insert(builds).values({ id: `t-${now()}`, repoId: "t/old-name", state: "done", requestedAt: now() });
    const row = await settleRepository(db, storage, { githubId: -42, owner: "t", name: "new-name" });
    expect(row).toMatchObject({ id: "t/new-name", reportKey: "reports/gh/t/old-name/b1" });
    expect(await db.select({ repoId: repoNames.repoId }).from(repoNames).where(eq(repoNames.id, "t/old-name"))).toEqual([{ repoId: "t/new-name" }]);
    expect((await db.select().from(builds).where(eq(builds.repoId, "t/new-name"))).length).toBeGreaterThan(0);
    await db.delete(repositories).where(eq(repositories.id, "t/new-name"));
  });

  test("cleanup removes what has expired", async () => {
    await db.insert(shares).values({ id: "gone", bytes: 30, createdAt: now() - 7200, expiresAt: now() - 60, deleteHash: "x", uploaded: true });
    await storage.put("shares/gone", "locked", { type: "application/octet-stream" });
    const swept = await cleanup(db, storage);
    expect(swept.shared).toBeGreaterThanOrEqual(1);
    expect(await storage.get("shares/gone")).toBeNull();
  });

  test.skipIf(!report)("a Report is stored one answer to an object", async () => {
    const prefix = reportPrefix("t/report", "b1");
    const { index, bytes } = await storeReport(storage, prefix, readFileSync(report ?? ""));
    expect(bytes).toBeGreaterThan(0);
    expect(index.keys).toContain("/api/overview?window=all");
    const again = await readIndex(storage, prefix);
    expect(again?.meta.name).toBe(index.meta.name);
    const overview = await readEntry<{ window: string }>(storage, prefix, "/api/overview?window=all");
    expect(overview?.window).toBe("all");
    await storage.deletePrefix(`${prefix}/`);
    expect(await readIndex(storage, reportPrefix("t/report", "b2"))).toBeNull();
  });
});
