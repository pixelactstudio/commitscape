import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { afterCommit, afterOf, pageLimit, seqOf, UNKNOWN_PERSON, wordsOf, type CommitPage, type CommitQuery, type CommitRow, type PersonRef } from "@commitscape/data";
import type { Db } from "./db/client";
import { indexCommitLines, indexCommits, indexPeople, storedIndexes } from "./db/schema";

export const COMMIT_KINDS = ["features", "fixes", "docs", "refactors", "tests", "performance", "style", "build and CI", "chores", "reverts", "other"];

export type IndexCommitAsk = Omit<CommitQuery, "under"> & { si: number; link: string | null; cursor?: string | null; shas?: string[] };

const escaped = (word: string) => word.replace(/[\\%_]/g, (c) => `\\${c}`);

type Who = { signature: number; person: number | null; ref: PersonRef };

async function peopleOf(db: Db, si: number): Promise<Who[]> {
  const rows = await db.select({ signature: indexPeople.signature, person: indexPeople.person, name: indexPeople.personName, colour: indexPeople.colour, login: indexPeople.login }).from(indexPeople).where(eq(indexPeople.si, si));
  return rows.map((r) => ({
    signature: r.signature,
    person: r.person,
    ref: r.person === null ? { id: UNKNOWN_PERSON, name: "someone unknown", colour: null, login: null } : { id: r.person, name: r.name ?? "", colour: r.colour, login: r.login },
  }));
}

function conditions(ask: Omit<IndexCommitAsk, "link">, who: Who[]): SQL[] {
  const signaturesOf = (match: (w: Who) => boolean) => who.filter(match).map((w) => w.signature);
  const inSignatures = (list: number[]) => (list.length === 0 ? sql`false` : sql`${indexCommits.signature} = ANY (${sql.param(list)}::int[])`);
  const time = sql`(${indexCommits.at} + ${indexCommits.authorDelta})`;
  const where: SQL[] = [eq(indexCommits.si, ask.si)];
  if (ask.person !== undefined) where.push(inSignatures(signaturesOf((w) => (ask.person === UNKNOWN_PERSON ? w.person === null : w.person === ask.person))));
  if (ask.kind !== undefined) where.push(eq(indexCommits.kind, ask.kind));
  if (ask.from !== undefined) where.push(sql`${time} >= ${ask.from}`);
  if (ask.to !== undefined) where.push(sql`${time} <= ${ask.to}`);
  if (ask.merges === 0) where.push(sql`(${indexCommits.flags} & 1) = 0`);
  if (ask.shas) where.push(ask.shas.length === 0 ? sql`false` : sql`${indexCommits.sha} = ANY (SELECT decode(x, 'hex') FROM unnest(${sql.param(ask.shas.filter((s) => /^[0-9a-f]+$/.test(s) && s.length % 2 === 0))}::text[]) AS x)`);
  const local = sql`(${time} + ${indexCommits.offset} * 60)`;
  if (ask.since !== undefined) where.push(sql`floor(${local} / 86400) >= ${ask.since}`);
  if (ask.until !== undefined) where.push(sql`floor(${local} / 86400) <= ${ask.until}`);
  if (ask.weekday !== undefined) where.push(sql`mod(floor(${local} / 86400)::bigint + 3, 7) = ${ask.weekday}`);
  if (ask.hour !== undefined) where.push(sql`floor(mod(${local}, 86400) / 3600) = ${ask.hour}`);
  for (const word of wordsOf(ask.q).slice(0, 12)) {
    const subject = ilike(indexCommits.subject, `%${escaped(word)}%`);
    const matched = signaturesOf((w) => `${w.ref.name} ${w.ref.login ?? ""}`.toLowerCase().includes(word));
    where.push(matched.length === 0 ? subject : (or(subject, inSignatures(matched)) as SQL));
  }
  return where;
}

/** One page of a Stored Index's commits, newest first: every word in the subject or in the name or login of who made it, narrowed by person, kind, time and the commits named. */
export async function indexCommitPage(db: Db, ask: IndexCommitAsk): Promise<CommitPage | null> {
  const [index] = await db.select({ commits: storedIndexes.commits, lines: storedIndexes.lines }).from(storedIndexes).where(eq(storedIndexes.id, ask.si));
  if (!index) return null;
  const who = await peopleOf(db, ask.si);
  const where = conditions(ask, who);
  const time = sql`(${indexCommits.at} + ${indexCommits.authorDelta})`;
  const filtered = where.length > 1;
  const after = afterOf(ask.cursor);
  const skip = after ? 0 : (seqOf(ask.cursor) ?? 0);
  const first = !ask.cursor || (!after && skip === 0);
  const limit = pageLimit(ask.limit);
  const page = after ? [...where, sql`(${indexCommits.at}, ${indexCommits.sha}) < (${after.at}::bigint, decode(${after.sha}, 'hex'))`] : where;
  const [rows, total] = await Promise.all([
    db
      .select({
        sha: sql<string>`encode(${indexCommits.sha}, 'hex')`,
        stored: sql<number>`${indexCommits.at}`.mapWith(Number),
        at: sql<number>`${time}::bigint`.mapWith(Number),
        offset: indexCommits.offset,
        signature: indexCommits.signature,
        subject: indexCommits.subject,
        kind: indexCommits.kind,
        flags: indexCommits.flags,
        files: sql<number>`cardinality(${indexCommits.files})`.mapWith(Number),
        added: indexCommitLines.added,
        removed: indexCommitLines.removed,
      })
      .from(indexCommits)
      .leftJoin(indexCommitLines, and(eq(indexCommitLines.si, indexCommits.si), eq(indexCommitLines.sha, indexCommits.sha)))
      .where(and(...page))
      .orderBy(desc(indexCommits.at), desc(indexCommits.sha))
      .offset(skip)
      .limit(limit + 1),
    !first
      ? null
      : filtered
        ? db
            .select({ n: count() })
            .from(indexCommits)
            .where(and(...where))
            .then((r) => r[0]?.n ?? 0)
        : index.commits,
  ]);
  const bySignature = new Map(who.map((w) => [w.signature, w]));
  const unknown: PersonRef = { id: UNKNOWN_PERSON, name: "someone unknown", colour: null, login: null };
  const people: Record<string, PersonRef> = {};
  const shown = rows.slice(0, limit);
  const nextAfter = (list: typeof shown) => {
    const last = list.at(-1);
    return last ? afterCommit(last.stored, last.sha) : null;
  };
  const out = shown.map((r): CommitRow => {
    const p = bySignature.get(r.signature)?.ref ?? unknown;
    people[p.id] = p;
    return {
      sha: r.sha,
      at: r.at,
      offset: r.offset,
      personId: p.id,
      subject: r.subject,
      kind: r.kind,
      merge: (r.flags & 1) !== 0,
      files: r.files,
      added: index.lines ? r.added : null,
      removed: index.lines ? r.removed : null,
    };
  });
  return {
    link: ask.link,
    lines: index.lines,
    kinds: COMMIT_KINDS,
    all: index.commits,
    people,
    rows: out,
    next: rows.length > limit ? nextAfter(shown) : null,
    total,
  };
}

