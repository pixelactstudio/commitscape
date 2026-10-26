import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { now, PRIORITY, schema, type BuildJob, type Db } from "@commitscape/server";
import { queueRebuilds } from "./rebuild";

const { builds, repositories, storedIndexes } = schema;
const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: migrations });
  return db;
}

async function indexed(db: Db, id: string, pack: string | null, extra: Partial<typeof repositories.$inferInsert> = {}): Promise<void> {
  const [owner = "", name = ""] = id.split("/");
  await db.insert(repositories).values({ id, owner, name, status: "ok", ...extra });
  const [si] = await db.insert(storedIndexes).values({ repoId: id, lineage: "1", kept: true, state: "live", lines: true, builtAt: now(), pack }).returning({ id: storedIndexes.id });
  await db.update(repositories).set({ indexId: si?.id ?? null }).where(eq(repositories.id, id));
}

test("every repository whose live Stored Index has no pack gets a Build at the lowest priority, once", async () => {
  const db = await testDb();
  await indexed(db, "acme/old", null);
  await indexed(db, "acme/new", "packs/acme/new/1/a-b-lines.pack");
  await indexed(db, "acme/gone", null, { status: "not_found" });
  await indexed(db, "acme/mine", null, { status: "private", isPrivate: true, installationId: 5 });
  await indexed(db, "acme/busy", null);
  await db.insert(builds).values({ id: "b-busy", repoId: "acme/busy", state: "queued", requestedAt: now() });
  await db.insert(repositories).values({ id: "acme/never", owner: "acme", name: "never", status: "ok" });
  const sent: [BuildJob, number][] = [];
  const queue = { send: async (job: BuildJob, priority: number) => void sent.push([job, priority]) };
  expect(await queueRebuilds(db, queue)).toEqual({ queued: 2, repos: ["acme/mine", "acme/old"] });
  expect(sent.map(([job, priority]) => [job.repoId, priority])).toEqual([
    ["acme/mine", PRIORITY.rebuild],
    ["acme/old", PRIORITY.rebuild],
  ]);
  const queued = (await db.select().from(builds)).filter((b) => b.state === "queued").map((b) => b.repoId);
  expect(queued.sort()).toEqual(["acme/busy", "acme/mine", "acme/old"]);
  expect(await queueRebuilds(db, queue)).toEqual({ queued: 0, repos: [] });
});
