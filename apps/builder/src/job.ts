import { eq } from "drizzle-orm";
import {
  installationToken,
  now,
  PRIORITY,
  reportPrefix,
  schema,
  storeReport,
  type Db,
  type GitHubApp,
  type BuildJob,
  type Storage,
  type SurvivalJob,
} from "@commitscape/server";
import type { Config } from "./config";
import type { GitHubApi } from "./github";
import { peopleOf, resolveLogins } from "./people";
import { build, BUILD_ATTEMPTS, type Deps } from "./run";

const { builds, repoPeople, repositories, surviving } = schema;

export const SEED_COUNTED = 30;
const COUNTED_AT_ONCE = 10;

export type JobContext = {
  db: Db;
  storage: Storage;
  cfg: Config;
  app: GitHubApp | null;
  run: Deps["run"];
  github: GitHubApi;
  log: (line: string) => void;
  queuePulls?: (repoId: string) => Promise<void>;
  queueCounts?: (job: SurvivalJob) => Promise<void>;
  queueBuild?: (job: BuildJob & { attempt: number }, priority: number) => Promise<void>;
};

/** Runs one queued Build: reads the repository, stores its Report in R2 and its people in Postgres, and records how it ended; one past its time limit is queued again to go on from the lines it counted. */
export async function runJob(buildId: string, ctx: JobContext, attempt = 1): Promise<void> {
  const { db, storage, log } = ctx;
  const [found] = await db
    .select({ build: builds, repo: repositories })
    .from(builds)
    .innerJoin(repositories, eq(repositories.id, builds.repoId))
    .where(eq(builds.id, buildId));
  if (!found || found.build.state !== "queued") return;
  const { repo } = found;
  const fail = (reason: string, detail?: string) =>
    db.update(builds).set({ state: "failed", step: null, reason, detail, finishedAt: now() }).where(eq(builds.id, buildId));

  let token: string | null = null;
  if (repo.isPrivate) {
    token = repo.installationId && ctx.app ? await installationToken(ctx.app, repo.installationId, repo.name) : null;
    if (!token) {
      await fail("private", "no installation token");
      return;
    }
  }
  await db.update(builds).set({ state: "running", step: "reading", startedAt: now() }).where(eq(builds.id, buildId));
  const started = Date.now();
  const outcome = await build(
    { id: buildId, owner: repo.owner, name: repo.name, sizeKb: repo.sizeKb ?? 0, private: repo.isPrivate, token, seed: repo.seed, attempt },
    ctx.cfg,
    {
      run: ctx.run,
      progress: async (step) => {
        await db.update(builds).set({ step }).where(eq(builds.id, buildId));
      },
    },
  );
  log(`build ${buildId} ${repo.id}: ${outcome.ok ? "done" : outcome.reason} in ${((Date.now() - started) / 1000).toFixed(1)} s, attempt ${attempt}`);
  if (!outcome.ok && outcome.reason === "timed_out" && attempt < BUILD_ATTEMPTS && ctx.queueBuild) {
    await db.update(builds).set({ state: "queued", step: null, startedAt: null, requestedAt: now() }).where(eq(builds.id, buildId));
    const queued = await ctx
      .queueBuild({ buildId, attempt: attempt + 1 }, repo.seed ? PRIORITY.seed : PRIORITY.person)
      .then(() => true)
      .catch((e: unknown) => {
        log(`build ${buildId} not queued again: ${(e as Error).message}`);
        return false;
      });
    if (!queued) await fail(outcome.reason, outcome.detail);
    return;
  }
  if (!outcome.ok) {
    await fail(outcome.reason, outcome.detail);
    return;
  }

  const prefix = reportPrefix(repo.id, buildId);
  const { index, bytes } = await storeReport(storage, prefix, outcome.report);
  const stats = outcome.stats ?? index.stats;
  const [updated] = await db
    .update(repositories)
    .set({
      reportKey: prefix,
      reportAt: now(),
      reportBytes: bytes,
      reportLines: true,
      ...(stats
        ? {
            busFactor: stats.bus_factor,
            maintainers: stats.maintainers,
            commits30d: stats.commits_30d,
            people30d: stats.people_30d,
            codeLines: stats.code_lines,
            untouched5y: stats.untouched_5y,
            ...(stats.answered !== undefined ? { answered: stats.answered, answerHours: stats.answer_hours ?? null } : {}),
          }
        : {}),
    })
    .where(eq(repositories.id, repo.id))
    .returning({ id: repositories.id });
  if (!updated) {
    await storage.deletePrefix(`${prefix}/`);
    return;
  }
  const people = await storePeople(ctx, repo.id, repo.owner, repo.name, prefix, outcome.report, token);
  await db
    .update(builds)
    .set({ state: "done", step: null, finishedAt: now(), seconds: Math.round(outcome.seconds), partial: false })
    .where(eq(builds.id, buildId));
  if (repo.reportKey && repo.reportKey !== prefix) await storage.deletePrefix(`${repo.reportKey}/`);
  await ctx.queuePulls?.(repo.id).catch((e: unknown) => log(`pulls for ${repo.id} not queued: ${(e as Error).message}`));
  if (repo.seed) await queueSeedCounts(ctx, repo.id, prefix, people).catch((e: unknown) => log(`counts for ${repo.id} not queued: ${(e as Error).message}`));
}

async function queueSeedCounts(ctx: JobContext, repoId: string, reportKey: string, people: { personId: number; login: string | null; commits: number }[]): Promise<void> {
  if (!ctx.queueCounts) return;
  const ids = people
    .filter((p) => p.login && !p.login.endsWith("[bot]"))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, SEED_COUNTED)
    .map((p) => p.personId);
  if (ids.length === 0) return;
  await ctx.db.insert(surviving).values(ids.map((personId) => ({ repoId, reportKey, personId, status: "queued", askedAt: now() }))).onConflictDoNothing();
  for (let i = 0; i < ids.length; i += COUNTED_AT_ONCE) await ctx.queueCounts({ repoId, reportKey, personIds: ids.slice(i, i + COUNTED_AT_ONCE) });
}

async function storePeople(ctx: JobContext, repoId: string, owner: string, name: string, reportKey: string, report: Uint8Array, token: string | null) {
  const { people, newest } = peopleOf(report);
  let found = new Map<number, string>();
  try {
    found = (await resolveLogins({ ...ctx.github, token: token ?? ctx.github.token }, owner, name, people, newest)).found;
  } catch (e) {
    ctx.log(`logins for ${repoId}: ${(e as Error).message}`);
  }
  const rows = people.map((p) => ({ ...p, login: p.login ?? found.get(p.personId) ?? null, repoId, reportKey }));
  await ctx.db.transaction(async (tx) => {
    await tx.delete(repoPeople).where(eq(repoPeople.repoId, repoId));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(repoPeople).values(rows.slice(i, i + 1000));
  });
  return rows;
}
