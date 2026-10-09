import { and, eq } from "drizzle-orm";
import {
  dropCommits,
  installationToken,
  now,
  PRIORITY,
  reportPrefix,
  schema,
  storeCommits,
  storeReport,
  type BuildJob,
  type Db,
  type GitHubApp,
  type Storage,
  type SurvivalJob,
} from "@commitscape/server";
import type { BuildFailure } from "@commitscape/data";
import { accountsFor } from "./accounts";
import { issueAnswers, type Answers } from "./answers";
import type { Config } from "./config";
import type { GitHubApi } from "./github";
import { peopleOf, type RepoPerson } from "./people";
import { build, BUILD_ATTEMPTS, type Deps, type Made, type Phase } from "./run";

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

/** Runs one queued Build: claims it, publishes the quick Report without lines as soon as it is made and the full one after, and always leaves the Build ended or queued again; one past its time limit is queued again to go on from the lines it counted. */
export async function runJob(buildId: string, ctx: JobContext, attempt = 1): Promise<void> {
  const { db, log } = ctx;
  const [claimed] = await db
    .update(builds)
    .set({ state: "running", step: "cloning", startedAt: now(), reason: null, detail: null })
    .where(and(eq(builds.id, buildId), eq(builds.state, "queued")))
    .returning({ id: builds.id });
  if (!claimed) return;
  try {
    await claimedJob(buildId, ctx, attempt);
  } catch (e) {
    log(`build ${buildId}: ${(e as Error).message}`);
  } finally {
    await db
      .update(builds)
      .set({ state: "failed", step: null, reason: "error", detail: "the Build stopped unexpectedly", finishedAt: now() })
      .where(and(eq(builds.id, buildId), eq(builds.state, "running")))
      .catch((e: unknown) => log(`build ${buildId} not ended: ${(e as Error).message}`));
  }
}

async function claimedJob(buildId: string, ctx: JobContext, attempt: number): Promise<void> {
  const { db, log } = ctx;
  const [found] = await db
    .select({ repo: repositories })
    .from(builds)
    .innerJoin(repositories, eq(repositories.id, builds.repoId))
    .where(eq(builds.id, buildId));
  if (!found) return;
  const { repo } = found;
  const end = (state: "failed" | "done", set: { reason?: BuildFailure | null; detail?: string | null; seconds?: number; partial?: boolean }) =>
    db
      .update(builds)
      .set({ state, step: null, finishedAt: now(), reason: set.reason ?? null, detail: set.detail ?? null, ...(set.seconds !== undefined ? { seconds: Math.round(set.seconds) } : {}), ...(set.partial !== undefined ? { partial: set.partial } : {}) })
      .where(eq(builds.id, buildId));

  let token: string | null = null;
  if (repo.isPrivate) {
    token = repo.installationId && ctx.app ? await installationToken(ctx.app, repo.installationId, repo.name) : null;
    if (!token) {
      await end("failed", { reason: "private", detail: "no installation token" });
      return;
    }
  }
  const scope = repo.isPrivate ? repo.id : "public";
  const gh: GitHubApi = { ...ctx.github, token: token ?? ctx.github.token };
  let answers: Answers | null | undefined;
  const asked = repo.seed ? issueAnswers(db, gh, repo.owner, repo.name, scope).catch(() => null) : Promise.resolve(null);
  void asked.then((a) => {
    answers = a;
  });
  let pullsQueued = false;
  const started = Date.now();

  const publish = async (phase: Phase, made: Made): Promise<boolean> => {
    const target = await publishReport(ctx, buildId, phase, made, phase === "full" ? await asked : answers);
    if (!target) return false;
    if (phase === "quick") await db.update(builds).set({ partial: true }).where(eq(builds.id, buildId));
    if (!pullsQueued) {
      pullsQueued = true;
      await ctx.queuePulls?.(target.id).catch((e: unknown) => log(`pulls for ${target.id} not queued: ${(e as Error).message}`));
    }
    if (phase === "full" && repo.seed) await queueSeedCounts(ctx, target.id, target.prefix, target.people).catch((e: unknown) => log(`counts for ${target.id} not queued: ${(e as Error).message}`));
    log(`build ${buildId} ${target.id}: ${phase} Report published after ${((Date.now() - started) / 1000).toFixed(1)} s, made in ${made.seconds} s`);
    return true;
  };

  const outcome = await build(
    { id: buildId, owner: repo.owner, name: repo.name, sizeKb: repo.sizeKb ?? 0, private: repo.isPrivate, token, seed: repo.seed, attempt },
    ctx.cfg,
    {
      run: ctx.run,
      log,
      progress: async (step) => {
        await db
          .update(builds)
          .set({ step })
          .where(and(eq(builds.id, buildId), eq(builds.state, "running")));
      },
      accounts: async (signatures) => {
        const found = await accountsFor(db, gh, { owner: repo.owner, name: repo.name, scope }, signatures, ctx.cfg.logins);
        log(`build ${buildId}: logins for ${Object.keys(found.accounts).length} of ${signatures.length} emails, ${found.asked} asked`);
        return found.accounts;
      },
      publish,
    },
  );
  const why = outcome.failure;
  log(`build ${buildId} ${repo.id}: ${outcome.published ?? "nothing"} published${why ? `, ${why.reason}` : ""} in ${outcome.seconds} s, attempt ${attempt}`);
  if (why?.reason === "timed_out" && attempt < BUILD_ATTEMPTS && ctx.queueBuild) {
    await db.update(builds).set({ state: "queued", step: null, startedAt: null, requestedAt: now() }).where(eq(builds.id, buildId));
    const queued = await ctx
      .queueBuild({ buildId, repoId: repo.id, attempt: attempt + 1 }, repo.seed ? PRIORITY.seed : PRIORITY.person)
      .then(() => true)
      .catch((e: unknown) => {
        log(`build ${buildId} not queued again: ${(e as Error).message}`);
        return false;
      });
    if (queued) return;
  }
  if (outcome.published === "full") await end("done", { seconds: outcome.seconds, partial: false });
  else if (outcome.published === "quick") await end("done", { seconds: outcome.seconds, partial: true, reason: why?.reason ?? "error", detail: why?.detail ?? null });
  else await end("failed", { reason: why?.reason ?? "error", detail: why?.detail ?? null });
}

