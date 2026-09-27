import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { now, schema, sha256, type Db } from "@commitscape/server";

export type Limit = { action: string; max: number; seconds: number };

/** Counts one more action for an address and says whether it is within the limit. */
export async function allow(db: Db, limit: Limit, address: string): Promise<boolean> {
  const window = Math.floor(now() / limit.seconds);
  const key = `${limit.action}:${sha256(`${limit.action}:${address}`)}:${window}`;
  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, count: 1, until: (window + 1) * limit.seconds })
    .onConflictDoUpdate({ target: schema.rateLimits.key, set: { count: sql`${schema.rateLimits.count} + 1` } })
    .returning({ count: schema.rateLimits.count });
  return (row?.count ?? 1) <= limit.max;
}
