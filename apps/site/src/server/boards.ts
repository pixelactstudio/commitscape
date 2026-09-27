import "@tanstack/react-start/server-only";
import { and, asc, count, desc, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import type { Board, BoardRow, Boards } from "@commitscape/data";
import { now, schema, type Db } from "@commitscape/server";

const { repositories } = schema;
const ROWS = 25;

let kept: { at: number; boards: Boards } | null = null;

type Repo = typeof repositories.$inferSelect;

/** The Leaderboards, ranked from the seed repositories' last Builds. */
export async function leaderboards(db: Db, keepFor = 0): Promise<Boards> {
  if (keepFor > 0 && kept && kept.at > now() - keepFor) return kept.boards;
  const built = and(eq(repositories.seed, true), isNotNull(repositories.reportAt));
  const top = (where: ReturnType<typeof and>, ...order: ReturnType<typeof desc>[]) =>
    db.select().from(repositories).where(where).orderBy(...order).limit(ROWS);
  const [total] = await db.select({ n: count() }).from(repositories).where(built);
  const [onePerson, maintainers, byCommits, byPeople, answers, oldest, newest] = await Promise.all([
    top(and(built, eq(repositories.busFactor, 1)), desc(repositories.stars)),
    top(and(built, gt(repositories.maintainers, 0)), desc(repositories.maintainers), desc(repositories.stars)),
    top(and(built, gt(repositories.commits30d, 0)), desc(repositories.commits30d)),
    top(and(built, gt(repositories.people30d, 0)), desc(repositories.people30d), desc(repositories.commits30d)),
    top(and(built, isNotNull(repositories.answerHours), gte(repositories.answered, 10)), asc(repositories.answerHours)),
    top(
      and(built, gte(repositories.codeLines, 1000), isNotNull(repositories.busFactor)),
      sql`cast(${repositories.untouched5y} as real) / ${repositories.codeLines} desc`,
    ),
    db.select({ at: sql<number>`max(${repositories.reportAt})` }).from(repositories).where(built),
  ]);
  const row = (r: Repo, value: number, shown: string): BoardRow => ({ owner: r.owner, name: r.name, language: r.language, stars: r.stars ?? 0, value, shown });
  const many = (n: number, one: string, more: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : more}`;
  const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
  const share = (r: Repo) => ((r.untouched5y ?? 0) * 100) / Math.max(1, r.codeLines ?? 1);
  const boards: Board[] = [
    {
      id: "one_person",
      title: "Resting on one person",
      how: "Popular projects where one person made over 80% of the last year's commits (a Bus Factor of 1), most stars first.",
      rows: onePerson.map((r) => row(r, r.stars ?? 0, many(r.stars ?? 0, "star", "stars"))),
    },
    {
      id: "maintainers",
      title: "Most maintainers",
      how: "People with 3 or more commits in the last 90 days.",
      rows: maintainers.map((r) => row(r, r.maintainers ?? 0, many(r.maintainers ?? 0, "maintainer", "maintainers"))),
    },
    {
      id: "active_commits",
      title: "Most active this month, by commits",
      how: "Commits that are not merges in the last 30 days.",
      rows: byCommits.map((r) => row(r, r.commits30d ?? 0, many(r.commits30d ?? 0, "commit", "commits"))),
    },
    {
      id: "active_people",
      title: "Most active this month, by people",
      how: "People who made a commit in the last 30 days, bots left out.",
      rows: byPeople.map((r) => row(r, r.people30d ?? 0, many(r.people30d ?? 0, "person", "people"))),
    },
    {
      id: "answers",
      title: "Fastest to answer issues",
      how: "The middle time from an issue opening to its first answer by someone else, among the last hundred issues; 10 or more answered.",
      rows: answers.map((r) => row(r, r.answerHours ?? 0, hours(r.answerHours ?? 0))),
    },
    {
      id: "oldest_code",
      title: "Oldest code still running",
      how: "The share of today's lines of code in files nobody has changed for five years, in projects with commits in the last year; 1,000 lines or more.",
      rows: oldest.map((r) => row(r, share(r), `${Math.round(share(r))}% of ${(r.codeLines ?? 0).toLocaleString("en-US")} lines`)),
    },
  ];
  const result: Boards = { builtAt: Number(newest[0]?.at ?? 0), from: total?.n ?? 0, boards: boards };
  kept = { at: now(), boards: result };
  return result;
}
