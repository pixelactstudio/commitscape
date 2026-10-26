import "@tanstack/react-start/server-only";
import { achievementsOf, archetypesOf, betweenOf, isLogin, sharedRepositories, versusRows, type Profile, type VersusFull, type VersusPerson, type VersusRow, type VersusSide } from "@commitscape/data";
import { survivingTotal } from "./engine";
import { SiteError } from "./http";
import { isHidden } from "./people";
import { readProfile, STORED_ONLY, type ProfileDeps, type ProfileViewer } from "./profiles";

async function read(deps: ProfileDeps, login: string, reader: ProfileViewer) {
  if (!isLogin(login)) throw new SiteError(404, "That is not a GitHub username.");
  if (await isHidden(deps, login)) throw new SiteError(404, `@${login} has chosen to stay out of comparisons.`);
  const p = await readProfile(deps, reader, login, true);
  const engine = await survivingTotal(deps.db, login);
  return { p, engine };
}

function side(p: Profile, surviving: number | null): VersusSide {
  return { identity: { login: p.identity.login, name: p.identity.name }, totals: p.totals, surviving };
}

/** One side of a comparison from what is stored: a person's public Profile and their counted Surviving Lines; a hidden person is refused. */
export async function sideOf(deps: ProfileDeps, login: string): Promise<VersusSide> {
  const { p, engine } = await read(deps, login, STORED_ONLY);
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

/** Two people side by side in full: each view's winner, then their years, languages, hours, traits and the repositories they share; read from GitHub by `reader` when not stored. */
export async function versusFullOf(deps: ProfileDeps, a: string, b: string, reader: ProfileViewer = STORED_ONLY): Promise<VersusFull> {
  if (a.toLowerCase() === b.toLowerCase()) throw new SiteError(400, "A Versus needs two different people.");
  const [x, y] = await Promise.all([read(deps, a, reader), read(deps, b, reader)]);
  const [sa, sb] = [side(x.p, x.engine?.surviving ?? null), side(y.p, y.engine?.surviving ?? null)];
  return { a: sa, b: sb, rows: versusRows(sa, sb), people: { a: personOf(x.p, x.engine), b: personOf(y.p, y.engine) }, shared: sharedRepositories(x.p.repositories, y.p.repositories), between: betweenOf(x.p, y.p) };
}

export type Versus = { a: VersusSide; b: VersusSide; rows: VersusRow[] };

/** Two people side by side from what is stored, with a winner for each view and none overall. */
export async function versusOf(deps: ProfileDeps, a: string, b: string): Promise<Versus> {
  if (a.toLowerCase() === b.toLowerCase()) throw new SiteError(400, "A Versus needs two different people.");
  const [x, y] = await Promise.all([sideOf(deps, a), sideOf(deps, b)]);
  return { a: x, b: y, rows: versusRows(x, y) };
}
