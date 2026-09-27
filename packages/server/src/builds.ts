import { and, count, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { builds, repositories } from "./db/schema";
import type { Queue } from "./queue";
import { randomId } from "./random";
import { now } from "./time";

export const BUILD_LOST_AFTER = 30 * 60;
export const RETRY_AFTER = 3600;
export const REPORT_FOR = 24 * 3600;

type BuildState = Pick<typeof builds.$inferSelect, "state" | "reason" | "requestedAt" | "finishedAt">;

/** Whether a Build is still running, or failed too recently to try again. */
export function busy(build: BuildState | undefined | null, at = now()): boolean {
  if (!build) return false;
  if (build.state === "queued" || build.state === "running") return build.requestedAt > at - BUILD_LOST_AFTER;
  if (build.state === "failed") return build.reason !== "paused" && (build.finishedAt ?? build.requestedAt) > at - RETRY_AFTER;
  return false;
}

/** How many people's Builds are queued or running. */
export async function waitingBuilds(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(builds)
    .innerJoin(repositories, eq(repositories.id, builds.repoId))
    .where(and(inArray(builds.state, ["queued", "running"]), gt(builds.requestedAt, now() - BUILD_LOST_AFTER), eq(repositories.seed, false)));
  return row?.n ?? 0;
}

/** Records a queued Build and sends it to the queue; a failed send marks it paused. */
export async function queueBuild(db: Db, queue: Queue, repoId: string, priority: number): Promise<string> {
  const id = randomId();
  await db.insert(builds).values({ id, repoId, state: "queued", requestedAt: now() });
  try {
    await queue.send({ buildId: id }, priority);
  } catch (e) {
    await db.update(builds).set({ state: "failed", reason: "paused", detail: String(e), finishedAt: now() }).where(eq(builds.id, id));
  }
  return id;
}
