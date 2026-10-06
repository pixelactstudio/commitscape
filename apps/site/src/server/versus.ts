import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import { achievementsOf, archetypesOf, betweenOf, gapsTo, isLogin, sharedRepositories, versusRows, type Gap, type Profile, type VersusFull, type VersusPerson, type VersusRow, type VersusSide } from "@commitscape/data";
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

async function read(deps: ProfileDeps, login: string) {
  if (!isLogin(login)) throw new SiteError(404, "That is not a GitHub username.");
  if (await isHidden(deps, login)) throw new SiteError(404, `@${login} has chosen to stay out of comparisons.`);
  const p = await readProfile(deps, anonymous, login, true);
  const engine = await survivingTotal(deps.db, login);
  return { p, engine };
}

function side(p: Profile, surviving: number | null): VersusSide {
  return { identity: { login: p.identity.login, name: p.identity.name }, totals: p.totals, surviving, thisMonth: monthOf(p) };
}

/** One side of a comparison: a person's public Profile and their counted Surviving Lines; a hidden person is refused. */
export async function sideOf(deps: ProfileDeps, login: string): Promise<VersusSide> {
  const { p, engine } = await read(deps, login);
  return side(p, engine?.surviving ?? null);
}

/** What the full comparison shows of one person: their last year a day at a time, their years, languages, commit hours, Archetypes and Achievements. */
export function personOf(p: Profile, engine: Awaited<ReturnType<typeof survivingTotal>>, at = Math.floor(Date.now() / 1000)): VersusPerson {
  const { firstDay, days } = p.calendar;
  const from = Math.max(0, days.length - 364 - (((firstDay + days.length - 1 + 3) % 7) + 1));
  const languages = new Map<string, { name: string; colour: string | null; commits: number }>();
  for (const y of p.years) for (const l of y.languages) languages.set(l.name, { name: l.name, colour: l.colour, commits: (languages.get(l.name)?.commits ?? 0) + l.commits });
  const input = { totals: p.totals, years: p.years, prs: p.prs, clock: p.clock ?? null, calendar: p.calendar, complete: p.read.complete, engine: engine ? { surviving: engine.surviving, oldest: engine.oldest } : null, now: at };
  return {
    identity: p.identity,
    totals: p.totals,
    surviving: engine?.surviving ?? null,
    lastYear: { firstDay: firstDay + from, days: days.slice(from) },
    years: p.years.map((y) => ({ year: y.year, contributions: y.commits + y.prs + y.reviews + y.issues + y.hidden, commits: y.commits, prs: y.prs, reviews: y.reviews, issues: y.issues })),
    languages: [...languages.values()].sort((x, y) => y.commits - x.commits),
    clock: p.clock && p.clock.sampled > 0 ? p.clock : null,
    archetypes: archetypesOf(input),
    achievements: achievementsOf(input),
    repositories: p.repositories.filter((r) => !r.private).length,
    read: { prs: p.read.prs, prsTotal: p.read.prsTotal, complete: p.read.complete },
  };
}

/** Two people side by side in full: each view's winner, then their years, languages, hours, traits and the repositories they share. */
export async function versusFullOf(deps: ProfileDeps, a: string, b: string): Promise<VersusFull> {
  if (a.toLowerCase() === b.toLowerCase()) throw new SiteError(400, "A Versus needs two different people.");
  const [x, y] = await Promise.all([read(deps, a), read(deps, b)]);
  const [sa, sb] = [side(x.p, x.engine?.surviving ?? null), side(y.p, y.engine?.surviving ?? null)];
  return { a: sa, b: sb, rows: versusRows(sa, sb), people: { a: personOf(x.p, x.engine), b: personOf(y.p, y.engine) }, shared: sharedRepositories(x.p.repositories, y.p.repositories), between: betweenOf(x.p, y.p) };
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
