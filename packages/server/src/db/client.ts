import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A Drizzle client on a pooled Postgres connection. */
export function createDb(url: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max });
  return { db: drizzle(pool, { schema }), pool };
}

/** Applies the migrations in `migrationsFolder` that have not run yet. */
export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
