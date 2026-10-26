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
