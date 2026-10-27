import { and, count, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { builds, repositories } from "./db/schema";
import { LONGEST_JOB_SECONDS, PRIORITY, type BuildJob, type Queue } from "./queue";
import { randomId } from "./random";
import type { LiveIndex } from "./stored-index";
import { now } from "./time";

export const BUILD_LOST_AFTER = 30 * 60;
export const RETRY_AFTER = 3600;
export const REPORT_FOR = 24 * 3600;
export const RESEND_AFTER = 120;
export const UNCHANGED_FOR = 7 * 24 * 3600;

/** What a Build of this release makes beside a Stored Index, recorded on it when its pack is published: format 3 packs, the head's standard screens stored with the Report, the Builder's Atlas and everyone's Ownership of lines. A Stored Index made otherwise is built again. */
export const BUILD_FORMAT = 2;

type Reported = Pick<typeof repositories.$inferSelect, "reportKey" | "reportAt" | "reportLines"> & { checkedAt?: number | null };

/** When a repository's Report was last known current: built, or found with its head where the Build left it. */
export function currentAt(row: Reported): number {
  return Math.max(row.reportAt ?? 0, row.checkedAt ?? 0);
}

type Whole = Pick<LiveIndex, "pack" | "lines" | "linesLeft" | "head" | "buildFormat">;

/** Whether a repository's Report is whole: published with every Mainline line counted and none left to count, from a Stored Index with a pack made by a Build of this release (BUILD_FORMAT), and built less than UNCHANGED_FOR ago, so the time Windows have not drifted further than that. Only a whole Report is kept when its head has not moved. */
export function whole(row: Reported, live: Whole | null, at = now()): boolean {
  return !!row.reportKey && row.reportLines === true && (row.reportAt ?? 0) > at - UNCHANGED_FOR && !!live?.pack && live.buildFormat === BUILD_FORMAT && live.lines && (live.linesLeft ?? 0) === 0 && !!live.head;
}

/** Whether a Build has nothing to do: the Report is whole and the default branch's head is still the one it was built from. */
export function unchanged(row: Reported, live: Whole | null, head: string | null, at = now()): boolean {
  return !!head && whole(row, live, at) && live?.head === head;
}

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

/** Records a queued Build and sends it to the queue, with who asked for it when known; a failed send marks it paused. */
export async function queueBuild(db: Db, queue: Queue, repoId: string, priority: number, extra: Pick<BuildJob, "userId"> = {}): Promise<string> {
  const id = randomId();
  await db.insert(builds).values({ id, repoId, state: "queued", requestedAt: now() });
  try {
    await queue.send({ buildId: id, repoId, ...extra }, priority);
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
