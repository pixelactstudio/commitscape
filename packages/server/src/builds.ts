import { and, count, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { builds, repositories } from "./db/schema";
import { LONGEST_JOB_SECONDS, PRIORITY, type Queue } from "./queue";
import { randomId } from "./random";
import { now } from "./time";

export const BUILD_LOST_AFTER = 30 * 60;
export const RETRY_AFTER = 3600;
export const REPORT_FOR = 24 * 3600;
export const RESEND_AFTER = 120;

type BuildState = Pick<typeof builds.$inferSelect, "state" | "reason" | "requestedAt" | "finishedAt"> & { startedAt?: number | null };

/** Whether a Build is still running, or ended too recently to try again: failed, or done with only part of its Report. */
export function busy(build: BuildState | undefined | null, at = now()): boolean {
  if (!build) return false;
  if (build.state === "running") return (build.startedAt ?? build.requestedAt) > at - LONGEST_JOB_SECONDS;
  if (build.state === "queued") return build.requestedAt > at - BUILD_LOST_AFTER;
  if (build.state === "failed") return build.reason !== "paused" && (build.finishedAt ?? build.requestedAt) > at - RETRY_AFTER;
  if (build.state === "done") return !!build.reason && (build.finishedAt ?? build.requestedAt) > at - RETRY_AFTER;
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
    await queue.send({ buildId: id, repoId }, priority);
  } catch (e) {
    await db.update(builds).set({ state: "failed", reason: "paused", detail: String(e), finishedAt: now() }).where(eq(builds.id, id));
  }
  return id;
}

/** Ends every running Build whose queued job is no longer active, which a Builder that stopped mid-Build leaves behind, and sends again every queued Build whose job was lost. */
export async function reapBuilds(db: Db, jobStates: (buildId: string) => Promise<string[]>, queue: Queue, at = now()): Promise<{ failed: number; resent: number }> {
  const open = await db
    .select({ id: builds.id, repoId: builds.repoId, state: builds.state, requestedAt: builds.requestedAt, startedAt: builds.startedAt, seed: repositories.seed })
    .from(builds)
    .innerJoin(repositories, eq(repositories.id, builds.repoId))
    .where(inArray(builds.state, ["queued", "running"]));
  let failed = 0;
  let resent = 0;
  for (const b of open) {
    if (b.state === "queued" && b.requestedAt > at - RESEND_AFTER) continue;
    const states = await jobStates(b.id);
    if (b.state === "running") {
      const old = (b.startedAt ?? b.requestedAt) < at - LONGEST_JOB_SECONDS;
      if (!old && states.includes("active")) continue;
      const ended = await db
        .update(builds)
        .set({ state: "failed", step: null, reason: "error", detail: "the Builder stopped while it ran", finishedAt: at })
        .where(and(eq(builds.id, b.id), eq(builds.state, "running")))
        .returning({ id: builds.id });
      failed += ended.length;
    } else if (b.requestedAt < at - LONGEST_JOB_SECONDS) {
      const ended = await db
        .update(builds)
        .set({ state: "failed", reason: "paused", detail: "it waited a day in the queue", finishedAt: at })
        .where(and(eq(builds.id, b.id), eq(builds.state, "queued")))
        .returning({ id: builds.id });
      failed += ended.length;
    } else if (!states.some((s) => s === "created" || s === "retry" || s === "active")) {
      await queue.send({ buildId: b.id, repoId: b.repoId }, b.seed ? PRIORITY.seed : PRIORITY.person);
      resent++;
    }
  }
  return { failed, resent };
}
