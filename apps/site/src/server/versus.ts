import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import { gapsTo, isLogin, versusRows, type Gap, type Profile, type VersusRow, type VersusSide } from "@commitscape/data";
import { now, schema, type Db } from "@commitscape/server";
import { survivingTotal } from "./engine";
import { SiteError } from "./http";
import { isHidden } from "./people";
import { readProfile, type ProfileDeps } from "./profiles";

const { rivals } = schema;

export const RIVALS_MAX = 5;
const anonymous = { login: async () => null, token: async () => null };

/** A month's merged pull requests and contributions in a Profile, the current month on UTC's calendar by default. */
export function monthOf(p: Profile, month = new Date().toISOString().slice(0, 7)): VersusSide["thisMonth"] {
  const m = p.months.find((x) => x.month === month);
  return { prsMerged: m?.prsMerged ?? 0, contributions: m?.contributions ?? 0 };
}

/** One side of a comparison: a person's public Profile and their counted Surviving Lines; a hidden person is refused. */
export async function sideOf(deps: ProfileDeps, login: string): Promise<VersusSide> {
  if (!isLogin(login)) throw new SiteError(404, "That is not a GitHub username.");
  if (await isHidden(deps, login)) throw new SiteError(404, `@${login} has chosen to stay out of comparisons.`);
  const p = await readProfile(deps, anonymous, login, true);
  const engine = await survivingTotal(deps.db, login);
  return { identity: { login: p.identity.login, name: p.identity.name }, totals: p.totals, surviving: engine?.surviving ?? null, thisMonth: monthOf(p) };
}

export type Versus = { a: VersusSide; b: VersusSide; rows: VersusRow[] };

/** Two people side by side, with a winner for each view and none overall. */
export async function versusOf(deps: ProfileDeps, a: string, b: string): Promise<Versus> {
  if (a.toLowerCase() === b.toLowerCase()) throw new SiteError(400, "A Versus needs two different people.");
  const [x, y] = await Promise.all([sideOf(deps, a), sideOf(deps, b)]);
  return { a: x, b: y, rows: versusRows(x, y) };
}

/** Adds a Rival for a signed-in person, up to five. */
export async function addRival(db: Db, userId: string, mine: string, rival: string): Promise<void> {
  if (!isLogin(rival)) throw new SiteError(400, "That is not a GitHub username.");
  if (rival.toLowerCase() === mine.toLowerCase()) throw new SiteError(400, "You cannot be your own Rival.");
  const kept = await db.select().from(rivals).where(eq(rivals.userId, userId));
  if (kept.length >= RIVALS_MAX && !kept.some((r) => r.rival === rival.toLowerCase())) throw new SiteError(400, `Five Rivals at most; remove one first.`);
  await db.insert(rivals).values({ userId, rival: rival.toLowerCase(), createdAt: now() }).onConflictDoNothing();
}

/** Removes a Rival. */
export async function removeRival(db: Db, userId: string, rival: string): Promise<void> {
  await db.delete(rivals).where(and(eq(rivals.userId, userId), eq(rivals.rival, rival.toLowerCase())));
}

export type RivalGap = { login: string; name: string | null; gaps: Gap[] } | { login: string; hidden: true };

/** A signed-in person's Rivals, and how far they are from each; a Rival who has hidden says only that. */
export async function rivalsOf(deps: ProfileDeps, userId: string, mine: string): Promise<RivalGap[]> {
  const list = await deps.db.select().from(rivals).where(eq(rivals.userId, userId)).orderBy(rivals.createdAt);
  if (list.length === 0) return [];
  const me = await sideOf(deps, mine).catch(() => null);
  return Promise.all(
    list.map(async (r): Promise<RivalGap> => {
      if (await isHidden(deps, r.rival)) return { login: r.rival, hidden: true };
      const them = await sideOf(deps, r.rival).catch(() => null);
      if (!them || !me) return { login: r.rival, hidden: true };
      return { login: them.identity.login, name: them.identity.name, gaps: gapsTo(me, them) };
    }),
  );
}

/** The logins a signed-in person has as Rivals. */
export async function rivalLogins(db: Db, userId: string): Promise<string[]> {
  return (await db.select({ rival: rivals.rival }).from(rivals).where(eq(rivals.userId, userId))).map((r) => r.rival);
}
