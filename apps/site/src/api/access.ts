/**
 * Who may see a Connected Repository's Report (ADR-0017): whoever GitHub
 * says can see the repository right now, asked with their own token and
 * remembered for five minutes.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { access } from "../db/schema";
import { asUser, type Session } from "./auth";
import { now } from "./http";

/** How long an answer is remembered, in seconds. */
export const ACCESS_FOR = 300;

/**
 * Whether GitHub shows the person this repository now. With `githubId`, it
 * must also still be the same repository: a name can be given to another
 * after a rename, a transfer or a deletion.
 */
export async function canSee(env: Env, s: Session, owner: string, name: string, githubId?: number | null): Promise<boolean> {
  const key = `${s.id}:${`${owner}/${name}`.toLowerCase()}`;
  const db = drizzle(env.DB);
  const kept = await db.select().from(access).where(eq(access.key, key)).get();
  if (kept && kept.until > now()) return kept.allowed;
  const answer = await asUser(env, s, `/repos/${owner}/${name}`);
  let allowed = answer.ok;
  if (allowed && githubId) allowed = ((await answer.json().catch(() => null)) as { id?: unknown } | null)?.id === githubId;
  await db
    .insert(access)
    .values({ key, allowed, until: now() + ACCESS_FOR })
    .onConflictDoUpdate({ target: access.key, set: { allowed, until: now() + ACCESS_FOR } });
  return allowed;
}
