import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { installationToken, now, randomId, schema, type SurvivalJob } from "@commitscape/server";
import { cloneUrl, ensureClone, gitEnv, locked } from "./clone";
import { accountsFor, writeAccounts } from "./accounts";
import { cacheFor, holding, privateDir, repoDir, scratchDir } from "./disk";
import { fetchBlobs, historyBlobs } from "./lean";
import type { JobContext } from "./job";
import { NAME, type Ran } from "./run";

const { repositories, surviving } = schema;

export const SURVIVING_BUDGET_MAX = 4 * 3600;

const EVERYONE_BYTES = 256 << 20;

/** How long each person may take in one count of Surviving Lines: the budget, doubled for each attempt after the first, up to four hours. */
export function budgetOf(base: number, attempt = 0): number {
  return Math.min(base * 2 ** Math.max(attempt, 0), Math.max(base, SURVIVING_BUDGET_MAX));
}

type Counted = { id: number; status: "counted" | "over_budget" | "unknown_person"; surviving: number | null; added: number | null; files: number; seconds: number; oldest?: number | null };

/** Parses what `commitscape surviving --everyone` printed: the head, whether its ownership is whole, and then every person's count. */
export function survivingOf(stdout: string): { head: string; complete: boolean; people: Counted[] } | null {
  try {
    const answer = JSON.parse(stdout) as { head?: unknown; complete?: unknown; people?: unknown };
    if (typeof answer.head !== "string" || typeof answer.complete !== "boolean" || !Array.isArray(answer.people)) return null;
    return { head: answer.head, complete: answer.complete, people: answer.people as Counted[] };
  } catch {
    return null;
  }
}

/** Counts everyone's Surviving Lines in one repository at its stored Report's head, from who owns each line, which the cache keeps from one head to the next so a new head works out only the files that changed, and records every person's answer, whoever asked. Ownership not worked out within the budget is kept, and the count is queued again with twice the budget to go on from it. */
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
  const attempt = job.attempt ?? 0;
  const budget = budgetOf(ctx.budget, attempt);
  const key = `surviving-${randomId()}`;
  const scratch = scratchDir(cfg, key);
  const home = repo.isPrivate ? privateDir(cfg, key) : repoDir(cfg, repo.owner, repo.name);
  const lean = join(home, "lean");
  const leaned = !repo.isPrivate && existsSync(join(lean, ".git"));
  const full = leaned ? lean : join(home, "full");
  const env = gitEnv(token);
  const started = Date.now();
  let ran: Ran;
  holding.add(key);
  try {
    if (leaned) await prefetch(ctx, repo.id, lean, env);
    const cloned = existsSync(join(full, ".git"))
      ? ({ ok: true } as const)
      : await locked(full, () => ensureClone(ctx.run, { url: cloneUrl(cfg, repo.owner, repo.name), dir: full, blobless: false, env, timeoutMs: cfg.cloneLimit * 1000 }));
    if (!cloned.ok) {
      ctx.log(`surviving ${job.repoId}: clone ${cloned.reason}`);
      await mark("failed", job.personIds);
      return;
    }
    await mkdir(scratch, { recursive: true });
    const gh = { ...ctx.github, token: token ?? ctx.github.token };
    const scope = repo.isPrivate ? repo.id : "public";
    const cache = ["--cache-dir", await cacheFor(cfg, { isPrivate: repo.isPrivate, owner: repo.owner, name: repo.name, home }), "--cache-key", repo.id];
    const engineEnv = { ...env, ...(cfg.threads ? { COMMITSCAPE_THREADS: String(cfg.threads) } : {}) };
    const accounts = await writeAccounts(ctx.run, { bin: cfg.bin, dir: full, scratch, cache, env: engineEnv, timeoutMs: cfg.timeLimit * 1000, nice: cfg.nice, log: ctx.log }, async (signatures) => (await accountsFor(db, gh, { owner: repo.owner, name: repo.name, scope }, signatures, cfg.logins)).accounts);
    const args = ["surviving", "--everyone", "--budget-seconds", String(budget), ...cache, "--offline"];
    if (accounts) args.push("--accounts", accounts);
    args.push("--", full);
    ran = await ctx.run(cfg.bin, args, engineEnv, (budget + cfg.timeLimit) * 1000, { nice: cfg.nice, maxStdout: EVERYONE_BYTES });
    if (!repo.isPrivate && ran.code === 0) await ctx.saveState?.(repo.id, cache[1] ?? "").catch((e: unknown) => ctx.log(`state of ${repo.id} not saved: ${(e as Error).message}`));
  } finally {
    await rm(scratch, { recursive: true, force: true });
    if (repo.isPrivate) await rm(home, { recursive: true, force: true });
    holding.delete(key);
  }
  const answer = ran.code === 0 ? survivingOf(ran.stdout ?? "") : null;
  ctx.log(`surviving ${job.repoId}: ${answer ? (answer.complete ? `${answer.people.length} people counted` : "ownership not whole yet") : ran.timedOut ? "timed out" : "failed"} in ${((Date.now() - started) / 1000).toFixed(1)} s, budget ${budget} s`);
  const again = async () => {
    if (budget >= budgetOf(ctx.budget, attempt + 1) || !ctx.queueCounts) {
      await mark("over_budget", job.personIds);
      return;
    }
    await ctx.queueCounts({ repoId: job.repoId, reportKey: job.reportKey, personIds: job.personIds, everyone: true, attempt: attempt + 1 }).catch(async (e: unknown) => {
      ctx.log(`surviving ${job.repoId} not queued again: ${(e as Error).message}`);
      await mark("over_budget", job.personIds);
    });
  };
  if (!answer) {
    if (ran.timedOut) await again();
    else await mark("failed", job.personIds);
    return;
  }
  if (!answer.complete) {
    await again();
    return;
  }
  const at = now();
  for (let i = 0; i < answer.people.length; i += 500) {
    const rows = answer.people.slice(i, i + 500).map((p) => ({ repoId: job.repoId, reportKey: job.reportKey, personId: p.id, status: "counted", lines: p.surviving, added: p.added, files: p.files, seconds: p.seconds, head: answer.head, oldest: p.oldest ?? null, askedAt: at, countedAt: at }));
    await db
      .insert(surviving)
      .values(rows)
      .onConflictDoUpdate({
        target: [surviving.repoId, surviving.reportKey, surviving.personId],
        set: { status: sql`excluded.status`, lines: sql`excluded.lines`, added: sql`excluded.added`, files: sql`excluded.files`, seconds: sql`excluded.seconds`, head: sql`excluded.head`, oldest: sql`excluded.oldest`, countedAt: sql`excluded.counted_at` },
      });
  }
  const counted = new Set(answer.people.map((p) => p.id));
  await mark("failed", job.personIds.filter((id) => !counted.has(id)));
}

async function prefetch(ctx: JobContext, repoId: string, dir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const [last] = await ctx.db
    .select({ head: surviving.head })
    .from(surviving)
    .where(and(eq(surviving.repoId, repoId), eq(surviving.status, "counted"), isNotNull(surviving.head)))
    .orderBy(desc(surviving.countedAt))
    .limit(1);
  if (!last?.head) return;
  const g = { dir, env, deadline: Date.now() + ctx.cfg.cloneLimit * 1000 };
  try {
    const wanted = await historyBlobs(g, last.head);
    await fetchBlobs(g, wanted);
    ctx.log(`surviving ${repoId}: ${wanted.length} file versions fetched into the blobless clone`);
  } catch (e) {
    ctx.log(`surviving ${repoId}: file versions not fetched ahead, so blame fetches them as it goes: ${(e as Error).message}`);
  }
}
