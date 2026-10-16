import "@tanstack/react-start/server-only";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { key, OVERVIEW_TOP } from "@commitscape/data";
import { listenForLoads, now, readIndex, schema, type Db, type Storage } from "@commitscape/server";
import { forgetStamp, holds, warmIndex } from "./answers";
import { warmAtlas } from "./universe";

const { repositories } = schema;

const RECENT = 6;
const RECENT_FOR = 3 * 86_400;
const START_AFTER = 5_000;

/** The answers a repository's first screen asks for, in one Window. */
export function firstAnswers(window: string): string[] {
  return ["/api/stats", key("/api/overview", { window, top: OVERVIEW_TOP }), key("/api/people", { window, top: OVERVIEW_TOP }), key("/api/people", { window }), key("/api/map", { window }), key("/api/activity", { window })];
}

type Warmable = { indexId: number | null; reportKey: string | null };

async function warmRepo(db: Db, storage: Storage, repo: Warmable): Promise<number> {
  if (repo.indexId === null) return 0;
  const index = repo.reportKey ? await readIndex(storage, repo.reportKey).catch(() => null) : null;
  const warmed = await warmIndex(db, repo.indexId, firstAnswers(index?.meta.window ?? "all"));
  await warmAtlas(db, storage, repo.indexId).catch(() => false);
  return warmed;
}

/** Reads into memory the Stored Indexes of the repositories viewed most recently, and their first screen's answers, one after another. */
export async function warmRecent(db: Db, storage: Storage, count = RECENT): Promise<number> {
  const recent = await db
    .select({ indexId: repositories.indexId, reportKey: repositories.reportKey })
    .from(repositories)
    .where(and(isNotNull(repositories.indexId), gt(repositories.viewedAt, now() - RECENT_FOR)))
    .orderBy(desc(repositories.viewedAt))
    .limit(count);
  let warmed = 0;
  for (const repo of recent) if ((await warmRepo(db, storage, repo).catch(() => 0)) > 0) warmed += 1;
  return warmed;
}

/** Warms a Stored Index a Build has just loaded when its repository is in memory or was viewed lately, so its next visitor does not wait for it. */
export async function warmLoaded(db: Db, storage: Storage, si: number): Promise<boolean> {
  forgetStamp(si);
  const [repo] = await db.select({ indexId: repositories.indexId, reportKey: repositories.reportKey, viewedAt: repositories.viewedAt }).from(repositories).where(eq(repositories.indexId, si));
  if (!repo || (!holds(si) && (repo.viewedAt ?? 0) < now() - RECENT_FOR)) return false;
  return (await warmRepo(db, storage, repo)) > 0;
}

/** Listens for Stored Indexes the Builder loads and warms them, and warms the recently viewed ones a few seconds after the Site starts; the returned function stops it. */
export function startWarming(url: string, db: () => Db, storage: () => Storage): () => Promise<void> {
  let queue = Promise.resolve();
  const later = (work: () => Promise<unknown>) => {
    queue = queue.then(() => work().then(() => undefined, () => undefined));
  };
  const stop = listenForLoads(url, (si) => later(() => warmLoaded(db(), storage(), si)));
  const start = setTimeout(() => later(() => warmRecent(db(), storage())), START_AFTER);
  start.unref?.();
  return async () => {
    clearTimeout(start);
    await stop();
  };
}

const running = globalThis as { commitscapeWarming?: { by: symbol; stop: () => Promise<void> } };
const self = Symbol("warming");

/** Starts warming once per Site process, and again with the code the server now runs when it is loaded anew. */
export function warmSite(url: string, db: () => Db, storage: () => Storage): void {
  const before = running.commitscapeWarming;
  if (before?.by === self) return;
  void before?.stop();
  running.commitscapeWarming = { by: self, stop: startWarming(url, db, storage) };
}
