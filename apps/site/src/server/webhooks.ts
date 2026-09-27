import "@tanstack/react-start/server-only";
import { createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { removeReports, same, schema, type Db, type Storage } from "@commitscape/server";

type Event = { action?: string; installation?: { id?: number }; repositories_removed?: { full_name?: string }[] };

/** Whether a webhook body carries GitHub's signature under the secret. */
export function githubSigned(secret: string | undefined, header: string | null, body: string): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  return same(header, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
}

/** Deletes the Reports of repositories the GitHub App was removed from. */
export async function onWebhook(db: Db, storage: Storage, kind: string | null, event: Event): Promise<number> {
  const installation = event.installation?.id;
  const { repositories } = schema;
  if (!installation) return 0;
  if (kind === "installation" && event.action === "deleted") {
    const gone = await db.select().from(repositories).where(eq(repositories.installationId, installation));
    await removeReports(db, storage, gone);
    return gone.length;
  }
  if (kind === "installation_repositories" && event.action === "removed") {
    const names = (event.repositories_removed ?? []).map((r) => (r.full_name ?? "").toLowerCase()).filter(Boolean);
    if (names.length === 0) return 0;
    const gone = await db.select().from(repositories).where(and(eq(repositories.installationId, installation), inArray(repositories.id, names)));
    await removeReports(db, storage, gone);
    return gone.length;
  }
  return 0;
}
