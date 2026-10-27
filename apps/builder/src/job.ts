import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import {
  besidePack,
  BUILD_FORMAT,
  type createDb,
  liveIndex,
  LOADED,
  loadExport,
  now,
  PRIORITY,
  randomId,
  reportPrefix,
  schema,
  packKey,
  screensKey,
  sha256,
  type BuildJob,
  type Db,
  type GitHubApp,
  type Loaded,
  type Storage,
  type SurvivalJob,
  refsUnchanged,
} from "@commitscape/server";
import type { BuildFailure, Meta } from "@commitscape/data";
import { accountsFor } from "./accounts";
import { replaceIndex } from "./atlas";
import { storeScreens } from "./screens";
import { cloneUrl, gitEnv, remoteRefs, type RemoteRefs } from "./clone";
import type { Config } from "./config";
import type { SummaryPerson } from "./engine";
import type { GitHubApi } from "./github";
import { buildGitData } from "./gitdata";
import { pullsToken } from "./pulls";
import { build, BUILD_ATTEMPTS, timeLimitOf, type Deps, type Made, type Outcome } from "./run";
import { Phases, type Telemetry } from "./telemetry";
import { restoreState, saveState, stateKeys } from "./state";
import { storeAtlas } from "./universe";

const { builds, repoPeople, repositories, storedIndexes, surviving } = schema;


export const MORE_LINES_MAX = 3;
export const MORE_LINES_AFTER = 60;

const HEAD_CHECK_MS = 30_000;

export type JobContext = {
  db: Db;
  pool?: ReturnType<typeof createDb>["pool"];
  loadIndex?: (repoId: string, dir: string) => Promise<Loaded>;
  storage: Storage;
  cfg: Config;
  app: GitHubApp | null;
  run: Deps["run"];
  github: GitHubApi;
  tokenSecret?: string;
  log: (line: string) => void;
  telemetry?: Telemetry;
  queuePulls?: (repoId: string) => Promise<void>;
  queueCounts?: (job: SurvivalJob) => Promise<void>;
  saveState?: (repoId: string, root: string) => Promise<unknown>;
  prefetch?: Deps["prefetch"];
  queueBuild?: (job: BuildJob & { attempt: number }, priority: number, startAfter?: number) => Promise<void>;
};

export type JobAsked = Pick<BuildJob, "userId" | "more">;

