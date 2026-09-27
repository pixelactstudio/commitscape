import { eq } from "drizzle-orm";
import {
  installationToken,
  now,
  reportPrefix,
  schema,
  storeReport,
  type Db,
  type GitHubApp,
  type Storage,
} from "@commitscape/server";
import type { Config } from "./config";
import { build, type Deps } from "./run";

const { builds, repositories } = schema;

export type JobContext = {
  db: Db;
  storage: Storage;
  cfg: Config;
  app: GitHubApp | null;
  run: Deps["run"];
  png: Deps["png"];
  log: (line: string) => void;
};

/** Runs one queued Build: reads the repository, stores its Report and card in R2, and records how it ended. */
export async function runJob(buildId: string, ctx: JobContext): Promise<void> {
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
    { id: buildId, owner: repo.owner, name: repo.name, sizeKb: repo.sizeKb ?? 0, private: repo.isPrivate, token, seed: repo.seed },
    ctx.cfg,
    {
      run: ctx.run,
      png: ctx.png,
      progress: async (step) => {
        await db.update(builds).set({ step }).where(eq(builds.id, buildId));
      },
    },
  );
  log(`build ${buildId} ${repo.id}: ${outcome.ok ? "done" : outcome.reason} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (!outcome.ok) {
    await fail(outcome.reason, outcome.detail);
    return;
  }

  const prefix = reportPrefix(repo.id, buildId);
  const { index, bytes } = await storeReport(storage, prefix, outcome.report);
  const extension = outcome.card?.type === "image/png" ? "png" : "svg";
  const card = outcome.card ? `cards/gh/${repo.id}/${buildId}.${extension}` : null;
  if (outcome.card && card) await storage.put(card, outcome.card.bytes, { type: outcome.card.type });
  const stats = outcome.stats ?? index.stats;
  const [updated] = await db
    .update(repositories)
    .set({
      reportKey: prefix,
      reportAt: now(),
      reportBytes: bytes,
      reportLines: outcome.lines,
      cardKey: card ?? repo.cardKey,
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
    if (card) await storage.delete([card]);
    return;
  }
  await db
    .update(builds)
    .set({ state: "done", step: null, finishedAt: now(), seconds: Math.round(outcome.seconds), partial: outcome.partial })
    .where(eq(builds.id, buildId));
  if (repo.reportKey && repo.reportKey !== prefix) await storage.deletePrefix(`${repo.reportKey}/`);
  if (repo.cardKey && card && repo.cardKey !== card) await storage.delete([repo.cardKey]);
}
