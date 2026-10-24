import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { storedIndexes } from "./db/schema";
import { LOADED } from "./stored-index";
import { now } from "./time";

export const MAINLINE = { reachable: 8, firstParent: 16 } as const;

const BITS = sql.raw(String(MAINLINE.reachable | MAINLINE.firstParent));

export type Mainline = { shas: string[]; bits: number[]; arrival: number[] };

export type MainlineWritten = { changed: number; releases: number };

/** Rewrites the Mainline of a Stored Index, writing only the rows whose values differ, and tells the Site when anything changed. */
export async function writeMainline(db: Db, si: number, mainline: Mainline, tags: ReadonlyMap<string, string> = new Map()): Promise<MainlineWritten> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`SET LOCAL enable_nestloop = off`);
    const given = sql`SELECT decode(u.h, 'hex') AS sha, u.b AS bits, u.a AS arrival FROM unnest(${sql.param(mainline.shas)}::text[], ${sql.param(mainline.bits)}::smallint[], ${sql.param(mainline.arrival)}::bigint[]) AS u(h, b, a)`;
    const marked = await t.execute(sql`
      UPDATE index_commits c SET flags = (c.flags & ~${BITS}) | m.bits, arrival = m.arrival
      FROM (${given}) AS m
      WHERE c.si = ${si} AND c.sha = m.sha AND ((c.flags & ${BITS}) <> m.bits OR c.arrival IS DISTINCT FROM m.arrival)`);
    const cleared = await t.execute(sql`
      UPDATE index_commits c SET flags = c.flags & ~${BITS}, arrival = NULL
      WHERE c.si = ${si} AND ((c.flags & ${BITS}) <> 0 OR c.arrival IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM (${given}) AS m WHERE m.sha = c.sha)`);
    const changed = rowCount(marked) + rowCount(cleared);
    const [index] = await t.select({ snapshot: storedIndexes.snapshot }).from(storedIndexes).where(eq(storedIndexes.id, si));
    const snapshot = index?.snapshot ?? null;
    const shas: Record<string, string> = {};
    for (const [name] of snapshot?.releases ?? []) {
      const sha = tags.get(name);
      if (sha) shas[name] = sha;
    }
    const releases = Object.keys(shas).length;
    const same = JSON.stringify(snapshot?.release_shas ?? {}) === JSON.stringify(shas);
    if (snapshot && !same) await t.update(storedIndexes).set({ snapshot: { ...snapshot, release_shas: shas } }).where(eq(storedIndexes.id, si));
    if (changed > 0 || (snapshot && !same)) {
      await t
        .update(storedIndexes)
        .set({ loadedAt: sql`greatest(${now()}, coalesce(${storedIndexes.loadedAt}, 0) + 1)` })
        .where(eq(storedIndexes.id, si));
      await t.execute(sql`SELECT pg_notify(${LOADED}, ${String(si)})`);
    }
    return { changed, releases };
  });
}

function rowCount(result: unknown): number {
  const r = result as { rowCount?: number | null; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? 0;
}
