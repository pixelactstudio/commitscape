import { and, eq, inArray } from "drizzle-orm";
import { installationToken, now, schema, type SurvivalJob } from "@commitscape/server";
import type { JobContext } from "./job";
import { existsSync } from "node:fs";
import { cacheRoot, clonePath, gitEnv, NAME } from "./run";

const { repositories, surviving } = schema;

export const SURVIVING_BUDGET_MAX = 4 * 3600;

/** How long each person may take in one count of Surviving Lines: the budget, doubled for each attempt after the first, up to four hours. */
export function budgetOf(base: number, attempt = 0): number {
  return Math.min(base * 2 ** Math.max(attempt, 0), Math.max(base, SURVIVING_BUDGET_MAX));
}

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

/** Counts people's Surviving Lines in one repository at its stored Report's head and records each answer; anyone over budget is queued again with a larger one, going on from the files already counted. */
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
  let token: string | null = null;
  if (repo.isPrivate) {
    token = repo.installationId && ctx.app ? await installationToken(ctx.app, repo.installationId, repo.name) : null;
    if (!token) {
      await mark("failed", job.personIds);
      return;
    }
  }
  const req = { id: job.repoId, owner: repo.owner, name: repo.name, sizeKb: repo.sizeKb ?? 0, private: repo.isPrivate, token, seed: repo.seed };
  const attempt = job.attempt ?? 0;
  const budget = budgetOf(ctx.budget, attempt);
  const args = ["surviving", "--budget-seconds", String(budget), "--cache-dir", cacheRoot(cfg, req), "--offline"];
  for (const id of job.personIds) args.push("--person", String(id));
  const clone = clonePath(cfg, req);
  args.push("--", existsSync(clone) ? clone : `${repo.owner}/${repo.name}`);
  const started = Date.now();
  const ran = await ctx.run(cfg.bin, args, gitEnv(cfg, token), (budget * job.personIds.length + cfg.timeLimit) * 1000);
  const answer = ran.code === 0 ? survivingOf(ran.stdout ?? "") : null;
  ctx.log(`surviving ${job.repoId} [${job.personIds.join(",")}]: ${answer ? "done" : ran.timedOut ? "timed out" : "failed"} in ${((Date.now() - started) / 1000).toFixed(1)} s, budget ${budget} s`);
  const again = async (ids: number[]) => {
    if (ids.length === 0 || budget >= budgetOf(ctx.budget, attempt + 1) || !ctx.queueCounts) return;
    for (const id of ids) {
      const row = and(eq(surviving.repoId, job.repoId), eq(surviving.reportKey, job.reportKey), eq(surviving.personId, id));
      await db.update(surviving).set({ status: "queued", askedAt: now() }).where(row);
      await ctx.queueCounts({ repoId: job.repoId, reportKey: job.reportKey, personIds: [id], attempt: attempt + 1 }).catch(async (e: unknown) => {
        ctx.log(`surviving ${job.repoId} [${id}] not queued again: ${(e as Error).message}`);
        await db.update(surviving).set({ status: "over_budget" }).where(row);
      });
    }
  };
  if (!answer) {
    await mark(ran.timedOut ? "over_budget" : "failed", job.personIds);
    if (ran.timedOut) await again(job.personIds);
    return;
  }
  for (const p of answer.people) {
    const status = p.status === "unknown_person" ? "failed" : p.status;
    await db
      .update(surviving)
      .set({ status, lines: p.surviving, added: p.added, files: p.files, seconds: p.seconds, head: answer.head, oldest: p.oldest ?? null, countedAt: now() })
      .where(and(eq(surviving.repoId, job.repoId), eq(surviving.reportKey, job.reportKey), eq(surviving.personId, p.id)));
  }
  await again(answer.people.filter((p) => p.status === "over_budget").map((p) => p.id));
}
