import { and, eq, inArray } from "drizzle-orm";
import { installationToken, now, schema, type SurvivalJob } from "@commitscape/server";
import type { JobContext } from "./job";
import { existsSync } from "node:fs";
import { cacheRoot, clonePath, gitEnv, NAME } from "./run";

const { repositories, surviving } = schema;

type Counted = { id: number; status: "counted" | "over_budget" | "unknown_person"; surviving: number | null; added: number | null; files: number; seconds: number; oldest?: number | null };

/** Parses what `commitscape surviving` printed. */
export function survivingOf(stdout: string): { head: string; people: Counted[] } | null {
  try {
    const answer = JSON.parse(stdout) as { head?: unknown; people?: unknown };
    if (typeof answer.head !== "string" || !Array.isArray(answer.people)) return null;
    return { head: answer.head, people: answer.people as Counted[] };
  } catch {
    return null;
  }
}

/** Counts people's Surviving Lines in one repository at its stored Report's head, and records each answer. */
export async function runSurvival(job: SurvivalJob, ctx: JobContext & { budget: number }): Promise<void> {
  const { db, cfg } = ctx;
  const mark = (status: string, ids: number[]) =>
    db
      .update(surviving)
      .set({ status, countedAt: now() })
      .where(and(eq(surviving.repoId, job.repoId), eq(surviving.reportKey, job.reportKey), inArray(surviving.personId, ids)));
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, job.repoId));
  if (!repo || repo.reportKey !== job.reportKey || !NAME.test(repo.owner) || !NAME.test(repo.name)) {
    await mark("stale", job.personIds);
    return;
  }
  if (!repo.reportLines) {
    await mark("not_counted", job.personIds);
    return;
  }
  let token: string | null = null;
  if (repo.isPrivate) {
    token = repo.installationId && ctx.app ? await installationToken(ctx.app, repo.installationId, repo.name) : null;
    if (!token) {
      await mark("failed", job.personIds);
      return;
    }
  }
  const req = { id: job.repoId, owner: repo.owner, name: repo.name, sizeKb: repo.sizeKb ?? 0, private: repo.isPrivate, token, seed: repo.seed };
  const args = ["surviving", "--budget-seconds", String(ctx.budget), "--cache-dir", cacheRoot(cfg, req), "--offline"];
  for (const id of job.personIds) args.push("--person", String(id));
  const clone = clonePath(cfg, req, false);
  args.push("--", existsSync(clone) ? clone : `${repo.owner}/${repo.name}`);
  const started = Date.now();
  const ran = await ctx.run(cfg.bin, args, gitEnv(cfg, token), (ctx.budget + 120) * 1000);
  const answer = ran.code === 0 ? survivingOf(ran.stdout ?? "") : null;
  ctx.log(`surviving ${job.repoId} [${job.personIds.join(",")}]: ${answer ? "done" : ran.timedOut ? "timed out" : "failed"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (!answer) {
    await mark(ran.timedOut ? "over_budget" : "failed", job.personIds);
    return;
  }
  for (const p of answer.people) {
    const status = p.status === "unknown_person" ? "failed" : p.status;
    await db
      .update(surviving)
      .set({ status, lines: p.surviving, added: p.added, files: p.files, seconds: p.seconds, head: answer.head, oldest: p.oldest ?? null, countedAt: now() })
      .where(and(eq(surviving.repoId, job.repoId), eq(surviving.reportKey, job.reportKey), eq(surviving.personId, p.id)));
  }
}
