import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const IDLE_MS = 5 * 60_000;
const KEEP_ALIVE_MS = 30_000;

/** A Drizzle client on a pooled Postgres connection; idle connections are kept for minutes, with TCP keep-alive, rather than opened again for every burst of queries. */
export function createDb(url: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: IDLE_MS, keepAlive: true, keepAliveInitialDelayMillis: KEEP_ALIVE_MS, allowExitOnIdle: true });
  pool.on("error", (e) => console.error("postgres:", e.message));
  return { db: drizzle(pool, { schema }), pool };
}

const ONE_BUILDER = 7_386_015_221;

/** Takes the lock only one Builder may hold, on a connection of its own that stays open while the Builder runs: its locks, its share of memory and its record of disk use are its own, so a second Builder must not run beside it. `held` is false when another holds it; `lost` is called if the connection, and so the lock, goes. */
export async function holdBuilderLock(url: string, lost: (e: Error) => void): Promise<{ held: boolean; release: () => Promise<void> }> {
  const client = new pg.Client({ connectionString: url, keepAlive: true });
  client.on("error", lost);
  await client.connect();
  const { rows } = await client.query<{ held: boolean }>("SELECT pg_try_advisory_lock($1) AS held", [ONE_BUILDER]);
  const held = rows[0]?.held === true;
  const release = async () => {
    client.removeListener("error", lost);
    await client.end().catch(() => undefined);
  };
  if (!held) await release();
  return { held, release };
}

/** Applies the migrations in `migrationsFolder` that have not run yet. */
export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  pool.on("error", (e) => console.error("postgres:", e.message));
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
