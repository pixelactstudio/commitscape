import "@tanstack/react-start/server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { isLogin, previousSeason, raceState, seasonDates, seasonOf, type CrewView, type Member, type RaceView, type WindowRow, type WindowStandings } from "@commitscape/data";
import { now, randomId, schema, type Db } from "@commitscape/server";
import { graphql, type GraphQL } from "./graphql";
import { SiteError } from "./http";
import { hiddenAmong, isHidden } from "./people";

const { crewMembers, crews, raceMembers, races, seasonStandings } = schema;

export const MEMBERS_MAX = 20;
export const STANDINGS_FOR = 15 * 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type Me = { userId: string; login: string };
export type RaceDeps = { db: Db; github: { api: string; token?: string; fetcher?: typeof fetch } };

/** Everyone's numbers in a window, in one request to GitHub: merged pull requests, reviews, commits and contributions. */
export async function windowStandings(deps: RaceDeps, logins: string[], from: string, to: string, token: string | null = null): Promise<WindowStandings> {
  const people = logins.filter(isLogin);
  if (people.length === 0) return { from, to, at: now(), rows: [] };
  const range = `from: "${from}T00:00:00Z", to: "${to}T23:59:59Z"`;
  const fields = people
    .map(
      (l, i) => `u${i}: user(login: "${l}") { login name contributionsCollection(${range}) { totalCommitContributions totalPullRequestReviewContributions contributionCalendar { totalContributions } } }
p${i}: search(query: "author:${l} is:pr is:merged merged:${from}..${to}", type: ISSUE, first: 0) { issueCount }`,
    )
    .join("\n");
  const gh: GraphQL = { api: deps.github.api, token: token ?? deps.github.token ?? null, fetcher: deps.github.fetcher };
  type U = { login: string; name: string | null; contributionsCollection: { totalCommitContributions: number; totalPullRequestReviewContributions: number; contributionCalendar: { totalContributions: number } } } | null;
  const data = await graphql<Record<string, U | { issueCount: number }>>(gh, `query { ${fields} }`);
  const rows: WindowRow[] = people.flatMap((_, i) => {
    const u = data[`u${i}`] as U;
    if (!u) return [];
    const c = u.contributionsCollection;
    return [{ login: u.login, name: u.name, prsMerged: (data[`p${i}`] as { issueCount: number } | undefined)?.issueCount ?? 0, reviews: c.totalPullRequestReviewContributions, commits: c.totalCommitContributions, contributions: c.contributionCalendar.totalContributions }];
  });
  return { from, to, at: now(), rows };
}

function checkName(name: string): string {
  const n = name.trim();
  if (n.length < 2 || n.length > 60) throw new SiteError(400, "A name of 2 to 60 characters.");
  return n;
}

async function checkInvitees(db: Db, me: Me, logins: string[]): Promise<string[]> {
  const list = [...new Set(logins.map((l) => l.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))].filter((l) => l !== me.login.toLowerCase());
  const bad = list.find((l) => !isLogin(l));
  if (bad) throw new SiteError(400, `@${bad} is not a GitHub username.`);
  const hidden = await hiddenAmong({ db }, list);
  if (hidden.size > 0) throw new SiteError(400, `@${[...hidden][0]} has chosen to stay out of comparisons, so they cannot be invited.`);
  return list;
}

