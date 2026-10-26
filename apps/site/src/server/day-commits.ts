import "@tanstack/react-start/server-only";
import { and, count, countDistinct, desc, eq, sql } from "drizzle-orm";
import { schema } from "@commitscape/server";
import { SiteError } from "./http";
import { isHidden } from "./people";
import type { Deps } from "./repos";

const { indexCommitLines, indexCommits, indexPeople, repoPeople, repositories } = schema;

export const DAY_COMMITS_SHOWN = 200;

export type DayCommit = { sha: string; subject: string; at: number; offset: number; merge: boolean; added: number | null; removed: number | null };

export type DayCommits = { day: number; repos: { owner: string; name: string; personId: number; commits: DayCommit[] }[]; shown: number; total: number; read: number };

/** A person's commits on one day of their own calendar, in the public repositories the Site has read, newest first and grouped by repository; from the Stored Indexes, never from GitHub. */
export async function commitsOnDay(deps: Pick<Deps, "db">, login: string, day: number): Promise<DayCommits> {
  if (await isHidden(deps, login)) throw new SiteError(404, "This person has chosen to stay out.");
  const who = sql`lower(${repoPeople.login}) = ${login.toLowerCase()}`;
  const [found, [read]] = await Promise.all([
    indexedOnDay(deps, login, day),
    deps.db
      .select({ n: countDistinct(repoPeople.repoId) })
      .from(repoPeople)
      .innerJoin(repositories, and(eq(repositories.id, repoPeople.repoId), eq(repositories.reportKey, repoPeople.reportKey)))
      .where(and(who, eq(repositories.isPrivate, false))),
  ]);
  const repos = new Map<string, DayCommits["repos"][number]>();
  for (const r of found.rows) {
    const k = `${r.owner}/${r.name}`;
    const at = repos.get(k) ?? { owner: r.owner, name: r.name, personId: r.personId, commits: [] };
    at.commits.push({ sha: r.sha, subject: r.subject, at: r.at, offset: r.offset, merge: r.merge, added: r.added, removed: r.removed });
    repos.set(k, at);
  }
  return { day, repos: [...repos.values()], shown: found.rows.length, total: found.total, read: read?.n ?? 0 };
}

type DayRow = { owner: string; name: string; personId: number; sha: string; subject: string; at: number; offset: number; merge: boolean; added: number | null; removed: number | null };

async function indexedOnDay(deps: Pick<Deps, "db">, login: string, day: number): Promise<{ rows: DayRow[]; total: number }> {
  const time = sql`(${indexCommits.at} + ${indexCommits.authorDelta})`;
  const theirs = and(
    sql`lower(${repoPeople.login}) = ${login.toLowerCase()}`,
    eq(repositories.isPrivate, false),
    sql`floor((${time} + ${indexCommits.offset} * 60) / 86400) = ${day}`,
  );
  const base = () =>
    deps.db
      .select({
        owner: repositories.owner,
        name: repositories.name,
        personId: repoPeople.personId,
        sha: sql<string>`encode(${indexCommits.sha}, 'hex')`,
        subject: indexCommits.subject,
        at: sql<number>`${time}::bigint`.mapWith(Number),
        offset: indexCommits.offset,
        merge: sql<boolean>`(${indexCommits.flags} & 1) = 1`,
        added: sql<number | null>`CASE WHEN cardinality(${indexCommits.files}) > 0 THEN ${indexCommitLines.added} END`,
        removed: sql<number | null>`CASE WHEN cardinality(${indexCommits.files}) > 0 THEN ${indexCommitLines.removed} END`,
      })
      .from(repoPeople)
      .innerJoin(repositories, and(eq(repositories.id, repoPeople.repoId), eq(repositories.reportKey, repoPeople.reportKey)))
      .innerJoin(indexPeople, and(eq(indexPeople.si, repositories.indexId), eq(indexPeople.person, repoPeople.personId)))
      .innerJoin(indexCommits, and(eq(indexCommits.si, indexPeople.si), eq(indexCommits.signature, indexPeople.signature)))
      .leftJoin(indexCommitLines, and(eq(indexCommitLines.si, indexCommits.si), eq(indexCommitLines.sha, indexCommits.sha)));
  const [rows, [total]] = await Promise.all([
    base().where(theirs).orderBy(desc(indexCommits.at)).limit(DAY_COMMITS_SHOWN),
    deps.db
      .select({ n: count() })
      .from(repoPeople)
      .innerJoin(repositories, and(eq(repositories.id, repoPeople.repoId), eq(repositories.reportKey, repoPeople.reportKey)))
      .innerJoin(indexPeople, and(eq(indexPeople.si, repositories.indexId), eq(indexPeople.person, repoPeople.personId)))
      .innerJoin(indexCommits, and(eq(indexCommits.si, indexPeople.si), eq(indexCommits.signature, indexPeople.signature)))
      .where(theirs),
  ]);
  return { rows, total: total?.n ?? 0 };
}