/** Runs one queued Build: claims it, publishes the Stored Index without lines as soon as it is loaded and with them after, and always leaves the Build ended or queued again. One past its time limit is queued again to go on from the lines it counted; one that left commits not counted queues a quiet Build to count them. */
export async function runJob(buildId: string, ctx: JobContext, attempt = 1, asked: JobAsked = {}): Promise<void> {
  const { db, log } = ctx;
  const [claimed] = await db
    .update(builds)
    .set({ state: "running", step: "cloning", startedAt: now(), reason: null, detail: null })
    .where(and(eq(builds.id, buildId), eq(builds.state, "queued")))
    .returning({ id: builds.id });
  if (!claimed) return;
  try {
    await claimedJob(buildId, ctx, attempt, asked);
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

const said = (phases: Phases) => Object.fromEntries(Object.entries(phases.seconds).map(([k, v]) => [`seconds_${k.replace(/ /g, "_")}`, v]));

async function claimedJob(buildId: string, ctx: JobContext, attempt: number, asked: JobAsked): Promise<void> {
  const { db, log } = ctx;
  const [found] = await db
    .select({ repo: repositories })
    .from(builds)
    .innerJoin(repositories, eq(repositories.id, builds.repoId))
    .where(eq(builds.id, buildId));
  if (!found) return;
  const { repo } = found;
  const more = asked.more ?? 0;
  const who = { userId: asked.userId, repo: repo.isPrivate ? `private:${sha256(repo.id).slice(0, 16)}` : repo.id };
  const phases = new Phases();
  const about = { attempt, more, private: repo.isPrivate, seed: repo.seed, size_kb: repo.sizeKb ?? null };
  ctx.telemetry?.capture("build started", who, about);
  const end = (state: "failed" | "done", set: { reason?: BuildFailure | null; detail?: string | null; seconds?: number; partial?: boolean }) =>
    db
      .update(builds)
      .set({ state, step: null, finishedAt: now(), reason: set.reason ?? null, detail: set.detail ?? null, ...(set.seconds !== undefined ? { seconds: Math.round(set.seconds) } : {}), ...(set.partial !== undefined ? { partial: set.partial } : {}) })
      .where(eq(builds.id, buildId));

  const token = await pullsToken(db, ctx.app, ctx.tokenSecret, repo, null);
  if (repo.isPrivate && !token) {
    await end("failed", { reason: "private", detail: "no installation token" });
    ctx.telemetry?.capture("build failed", who, { ...about, reason: "private" });
    return;
  }
  const scope = repo.isPrivate ? repo.id : "public";
  const gh: GitHubApi = { ...ctx.github, token: token ?? ctx.github.token };
  const gitToken = repo.isPrivate ? token : ctx.github.token;
  let pullsQueued = !!more;
  const started = Date.now();
  const remote = !more && attempt === 1 ? await remoteRefs(ctx.run, cloneUrl(ctx.cfg, repo.owner, repo.name), gitEnv(gitToken), HEAD_CHECK_MS).catch(() => null) : null;
  if (remote && (await keptUnchanged(ctx, repo, remote))) {
    const seconds = (Date.now() - started) / 1000;
    await end("done", { seconds, partial: false });
    ctx.telemetry?.capture("build unchanged", who, { ...about, seconds });
    log(`build ${buildId} ${repo.id}: its head has not moved, so the Report is kept, in ${seconds.toFixed(2)} s`);
    return;
  }
  const load = ctx.loadIndex ?? (ctx.pool ? (repoId: string, dir: string) => loadExport(ctx.pool as NonNullable<JobContext["pool"]>, repoId, dir) : null);

  const publish = async (made: Made): Promise<boolean> => {
    const continuing = made.phase === "quick" || (!!ctx.queueBuild && more < MORE_LINES_MAX);
    const target = await publishBuild(ctx, phases, buildId, made, continuing, remote?.refs ?? null);
    if (!target) return false;
    const at = (Date.now() - started) / 1000;
    if (made.phase === "quick") {
      await db.update(builds).set({ partial: true }).where(eq(builds.id, buildId));
      ctx.telemetry?.capture("build quick published", who, { ...about, kind: phases.kind, seconds: at, commits: made.manifest.total, ...said(phases) });
    } else {
      await end("done", { seconds: at, partial: false });
    }
    if (!pullsQueued) {
      pullsQueued = true;
      await ctx.queuePulls?.(target.id).catch((e: unknown) => log(`pulls for ${target.id} not queued: ${(e as Error).message}`));
    }
    if (made.phase === "full" && target.fresh) await queueEveryone(ctx, target.id, target.prefix, target.people).catch((e: unknown) => log(`counts for ${target.id} not queued: ${(e as Error).message}`));
    log(`build ${buildId} ${target.id}: ${made.phase} Report published after ${at.toFixed(1)} s, built in ${made.seconds} s`);
    return true;
  };

  const stateTier = ctx.cfg.state ? { storage: ctx.storage, keys: stateKeys(ctx.cfg.state.secret), db, log } : null;
  const currentId = async () => (await db.select({ id: builds.repoId }).from(builds).where(eq(builds.id, buildId)))[0]?.id ?? repo.id;
  const gitCfg = ctx.cfg.git;
  const outcome = load
    ? await build(
        {
          id: buildId,
          repo: repo.id,
          owner: repo.owner,
          name: repo.name,
          sizeKb: repo.sizeKb ?? 0,
          private: repo.isPrivate,
          token: gitToken,
          seed: repo.seed,
          attempt,
          hasLines: !!repo.reportKey && repo.reportLines !== false,
          more: more > 0,
          lean: await leanReady(db, repo),
          forkOf: repo.isPrivate ? null : parentOf(repo.facts),
        },
        ctx.cfg,
        {
          run: ctx.run,
          log,
          phases,
          progress: async (step) => {
            await db
              .update(builds)
              .set({ step })
              .where(and(eq(builds.id, buildId), eq(builds.state, "running")));
          },
          accounts: async (signatures) => {
            const got = await accountsFor(db, gh, { owner: repo.owner, name: repo.name, scope }, signatures, ctx.cfg.logins);
            log(`build ${buildId}: logins for ${Object.keys(got.accounts).length} of ${signatures.length} emails, ${got.asked} asked in ${got.requests} requests`);
            return got.accounts;
          },
          publish,
          ...(ctx.prefetch ? { prefetch: ctx.prefetch } : {}),
          ...(stateTier ? { state: { restore: (root: string) => restoreState(stateTier, repo.id, root), save: (root: string) => saveState(stateTier, repo.id, root) } } : {}),
          index: {
            live: async () => liveIndex(db, await currentId()),
            load: async (dir: string) => {
              const id = await currentId();
              const before = await liveIndex(db, id);
              return replaceIndex(ctx.storage, before, () => load(id, dir));
            },
          },
          ...(gitCfg ? { git: (dir: string, env: NodeJS.ProcessEnv) => buildGitData({ db, storage: ctx.storage, cfg: gitCfg, repoId: repo.id, buildId, dir, env, log, private: repo.isPrivate }).then(() => undefined) } : {}),
        },
      )
    : ({ published: null, seconds: 0, failure: { reason: "error", detail: "no database to load the Stored Index into" }, resumable: false, kind: phases.kind, made: null } satisfies Outcome);
  const why = outcome.failure;
  log(`build ${buildId} ${repo.id}: ${outcome.published ?? "nothing"} published${why ? `, ${why.reason}` : ""} in ${outcome.seconds} s, ${outcome.kind}, attempt ${attempt}${more ? `, more lines ${more}` : ""}`);
  log(`build ${buildId} steps: ${Object.entries(phases.seconds).map(([step, s]) => `${step} ${s} s`).join(", ") || "none"}`);
  const summary = { ...about, kind: outcome.kind, seconds: outcome.seconds, commits: outcome.made?.manifest.total ?? null, lines_left: outcome.made?.manifest.lines_left ?? null, ...said(phases) };
  if (why?.reason === "timed_out" && attempt < BUILD_ATTEMPTS && ctx.queueBuild) {
    await db.update(builds).set({ state: "queued", step: null, startedAt: null, requestedAt: now() }).where(eq(builds.id, buildId));
    const again = { buildId, repoId: repo.id, attempt: attempt + 1, ...(asked.userId ? { userId: asked.userId } : {}), ...(more ? { more } : {}) };
    const queued = await ctx
      .queueBuild(again, more ? PRIORITY.lines : repo.seed ? PRIORITY.seed : PRIORITY.person)
      .then(() => true)
      .catch((e: unknown) => {
        log(`build ${buildId} not queued again: ${(e as Error).message}`);
        return false;
      });
    if (queued) {
      ctx.telemetry?.capture("build failed", who, { ...summary, reason: why.reason, again: true });
      return;
    }
  }
  if (outcome.published === "full") {
    await end("done", { seconds: outcome.seconds, partial: false });
    const left = outcome.made?.manifest.lines_left ?? 0;
    if (left > 0) await queueMoreLines(ctx, await currentId(), more + 1);
    ctx.telemetry?.capture("build done", who, summary);
    return;
  }
  if (outcome.published === "quick") {
    await end("done", { seconds: outcome.seconds, partial: true, reason: why?.reason ?? "error", detail: why?.detail ?? null });
    await linesOff(db, buildId).catch((e: unknown) => log(`build ${buildId}: ${(e as Error).message}`));
  } else {
    await end("failed", { reason: why?.reason ?? "error", detail: why?.detail ?? null });
  }
  ctx.telemetry?.capture("build failed", who, { ...summary, reason: why?.reason ?? "error", published: outcome.published });
}

function parentOf(facts: string | null): string | null {
  try {
    const parent = (JSON.parse(facts ?? "null") as { parent?: unknown } | null)?.parent;
    return typeof parent === "string" ? parent : null;
  } catch {
    return null;
  }
}

/** Whether a Build can end at its head check: the Report is whole, and the remote's HEAD and every branch and tag are as the Build that published it saw them, asked with one `git ls-remote`, without a clone, the engine or an upload. Records when that was found. */
async function keptUnchanged(ctx: JobContext, repo: typeof repositories.$inferSelect, remote: RemoteRefs): Promise<boolean> {
  const live = await liveIndex(ctx.db, repo.id);
  if (!refsUnchanged(repo, live, remote)) return false;
  await ctx.db.update(repositories).set({ checkedAt: now() }).where(eq(repositories.id, repo.id));
  return true;
}

/** Whether a public repository's Builds may read a blobless clone, fetching only the file versions they read: its Lines Changed are all counted and its Report's Surviving Lines are, so no Build or count needs the whole history's files again. */
async function leanReady(db: Db, repo: typeof repositories.$inferSelect): Promise<boolean> {
  if (repo.isPrivate || !repo.reportKey || repo.reportLines !== true) return false;
  const live = await liveIndex(db, repo.id);
  if (!live?.lines || (live.linesLeft ?? 0) > 0) return false;
  const counts = await db
    .select({ status: surviving.status })
    .from(surviving)
    .where(and(eq(surviving.repoId, repo.id), eq(surviving.reportKey, repo.reportKey)));
  return counts.some((c) => c.status === "counted") && !counts.some((c) => c.status === "queued" || c.status === "over_budget");
}

async function queueMoreLines(ctx: JobContext, repoId: string, more: number): Promise<void> {
  if (!ctx.queueBuild || more > MORE_LINES_MAX) return;
  const id = randomId();
  await ctx.db.insert(builds).values({ id, repoId, state: "queued", requestedAt: now() });
  await ctx.queueBuild({ buildId: id, repoId, attempt: 1, more }, PRIORITY.lines, MORE_LINES_AFTER).catch(async (e: unknown) => {
    ctx.log(`more lines for ${repoId} not queued: ${(e as Error).message}`);
    await ctx.db.update(builds).set({ state: "failed", reason: "paused", detail: String(e), finishedAt: now() }).where(eq(builds.id, id));
  });
}

async function linesOff(db: Db, buildId: string): Promise<void> {
  const [named] = await db.select({ id: repositories.id }).from(builds).innerJoin(repositories, eq(repositories.id, builds.repoId)).where(eq(builds.id, buildId));
  if (!named) return;
  await db
    .update(repositories)
    .set({ reportMeta: sql`jsonb_set(${repositories.reportMeta}, '{lines}', '"off"')` })
    .where(and(eq(repositories.id, named.id), eq(repositories.reportLines, false), sql`${repositories.reportMeta}->>'lines' = 'counting'`));
}

type Published = { id: string; prefix: string; people: SummaryPerson[]; fresh: boolean };

/** Uploads a Build's pack, then makes its Stored Index the repository's Report: the pack's key on the Stored Index, the Report's meta and stats on the repository, its people, and the version the rest compares against, deleting the pack and Report objects it replaces. A quick one never replaces one with lines, and one of the same head and Stored Index keeps its version, so counts made for it stay. */
async function publishBuild(ctx: JobContext, phases: Phases, buildId: string, made: Made, continuing: boolean, refs: string | null): Promise<Published | null> {
  const { db, storage } = ctx;
  const [named] = await db
    .select({ id: repositories.id, reportKey: repositories.reportKey, reportLines: repositories.reportLines })
    .from(builds)
    .innerJoin(repositories, eq(repositories.id, builds.repoId))
    .where(eq(builds.id, buildId));
  if (!named) return null;
  if (made.phase === "quick" && named.reportKey && named.reportLines !== false) return null;
  const si = made.loaded.si;
  const pack = packKey(named.id, si, made.manifest.head ?? null, buildId, made.phase === "quick");
  const body = await readFile(made.pack);
  await phases.time(`upload ${made.phase}`, "http.client", () => storage.put(pack, body, { type: "application/octet-stream" }));
  const atlas = ctx.cfg.atlas;
  if (atlas && made.phase === "full") {
    await phases
      .time(`atlas ${made.phase}`, "atlas", () => storeAtlas(ctx.run, storage, { bin: ctx.cfg.bin, quality: atlas.quality, si, pack, file: made.pack, dir: made.dir, timeoutMs: timeLimitOf(ctx.cfg) * 1000, nice: ctx.cfg.nice, commits: made.manifest.total }))
      .catch((e: unknown) => ctx.log(`atlas of ${named.id}: ${(e as Error).message}, so the Site makes it`));
  }
  const lines = made.phase === "full" && made.manifest.lines_mainline;
  const same = made.phase === "full" && named.reportLines === true && !made.loaded.full && made.before?.id === si && made.before.head === made.manifest.head;
  const prefix = same && named.reportKey ? named.reportKey : reportPrefix(named.id, made.phase === "full" ? buildId : `${buildId}-quick`);
  if (made.phase === "full") {
    await phases
      .time(`screens ${made.phase}`, "screens", () =>
        storeScreens(ctx.run, storage, { bin: ctx.cfg.bin, pack: made.pack, dir: made.dir, key: screensKey(pack), env: ctx.cfg.threads ? { COMMITSCAPE_THREADS: String(ctx.cfg.threads) } : {}, timeoutMs: timeLimitOf(ctx.cfg) * 1000, nice: ctx.cfg.nice, commits: made.manifest.total }),
      )
      .catch((e: unknown) => ctx.log(`screens of ${named.id}: ${(e as Error).message}, so the engine service answers them`));
  }
  const { stats, people } = made.summary;
  const meta: Meta = { ...made.summary.meta, lines: lines ? "counted" : continuing ? "counting" : "off" };
  const target = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: repositories.id, reportKey: repositories.reportKey })
      .from(builds)
      .innerJoin(repositories, eq(repositories.id, builds.repoId))
      .where(eq(builds.id, buildId));
    if (!current) return null;
    const [index] = await tx.select({ pack: storedIndexes.pack }).from(storedIndexes).where(eq(storedIndexes.id, si));
    await tx.update(storedIndexes).set({ pack, buildFormat: BUILD_FORMAT }).where(eq(storedIndexes.id, si));
    await tx
      .update(repositories)
      .set({
        reportKey: prefix,
        reportHead: made.manifest.head ?? null,
        ...(refs ? { reportRefs: refs } : {}),
        reportAt: now(),
        reportBytes: body.length,
        reportLines: lines,
        reportMeta: meta,
        reportStats: stats,
        busFactor: stats.bus_factor,
        maintainers: stats.maintainers,
        commits30d: stats.commits_30d,
        codeLines: stats.code_lines,
      })
      .where(eq(repositories.id, current.id));
    const rows = people.map((p) => ({
      repoId: current.id,
      personId: p.person_id,
      name: p.name,
      login: p.login,
      commits: p.commits,
      linesAdded: lines ? p.lines_added : null,
      linesRemoved: lines ? p.lines_removed : null,
      first: p.first,
      last: p.last,
      reportKey: prefix,
    }));
    await tx.delete(repoPeople).where(eq(repoPeople.repoId, current.id));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(repoPeople).values(rows.slice(i, i + 1000));
    await tx.execute(sql`SELECT pg_notify(${LOADED}, ${String(si)})`);
    return { current, replaced: index?.pack ?? null };
  });
  if (!target) {
    await storage.delete([pack]).catch(() => undefined);
    for (const beside of besidePack(si, pack)) await storage.deletePrefix(beside).catch(() => undefined);
    if (prefix !== named.reportKey) await storage.deletePrefix(`${prefix}/`).catch(() => undefined);
    return null;
  }
  if (target.replaced && target.replaced !== pack) {
    await storage.delete([target.replaced]).catch(() => undefined);
    for (const beside of besidePack(si, target.replaced)) await storage.deletePrefix(beside).catch(() => undefined);
  }
  if (target.current.reportKey && target.current.reportKey !== prefix) await storage.deletePrefix(`${target.current.reportKey}/`).catch(() => undefined);
  return { id: target.current.id, prefix, people, fresh: target.current.reportKey !== prefix };
}

async function queueEveryone(ctx: JobContext, repoId: string, reportKey: string, people: SummaryPerson[]): Promise<void> {
  if (!ctx.queueCounts) return;
  const at = now();
  const ids = people.map((p) => p.person_id);
  for (let i = 0; i < ids.length; i += 1000) {
    await ctx.db
      .insert(surviving)
      .values(ids.slice(i, i + 1000).map((personId) => ({ repoId, reportKey, personId, status: "queued", askedAt: at })))
      .onConflictDoNothing();
  }
  await ctx.queueCounts({ repoId, reportKey, personIds: [], everyone: true });
}