/** Starts a Race between the signed-in person and the people they invite, over at most a year. */
export async function createRace(db: Db, me: Me, input: { name: string; from: string; to: string; invite: string[] }): Promise<string> {
  if (!DATE.test(input.from) || !DATE.test(input.to) || input.to < input.from) throw new SiteError(400, "A Race needs a first and a last day, the last on or after the first.");
  if ((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000 > 366) throw new SiteError(400, "A Race lasts a year at most.");
  const invited = await checkInvitees(db, me, input.invite);
  if (invited.length === 0) throw new SiteError(400, "Invite at least one person.");
  if (invited.length + 1 > MEMBERS_MAX) throw new SiteError(400, `${MEMBERS_MAX} people at most.`);
  const id = randomId();
  await db.insert(races).values({ id, name: checkName(input.name), createdBy: me.userId, from: input.from, to: input.to, createdAt: now() });
  await db.insert(raceMembers).values([
    { raceId: id, login: me.login.toLowerCase(), userId: me.userId, state: "accepted", invitedBy: me.login.toLowerCase(), invitedAt: now(), answeredAt: now() },
    ...invited.map((login) => ({ raceId: id, login, state: "invited", invitedBy: me.login.toLowerCase(), invitedAt: now() })),
  ]);
  return id;
}

/** Starts a Crew of the signed-in person and the people they invite. */
export async function createCrew(db: Db, me: Me, input: { name: string; invite: string[] }): Promise<string> {
  const invited = await checkInvitees(db, me, input.invite);
  if (invited.length + 1 > MEMBERS_MAX) throw new SiteError(400, `${MEMBERS_MAX} people at most.`);
  const id = randomId();
  await db.insert(crews).values({ id, name: checkName(input.name), createdBy: me.userId, createdAt: now() });
  await db.insert(crewMembers).values([
    { crewId: id, login: me.login.toLowerCase(), userId: me.userId, state: "accepted", invitedBy: me.login.toLowerCase(), invitedAt: now(), answeredAt: now() },
    ...invited.map((login) => ({ crewId: id, login, state: "invited", invitedBy: me.login.toLowerCase(), invitedAt: now() })),
  ]);
  return id;
}

type Kind = "race" | "crew";

const table = (kind: Kind) => (kind === "race" ? { members: raceMembers, key: raceMembers.raceId } : { members: crewMembers, key: crewMembers.crewId });

/** Invites more people, by any member who has accepted. */
export async function invite(db: Db, me: Me, kind: Kind, id: string, logins: string[]): Promise<void> {
  const { members, key } = table(kind);
  const rows = await db.select().from(members).where(eq(key, id));
  if (!rows.some((r) => r.login === me.login.toLowerCase() && r.state === "accepted")) throw new SiteError(403, "Only people in it can invite others.");
  const fresh = (await checkInvitees(db, me, logins)).filter((l) => !rows.some((r) => r.login === l));
  if (rows.length + fresh.length > MEMBERS_MAX) throw new SiteError(400, `${MEMBERS_MAX} people at most.`);
  if (fresh.length === 0) return;
  const values = fresh.map((login) => ({ login, state: "invited", invitedBy: me.login.toLowerCase(), invitedAt: now() }));
  if (kind === "race") await db.insert(raceMembers).values(values.map((v) => ({ ...v, raceId: id })));
  else await db.insert(crewMembers).values(values.map((v) => ({ ...v, crewId: id })));
}

/** Accepts or declines an invitation, by the person invited. */
export async function answer(db: Db, me: Me, kind: Kind, id: string, accept: boolean): Promise<void> {
  const { members, key } = table(kind);
  const [row] = await db
    .select()
    .from(members)
    .where(and(eq(key, id), eq(members.login, me.login.toLowerCase())));
  if (!row || row.state === "accepted") throw new SiteError(404, "No invitation of yours here.");
  if (accept && (await isHidden({ db }, me.login))) throw new SiteError(400, "You have chosen to stay out of comparisons; turn that off in Settings to join.");
  await db
    .update(members)
    .set({ state: accept ? "accepted" : "declined", userId: me.userId, answeredAt: now() })
    .where(and(eq(key, id), eq(members.login, me.login.toLowerCase())));
}

/** Leaves a Race or a Crew at once: the person's row is deleted, so they are in no Standings of it from this moment. */
export async function leave(db: Db, me: Me, kind: Kind, id: string): Promise<void> {
  const { members, key } = table(kind);
  await db.delete(members).where(and(eq(key, id), eq(members.login, me.login.toLowerCase())));
}

function membersOf(rows: { login: string; state: string; invitedBy: string }[], me: Me | null, hidden: Set<string>): { members: Member[]; you: Member | null } {
  const all = rows.map((r) => ({ login: r.login, state: r.state as Member["state"], invitedBy: r.invitedBy }));
  const you = me ? (all.find((m) => m.login === me.login.toLowerCase()) ?? null) : null;
  const member = you?.state === "accepted";
  return { members: all.filter((m) => !hidden.has(m.login) && (m.state === "accepted" || (member && m.state === "invited"))), you };
}

/** A Race as anyone sees it: its accepted people and their live Standings, kept for 15 minutes; invitations only to people in it. */
export async function raceOf(deps: RaceDeps, me: Me | null, id: string, token: string | null = null): Promise<RaceView> {
  const [race] = await deps.db.select().from(races).where(eq(races.id, id));
  if (!race) throw new SiteError(404, "There is no Race here.");
  const rows = await deps.db.select().from(raceMembers).where(eq(raceMembers.raceId, id));
  const hidden = await hiddenAmong(deps, rows.map((r) => r.login));
  const { members, you } = membersOf(rows, me, hidden);
  const state = raceState(race.from, race.to);
  const accepted = members.filter((m) => m.state === "accepted").map((m) => m.login);
  let standings: WindowStandings | null = race.standings ? (JSON.parse(race.standings) as WindowStandings) : null;
  const usable = !!standings && sameLogins(standings, accepted);
  const recent = (race.standingsAt ?? 0) > now() - STANDINGS_FOR;
  const final = state === "finished" && (race.standingsAt ?? 0) > Date.parse(`${race.to}T23:59:59Z`) / 1000;
  if (state !== "upcoming" && !(usable && (recent || final))) {
    standings = await windowStandings(deps, accepted, race.from, race.to, token).catch(() => standings);
    if (standings) await deps.db.update(races).set({ standings: JSON.stringify(standings), standingsAt: now() }).where(eq(races.id, id));
  }
  if (standings) standings = { ...standings, rows: standings.rows.filter((r) => accepted.includes(r.login.toLowerCase())) };
  return { id, name: race.name, from: race.from, to: race.to, state, createdBy: rows.find((r) => r.state === "accepted" && r.userId === race.createdBy)?.login ?? "", members, standings: state === "upcoming" ? null : standings, you };
}

function sameLogins(s: WindowStandings, logins: string[]): boolean {
  const have = new Set(s.rows.map((r) => r.login.toLowerCase()));
  return logins.every((l) => have.has(l));
}

async function season(deps: RaceDeps, crewId: string, which: string, logins: string[], token: string | null, done: boolean): Promise<WindowStandings | null> {
  const [kept] = await deps.db
    .select()
    .from(seasonStandings)
    .where(and(eq(seasonStandings.crewId, crewId), eq(seasonStandings.season, which)));
  const keptData = kept ? (JSON.parse(kept.data) as WindowStandings) : null;
  if (keptData && sameLogins(keptData, logins) && (done || kept!.at > now() - STANDINGS_FOR)) return keptData;
  const { from, to } = seasonDates(which);
  const fresh = await windowStandings(deps, logins, from, to, token).catch(() => null);
  if (!fresh) return keptData;
  await deps.db
    .insert(seasonStandings)
    .values({ crewId, season: which, data: JSON.stringify(fresh), at: now() })
    .onConflictDoUpdate({ target: [seasonStandings.crewId, seasonStandings.season], set: { data: JSON.stringify(fresh), at: now() } });
  return fresh;
}

/** A Crew as anyone sees it: its accepted people, this Season's live Standings and last Season's recap. */
export async function crewOf(deps: RaceDeps, me: Me | null, id: string, token: string | null = null): Promise<CrewView> {
  const [crew] = await deps.db.select().from(crews).where(eq(crews.id, id));
  if (!crew) throw new SiteError(404, "There is no Crew here.");
  const rows = await deps.db.select().from(crewMembers).where(eq(crewMembers.crewId, id));
  const hidden = await hiddenAmong(deps, rows.map((r) => r.login));
  const { members, you } = membersOf(rows, me, hidden);
  const accepted = members.filter((m) => m.state === "accepted").map((m) => m.login);
  const now_ = seasonOf();
  const keep = (s: WindowStandings | null) => (s ? { ...s, rows: s.rows.filter((r) => accepted.includes(r.login.toLowerCase())) } : null);
  const [current, last] = await Promise.all([season(deps, id, now_, accepted, token, false), season(deps, id, previousSeason(now_), accepted, token, true)]);
  return { id, name: crew.name, createdBy: rows.find((r) => r.userId === crew.createdBy)?.login ?? "", members, season: now_, standings: keep(current), last: keep(last), you };
}

export type Invitation = { kind: Kind; id: string; name: string; invitedBy: string };

/** The signed-in person's Races and Crews, and the invitations waiting for them. */
export async function mineOf(db: Db, me: Me): Promise<{ races: { id: string; name: string; from: string; to: string }[]; crews: { id: string; name: string }[]; invitations: Invitation[] }> {
  const login = me.login.toLowerCase();
  const [rm, cm] = await Promise.all([
    db.select().from(raceMembers).where(and(eq(raceMembers.login, login), or(eq(raceMembers.state, "accepted"), eq(raceMembers.state, "invited")))),
    db.select().from(crewMembers).where(and(eq(crewMembers.login, login), or(eq(crewMembers.state, "accepted"), eq(crewMembers.state, "invited")))),
  ]);
  const rs = rm.length > 0 ? await db.select().from(races).where(inArray(races.id, rm.map((r) => r.raceId))) : [];
  const cs = cm.length > 0 ? await db.select().from(crews).where(inArray(crews.id, cm.map((r) => r.crewId))) : [];
  const invitations: Invitation[] = [
    ...rm.filter((r) => r.state === "invited").map((r) => ({ kind: "race" as const, id: r.raceId, name: rs.find((x) => x.id === r.raceId)?.name ?? "", invitedBy: r.invitedBy })),
    ...cm.filter((r) => r.state === "invited").map((r) => ({ kind: "crew" as const, id: r.crewId, name: cs.find((x) => x.id === r.crewId)?.name ?? "", invitedBy: r.invitedBy })),
  ];
  return {
    races: rs.filter((r) => rm.some((m) => m.raceId === r.id && m.state === "accepted")).map((r) => ({ id: r.id, name: r.name, from: r.from, to: r.to })),
    crews: cs.filter((c) => cm.some((m) => m.crewId === c.id && m.state === "accepted")).map((c) => ({ id: c.id, name: c.name })),
    invitations,
  };
}