/** Stores a Report and its commits under the repository's current name, makes it the repository's Report with its people, and deletes the one it replaces; a quick Report never replaces one with lines. */
async function publishReport(ctx: JobContext, buildId: string, phase: Phase, made: Made, answers: Answers | null | undefined): Promise<{ id: string; prefix: string; people: RepoPerson[] } | null> {
  const { db, storage } = ctx;
  const [named] = await db
    .select({ id: repositories.id, reportKey: repositories.reportKey, reportLines: repositories.reportLines })
    .from(builds)
    .innerJoin(repositories, eq(repositories.id, builds.repoId))
    .where(eq(builds.id, buildId));
  if (!named) return null;
  if (phase === "quick" && named.reportKey && named.reportLines !== false) return null;
  const prefix = reportPrefix(named.id, phase === "full" ? buildId : `${buildId}-quick`);
  const stored = await (async () => {
    const written = await storeReport(storage, prefix, made.report);
    if (made.commits) await storeCommits(db, storage, named.id, prefix, made.commits);
    return written;
  })().catch(async (e: unknown) => {
    await dropCommits(db, named.id, named.reportKey ?? "").catch(() => undefined);
    await storage.deletePrefix(`${prefix}/`).catch(() => undefined);
    throw e;
  });
  const { index, bytes } = stored;
  const stats = made.stats ?? index.stats;
  const people = peopleOf(made.report);
  const target = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: repositories.id, reportKey: repositories.reportKey })
      .from(builds)
      .innerJoin(repositories, eq(repositories.id, builds.repoId))
      .where(eq(builds.id, buildId));
    if (!current) return null;
    await tx
      .update(repositories)
      .set({
        reportKey: prefix,
        reportAt: now(),
        reportBytes: bytes,
        reportLines: phase === "full",
        ...(stats
          ? {
              busFactor: stats.bus_factor,
              maintainers: stats.maintainers,
              commits30d: stats.commits_30d,
              people30d: stats.people_30d,
              codeLines: stats.code_lines,
              untouched5y: stats.untouched_5y,
            }
          : {}),
        ...(answers ? { answered: answers.answered, answerHours: answers.typical_hours } : {}),
      })
      .where(eq(repositories.id, current.id));
    const rows = people.map((p) => ({ ...p, repoId: current.id, reportKey: prefix }));
    await tx.delete(repoPeople).where(eq(repoPeople.repoId, current.id));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(repoPeople).values(rows.slice(i, i + 1000));
    return current;
  });
  if (!target) {
    await storage.deletePrefix(`${prefix}/`);
    return null;
  }
  await dropCommits(db, target.id, prefix);
  if (target.reportKey && target.reportKey !== prefix) await storage.deletePrefix(`${target.reportKey}/`);
  return { id: target.id, prefix, people };
}

async function queueSeedCounts(ctx: JobContext, repoId: string, reportKey: string, people: RepoPerson[]): Promise<void> {
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
