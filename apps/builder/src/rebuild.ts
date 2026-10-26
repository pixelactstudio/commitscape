import { and, eq, inArray, isNull, notExists, or, isNotNull } from "drizzle-orm";
import { PRIORITY, queueBuild, schema, type Db, type Queue } from "@commitscape/server";

const { builds, repositories, storedIndexes } = schema;

/** Queues a Build at the lowest priority for every repository whose live Stored Index has no pack, which the engine service needs to answer for it; not for one already queued or building. */
export async function queueRebuilds(db: Db, queue: Queue): Promise<{ queued: number; repos: string[] }> {
  const waiting = db
    .select({ id: builds.id })
    .from(builds)
    .where(and(eq(builds.repoId, repositories.id), inArray(builds.state, ["queued", "running"])));
  const rows = await db
    .select({ id: repositories.id })
    .from(repositories)
    .innerJoin(storedIndexes, and(eq(storedIndexes.id, repositories.indexId), eq(storedIndexes.state, "live")))
    .where(and(isNull(storedIndexes.pack), or(eq(repositories.status, "ok"), isNotNull(repositories.installationId)), notExists(waiting)))
    .orderBy(repositories.id);
  for (const r of rows) await queueBuild(db, queue, r.id, PRIORITY.rebuild);
  return { queued: rows.length, repos: rows.map((r) => r.id) };
}
