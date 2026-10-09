import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Db } from "./db/client";
import { access, rateLimits, repositories, session, shares, verification } from "./db/schema";
import { pruneGitHubCache } from "./github-cache";
import { removeReports } from "./repos";
import type { Storage } from "./storage";
import { now } from "./time";

export const RETAIN_FOR = 30 * 24 * 3600;
export const NOT_FOUND_FOR = 7 * 24 * 3600;
export const UPLOAD_WITHIN = 3600;

export const shareKey = (id: string) => `shares/${id}`;

/** Deletes expired Shared Reports and uploads that were never made. */
export async function expireShares(db: Db, storage: Storage): Promise<number> {
  const gone = await db
    .select({ id: shares.id })
    .from(shares)
    .where(or(lt(shares.expiresAt, now()), and(eq(shares.uploaded, false), lt(shares.createdAt, now() - UPLOAD_WITHIN))))
    .limit(1000);
  const ids = gone.map((r) => r.id);
  if (ids.length === 0) return 0;
  await storage.delete(ids.map(shareKey));
  await db.delete(shares).where(inArray(shares.id, ids));
  return ids.length;
}

/** Deletes Connected Repositories' Reports unseen for thirty days. */
export async function retainConnected(db: Db, storage: Storage): Promise<number> {
  const before = now() - RETAIN_FOR;
  const old = await db
    .select()
    .from(repositories)
    .where(
      and(
        isNotNull(repositories.installationId),
        or(lt(repositories.viewedAt, before), and(isNull(repositories.viewedAt), lt(repositories.reportAt, before))),
      ),
    )
    .limit(500);
  await removeReports(db, storage, old);
  return old.length;
}

/** Deletes everything that has expired; the scheduler runs it every fifteen minutes. */
export async function cleanup(db: Db, storage: Storage): Promise<Record<string, number>> {
  const at = now();
  const shared = await expireShares(db, storage);
  const retained = await retainConnected(db, storage);
  const limits = await db.delete(rateLimits).where(lt(rateLimits.until, at)).returning({ key: rateLimits.key });
  const answers = await db.delete(access).where(lt(access.until, at)).returning({ id: access.sessionId });
  const sessions = await db.delete(session).where(lt(session.expiresAt, new Date())).returning({ id: session.id });
  await db.delete(verification).where(lt(verification.expiresAt, new Date()));
  const missing = await db
    .delete(repositories)
    .where(
      and(
        eq(repositories.status, "not_found"),
        isNull(repositories.reportKey),
        isNull(repositories.installationId),
        eq(repositories.seed, false),
        lt(repositories.factsAt, at - NOT_FOUND_FOR),
      ),
    )
    .returning({ id: repositories.id });
  return { shared, retained, limits: limits.length, answers: answers.length, sessions: sessions.length, missing: missing.length, github: await pruneGitHubCache(db) };
}
