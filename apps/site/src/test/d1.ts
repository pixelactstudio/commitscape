/**
 * A stand-in for D1 over Node's own SQLite, for unit tests: the same SQL,
 * the migrations in drizzle/, and the few calls the handlers make.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** CPU spent inside SQLite, in ms: D1's share, which on Cloudflare is not the Worker's. */
export const sqlite = { ms: 0 };

function timed<T>(work: () => T): T {
  const before = process.cpuUsage();
  try {
    return work();
  } finally {
    const used = process.cpuUsage(before);
    sqlite.ms += (used.user + used.system) / 1000;
  }
}

export function testD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "../../drizzle");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...more: unknown[]) => statement(sql, more),
    first: async <T>() => timed(() => (db.prepare(sql).get(...(args as never[])) ?? null) as T | null),
    all: async <T>() => ({ results: timed(() => db.prepare(sql).all(...(args as never[])) as T[]), success: true, meta: {} }),
    run: async () => {
      const r = timed(() => db.prepare(sql).run(...(args as never[])));
      return { success: true, results: [], meta: { changes: Number(r.changes) } };
    },
    raw: async () => timed(() => db.prepare(sql).all(...(args as never[]))).map((row) => Object.values(row as object)),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.run())),
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}
