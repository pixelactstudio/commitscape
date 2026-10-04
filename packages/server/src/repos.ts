import { inArray } from "drizzle-orm";
import type { Db } from "./db/client";
import { repositories } from "./db/schema";
import type { Storage } from "./storage";

export type RepoRow = typeof repositories.$inferSelect;

/** Deletes repositories' stored Reports and cards, and their rows. */
export async function removeReports(db: Db, storage: Storage, rows: RepoRow[]): Promise<void> {
  for (const r of rows) {
    if (r.reportKey) await storage.deletePrefix(`${r.reportKey}/`);
    await storage.deletePrefix(`cards/gh/${r.id}/`);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id);
    if (ids.length > 0) await db.delete(repositories).where(inArray(repositories.id, ids));
  }
}
