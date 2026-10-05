import "@tanstack/react-start/server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, notLike, sql } from "drizzle-orm";
import { previousSeason, seasonDates, seasonOf } from "@commitscape/data";
import { schema, type Db } from "@commitscape/server";
import { hiddenAmong } from "./people";

const { pullRequests, pullReviews, repoPeople, repositories, surviving } = schema;

export const BOARD_ROWS = 25;

export const WINDOWS = [
  ["season", "This Season"],
  ["last-season", "Last Season"],
  ["90d", "The last 90 days"],
  ["all", "All time"],
] as const;
export type BoardWindow = (typeof WINDOWS)[number][0];

export type PersonRow = { login: string; value: number; repositories: number; place: number };
export type PeopleBoard = { id: "merged" | "reviews" | "surviving"; title: string; how: string; unit: [string, string]; short: [string, string]; rows: PersonRow[] };
export type SeedRepo = { id: string; owner: string; name: string; language: string | null; stars: number; readAt: number };
export type PeopleBoards = { window: BoardWindow; from: string | null; to: string | null; today: string; repo: string | null; repositories: SeedRepo[]; waiting: number; boards: PeopleBoard[] };

/** The first and last day of a board's window on UTC's calendar, or none for all time. */
export function windowDates(window: BoardWindow, today: Date = new Date()): { from: string | null; to: string | null } {
  const season = seasonOf(today);
  if (window === "season") return seasonDates(season);
  if (window === "last-season") return seasonDates(previousSeason(season));
  if (window === "90d") return { from: new Date(today.getTime() - 89 * 86_400_000).toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
  return { from: null, to: null };
}

const seconds = (day: string, end = false) => Math.floor(Date.parse(`${day}T${end ? "23:59:59" : "00:00:00"}Z`) / 1000);

type Seed = { id: string; owner: string; name: string; githubId: number | null; language: string | null; stars: number | null; reportAt: number | null; pullsReadAt: number | null };

/** The seed repositories the people boards count, one row per GitHub repository: a renamed or moved one keeps only its newest read. */
export function distinctSeeds<T extends Pick<Seed, "githubId" | "reportAt">>(rows: T[]): T[] {
  const newest = new Map<number, T>();
  for (const r of rows) if (r.githubId !== null && (r.reportAt ?? 0) > (newest.get(r.githubId)?.reportAt ?? -1)) newest.set(r.githubId, r);
  return rows.filter((r) => r.githubId === null || newest.get(r.githubId) === r);
}

/** Places on a board, ties sharing a place: 1, 2, 2, 4. */
export function placed<T extends { value: number }>(rows: T[]): (T & { place: number })[] {
  return rows.map((r) => ({ ...r, place: rows.findIndex((x) => x.value === r.value) + 1 }));
}

/** People ranked across the seed repositories, or within one of them, by merged pull requests and by reviews in a window, and by lines that still run; hidden people and bots left out, ties sharing a place. */
export async function peopleBoards(db: Db, window: BoardWindow, repo: string | null = null, today: Date = new Date()): Promise<PeopleBoards> {
  const { from, to } = windowDates(window, today);
  const all = await db
    .select({ id: repositories.id, owner: repositories.owner, name: repositories.name, githubId: repositories.githubId, language: repositories.language, stars: repositories.stars, reportAt: repositories.reportAt, pullsReadAt: repositories.pullsReadAt })
    .from(repositories)
    .where(and(eq(repositories.seed, true), eq(repositories.isPrivate, false)))
    .orderBy(repositories.id);
  const seeds = distinctSeeds(all.filter((s) => s.reportAt !== null)).sort((x, y) => (y.stars ?? 0) - (x.stars ?? 0) || x.id.localeCompare(y.id));
  const waiting = distinctSeeds(all).filter((s) => s.reportAt === null).length;
  const chosen = repo ? seeds.find((s) => s.id === repo.toLowerCase()) : null;
  const ids = chosen ? [chosen.id] : seeds.map((s) => s.id);
  const where = chosen ? `${chosen.owner}/${chosen.name}` : `the ${seeds.length} repositories counted`;
  const boards = (rows: { merged: PersonRow[]; reviews: PersonRow[]; surviving: PersonRow[] }): PeopleBoard[] => [
    { id: "merged", title: "Most pull requests merged", how: `Pull requests merged into ${where} in the window.`, unit: ["pull request merged", "pull requests merged"], short: ["merged", "merged"], rows: rows.merged },
    { id: "reviews", title: "Most pull requests reviewed", how: `Other people's pull requests in ${where} reviewed in the window, each counted once.`, unit: ["pull request reviewed", "pull requests reviewed"], short: ["reviewed", "reviewed"], rows: rows.reviews },
    { id: "surviving", title: "Most lines still running", how: `Lines of theirs still at the head of ${where}, all time, for the people counted there.`, unit: ["line still running", "lines still running"], short: ["line", "lines"], rows: rows.surviving },
  ];
  const base = {
    window,
    from,
    to,
    today: today.toISOString().slice(0, 10),
    repo: chosen ? `${chosen.owner}/${chosen.name}` : null,
    repositories: seeds.map((s) => ({ id: s.id, owner: s.owner, name: s.name, language: s.language, stars: s.stars ?? 0, readAt: s.pullsReadAt ?? s.reportAt ?? 0 })),
    waiting,
  };
  if (ids.length === 0) return { ...base, boards: boards({ merged: [], reviews: [], surviving: [] }) };
  const mergedIn = and(isNotNull(pullRequests.mergedAt), inArray(pullRequests.repoId, ids), notLike(pullRequests.author, "%[bot]"), from ? gte(pullRequests.mergedAt, seconds(from)) : undefined, to ? lte(pullRequests.mergedAt, seconds(to, true)) : undefined);
  const reviewedIn = and(inArray(pullReviews.repoId, ids), notLike(pullReviews.reviewer, "%[bot]"), from ? gte(pullReviews.firstAt, seconds(from)) : undefined, to ? lte(pullReviews.firstAt, seconds(to, true)) : undefined);
  const top = BOARD_ROWS * 3;
  const lower = sql<string>`lower(${repoPeople.login})`;
  const [merged, reviewed, lines] = await Promise.all([
    db
      .select({ login: pullRequests.author, value: count(), repos: sql<number>`count(distinct ${pullRequests.repoId})::int` })
      .from(pullRequests)
      .where(mergedIn)
      .groupBy(pullRequests.author)
      .orderBy(desc(count()), asc(pullRequests.author))
      .limit(top),
    db
      .select({ login: pullReviews.reviewer, value: count(), repos: sql<number>`count(distinct ${pullReviews.repoId})::int` })
      .from(pullReviews)
      .where(reviewedIn)
      .groupBy(pullReviews.reviewer)
      .orderBy(desc(count()), asc(pullReviews.reviewer))
      .limit(top),
    db
      .select({ login: lower, value: sql<number>`sum(${surviving.lines})::int`, repos: sql<number>`count(distinct ${surviving.repoId})::int` })
      .from(surviving)
      .innerJoin(repoPeople, and(eq(repoPeople.repoId, surviving.repoId), eq(repoPeople.reportKey, surviving.reportKey), eq(repoPeople.personId, surviving.personId)))
      .innerJoin(repositories, and(eq(repositories.id, surviving.repoId), eq(repositories.reportKey, surviving.reportKey)))
      .where(and(eq(surviving.status, "counted"), isNotNull(repoPeople.login), notLike(lower, "%[bot]"), inArray(surviving.repoId, ids)))
      .groupBy(lower)
      .orderBy(desc(sql`sum(${surviving.lines})`), asc(lower))
      .limit(top),
  ]);
  const hidden = await hiddenAmong({ db }, [...merged, ...reviewed, ...lines].flatMap((r) => (r.login ? [r.login] : [])));
  const keep = (rows: { login: string | null; value: number; repos: number }[]): PersonRow[] =>
    placed(
      rows
        .filter((r): r is { login: string; value: number; repos: number } => !!r.login && !hidden.has(r.login.toLowerCase()) && Number(r.value) > 0)
        .slice(0, BOARD_ROWS)
        .map((r) => ({ login: r.login, value: Number(r.value), repositories: Number(r.repos) })),
    );
  return { ...base, boards: boards({ merged: keep(merged), reviews: keep(reviewed), surviving: keep(lines) }) };
}
