import "@tanstack/react-start/server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Board, BoardRow, Boards } from "@commitscape/data";
import { now, schema, type Db } from "@commitscape/server";
import { distinctSeeds } from "./people-boards";

const { repositories } = schema;
const ROWS = 25;

let kept: { at: number; boards: Boards } | null = null;

type Repo = typeof repositories.$inferSelect;

/** The Leaderboards, ranked from the seed repositories' last Builds; a renamed or moved repository counts once. */
export async function leaderboards(db: Db, keepFor = 0): Promise<Boards> {
  if (keepFor > 0 && kept && kept.at > now() - keepFor) return kept.boards;
  const built = distinctSeeds(await db.select().from(repositories).where(and(eq(repositories.seed, true), eq(repositories.isPrivate, false), isNotNull(repositories.reportAt))));
  const top = (keep: (r: Repo) => boolean, ...order: ((r: Repo) => number)[]) =>
    built
      .filter(keep)
      .sort((x, y) => {
        for (const o of order) if (o(y) !== o(x)) return o(y) - o(x);
        return x.id.localeCompare(y.id);
      })
      .slice(0, ROWS);
  const of = (v: number | null) => v ?? 0;
  const share = (r: Repo) => (of(r.untouched5y) * 100) / Math.max(1, of(r.codeLines) || 1);
  const onePerson = top((r) => r.busFactor === 1, (r) => of(r.stars));
  const maintainers = top((r) => of(r.maintainers) > 0, (r) => of(r.maintainers), (r) => of(r.stars));
  const byCommits = top((r) => of(r.commits30d) > 0, (r) => of(r.commits30d));
  const byPeople = top((r) => of(r.people30d) > 0, (r) => of(r.people30d), (r) => of(r.commits30d));
  const answers = top((r) => r.answerHours !== null && of(r.answered) >= 10, (r) => -of(r.answerHours));
  const oldest = top((r) => of(r.codeLines) >= 1000 && r.busFactor !== null && of(r.untouched5y) > 0, share);
  const newest = built.reduce((m, r) => Math.max(m, of(r.reportAt)), 0);
  const row = (r: Repo, value: number, shown: string): BoardRow => ({ owner: r.owner, name: r.name, language: r.language, stars: r.stars ?? 0, value, shown });
  const many = (n: number, one: string, more: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : more}`;
  const hours = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
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
      rows: oldest.map((r) => row(r, share(r), `${share(r) < 1 ? "<1" : Math.round(share(r))}% of ${(r.codeLines ?? 0).toLocaleString("en-US")} lines`)),
    },
  ];
  const result: Boards = { builtAt: newest, from: built.length, boards: boards };
  kept = { at: now(), boards: result };
  return result;
}
