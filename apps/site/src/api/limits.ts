/**
 * Rate limits (ADR-0014), counted in D1: Cloudflare's rate-limiting
 * binding is not documented for the free plan, and it counts per location
 * and "intentionally" loosely. One row per action, address and window;
 * the address is kept only as a hash. Expired rows are removed by the Cron
 * Trigger (`sweep`).
 */
import { now, sha256 } from "./http";

export type Limit = { action: string; max: number; seconds: number };

/** Counts one more, and says whether it is still within the limit. */
export async function allow(db: D1Database, limit: Limit, address: string): Promise<boolean> {
  const window = Math.floor(now() / limit.seconds);
  const key = `${limit.action}:${await sha256(`${limit.action}:${address}`)}:${window}`;
  const row = await db
    .prepare(
      "INSERT INTO rate_limits (key, count, until) VALUES (?1, 1, ?2) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
    )
    .bind(key, (window + 1) * limit.seconds)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit.max;
}

/** Removes counters whose window has passed. */
export async function sweep(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE until < ?1").bind(now()).run();
}
