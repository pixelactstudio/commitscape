import "@tanstack/react-start/server-only";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { key, OVERVIEW_TOP } from "@commitscape/data";
import { listenForLoads, now, reportIndexOf, schema, type Db, type Storage } from "@commitscape/server";
import { forgetPack, packOf } from "./answers";
import type { EngineService } from "./engine-service";
import { warmAtlas } from "./universe";

const { repositories } = schema;

const RECENT = 6;
const RECENT_FOR = 3 * 86_400;
const START_AFTER = 5_000;

export type Warming = { db: Db; storage: Storage; engine: EngineService };

/** The answers a repository's first screen asks for, in one Window. */
export function firstAnswers(window: string): string[] {
  return ["/api/stats", key("/api/overview", { window, top: OVERVIEW_TOP }), key("/api/people", { window, top: OVERVIEW_TOP }), key("/api/people", { window }), key("/api/map", { window }), key("/api/activity", { window })];
}

type Warmable = Pick<typeof repositories.$inferSelect, "indexId" | "reportKey" | "reportMeta" | "reportStats">;

const warmable = { indexId: repositories.indexId, reportKey: repositories.reportKey, reportMeta: repositories.reportMeta, reportStats: repositories.reportStats };

async function warmRepo(w: Warming, repo: Warmable): Promise<number> {
  const pack = await packOf(w.db, repo.indexId, { waits: 0 });
  if (repo.indexId === null || pack === null) return 0;
  const index = await reportIndexOf(w.storage, repo).catch(() => null);
  const warmed = await w.engine.warm(pack, firstAnswers(index?.meta.window ?? "all"));
  await warmAtlas(w, repo.indexId, pack).catch(() => false);
  return warmed;
}

/** Has the engine service read the packs of the repositories viewed most recently, and work out their first screen's answers, one after another. */
export async function warmRecent(w: Warming, count = RECENT): Promise<number> {
  const recent = await w.db
    .select(warmable)
    .from(repositories)
    .where(and(isNotNull(repositories.indexId), gt(repositories.viewedAt, now() - RECENT_FOR)))
    .orderBy(desc(repositories.viewedAt))
    .limit(count);
  let warmed = 0;
  for (const repo of recent) if ((await warmRepo(w, repo).catch(() => 0)) > 0) warmed += 1;
  return warmed;
}

/** Warms a Stored Index a Build has just loaded or published when its repository was viewed lately, so its next visitor does not wait for it; nothing until it has a pack. */
export async function warmLoaded(w: Warming, si: number): Promise<boolean> {
  forgetPack(w.db, si);
  const [repo] = await w.db.select({ ...warmable, viewedAt: repositories.viewedAt }).from(repositories).where(eq(repositories.indexId, si));
  if (!repo || (repo.viewedAt ?? 0) < now() - RECENT_FOR) return false;
  return (await warmRepo(w, repo)) > 0;
}

/** Listens for Stored Indexes the Builder loads and publishes and warms them, and warms the recently viewed ones a few seconds after the Site starts; the returned function stops it. */
export function startWarming(url: string, warming: () => Warming): () => Promise<void> {
  let queue = Promise.resolve();
  const later = (work: () => Promise<unknown>) => {
    queue = queue.then(() => work().then(() => undefined, () => undefined));
  };
  const stop = listenForLoads(url, (si) => later(() => warmLoaded(warming(), si)));
  const start = setTimeout(() => later(() => warmRecent(warming())), START_AFTER);
  start.unref?.();
  return async () => {
    clearTimeout(start);
    await stop();
  };
}

const running = globalThis as { commitscapeWarming?: { by: symbol; stop: () => Promise<void> } };
const self = Symbol("warming");

/** Starts warming once per Site process, and again with the code the server now runs when it is loaded anew. */
export function warmSite(url: string, warming: () => Warming): void {
  const before = running.commitscapeWarming;
  if (before?.by === self) return;
  void before?.stop();
  running.commitscapeWarming = { by: self, stop: startWarming(url, warming) };
}
