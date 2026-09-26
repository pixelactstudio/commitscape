/**
 * GitHub's webhooks for the App (ADR-0017), verified by their signature:
 * removing the App from an account (`installation` deleted) or from some
 * repositories (`installation_repositories` removed) deletes those
 * repositories' Reports at once.
 */
import { and, eq, inArray, lt, isNotNull, or, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { repositories } from "../db/schema";
import { removeReports } from "./auth";
import { githubSigned } from "./crypto";
import { json, now, says } from "./http";

/** A Connected Repository's Report goes after this long without a view. */
export const RETAIN_FOR = 30 * 24 * 3600;

type Event = {
  action?: string;
  installation?: { id?: number };
  repositories_removed?: { full_name?: string }[];
};

export async function webhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (body.length > 1024 * 1024) return says(413, "Too large.");
  if (!(await githubSigned(env.GITHUB_WEBHOOK_SECRET, request.headers.get("x-hub-signature-256"), body))) {
    return says(401, "Not signed by GitHub.");
  }
  const kind = request.headers.get("x-github-event");
  const event = JSON.parse(body) as Event;
  const installation = event.installation?.id;
  const db = drizzle(env.DB);
  if (kind === "installation" && event.action === "deleted" && installation) {
    const gone = await db.select().from(repositories).where(eq(repositories.installationId, installation)).all();
    await removeReports(env, gone);
    return json({ ok: true, removed: gone.length });
  }
  if (kind === "installation_repositories" && event.action === "removed" && installation) {
    const names = (event.repositories_removed ?? []).map((r) => (r.full_name ?? "").toLowerCase()).filter(Boolean);
    const gone: (typeof repositories.$inferSelect)[] = [];
    // D1 binds at most 100 values a statement.
    for (let i = 0; i < names.length; i += 90) {
      gone.push(
        ...(await db
          .select()
          .from(repositories)
          .where(and(eq(repositories.installationId, installation), inArray(repositories.id, names.slice(i, i + 90))))
          .all()),
      );
    }
    await removeReports(env, gone);
    return json({ ok: true, removed: gone.length });
  }
  // Every other event is acknowledged and changes nothing.
  return json({ ok: true, removed: 0 });
}

/** Connected Repositories' Reports unseen for thirty days go (the Cron Trigger), a hundred at a time. */
export async function retain(env: Env): Promise<number> {
  const before = now() - RETAIN_FOR;
  const old = await drizzle(env.DB)
    .select()
    .from(repositories)
    .where(
      and(
        isNotNull(repositories.installationId),
        or(lt(repositories.viewedAt, before), and(isNull(repositories.viewedAt), lt(repositories.reportAt, before))),
      ),
    )
    .limit(100)
    .all();
  await removeReports(env, old);
  return old.length;
}
