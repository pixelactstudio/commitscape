import { gunzipSync, gzipSync } from "node:zlib";
import { and, asc, count, eq, gt, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { LRUCache } from "lru-cache";
import { cursorOf, pageLimit, seqOf, UNKNOWN_PERSON, wordsOf, type CommitList, type CommitPage, type CommitQuery, type CommitRow, type PersonRef } from "@commitscape/data";
import type { Db } from "./db/client";
import { commits } from "./db/schema";
import type { Storage } from "./storage";

export type CommitsMeta = { link: string | null; lines: boolean; kinds: string[]; count: number; people: PersonRef[] };

export type CommitPageAsk = CommitQuery & { repoId: string; reportKey: string; cursor?: string | null };

const BATCH = 10_000;
const AT_ONCE = 4;
const UNKNOWN_ROW = -1;

export const commitsMetaKey = (reportKey: string) => `${reportKey}/commits-meta.json`;

const toRow = (id: number) => (id === UNKNOWN_PERSON ? UNKNOWN_ROW : id);
const fromRow = (id: number) => (id === UNKNOWN_ROW ? UNKNOWN_PERSON : id);
const escaped = (word: string) => word.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Stores a gzipped Commit List as one row per commit, newest first, and its people and kinds as one object beside the Report. */
export async function storeCommits(db: Db, storage: Storage, repoId: string, reportKey: string, gzipped: Uint8Array): Promise<{ rows: number }> {
  const list = JSON.parse(gunzipSync(gzipped).toString("utf8")) as CommitList;
  const ids = list.people.map((p) => toRow(p.person.id));
  await db.delete(commits).where(and(eq(commits.repoId, repoId), eq(commits.reportKey, reportKey)));
  const n = list.ids.length;
  const batch = (start: number) => {
    const end = Math.min(n, start + BATCH);
    const seqs: number[] = [];
    for (let i = start; i < end; i++) seqs.push(i);
    const of = <T>(values: T[], type: string) => sql`${sql.param(values.slice(start, end))}::${sql.raw(type)}[]`;
    const rows = sql`unnest(${sql.param(seqs)}::int[], ${of(list.ids, "text")}, ${of(list.times, "bigint")}, ${of(list.offsets, "smallint")}, ${sql.param(list.person.slice(start, end).map((p) => ids[p] ?? UNKNOWN_ROW))}::int[], ${of(list.subjects, "text")}, ${of(list.kind, "smallint")}, ${of(list.merge, "boolean")}, ${of(list.files, "int")}, ${of(list.added, "int")}, ${of(list.removed, "int")}) as u(seq, sha, at, "offset", person_id, subject, kind, merge, files, added, removed)`;
    return db.insert(commits).select((qb) =>
      qb
        .select({
          repoId: sql<string>`${repoId}::text`.as("repo_id"),
          reportKey: sql<string>`${reportKey}::text`.as("report_key"),
          seq: sql<number>`u.seq`.as("seq"),
          sha: sql<string>`u.sha`.as("sha"),
          at: sql<number>`u.at`.as("at"),
          offset: sql<number>`u."offset"`.as("offset"),
          personId: sql<number>`u.person_id`.as("person_id"),
          subject: sql<string>`u.subject`.as("subject"),
          kind: sql<number>`u.kind`.as("kind"),
          merge: sql<boolean>`u.merge`.as("merge"),
          files: sql<number>`u.files`.as("files"),
          added: sql<number | null>`u.added`.as("added"),
          removed: sql<number | null>`u.removed`.as("removed"),
        })
        .from(rows),
    );
  };
  for (let start = 0; start < n; start += BATCH * AT_ONCE) {
    const starts: number[] = [];
    for (let s = start; s < Math.min(n, start + BATCH * AT_ONCE); s += BATCH) starts.push(s);
    await Promise.all(starts.map(batch));
  }
  const meta: CommitsMeta = { link: list.link, lines: list.lines, kinds: list.kinds, count: n, people: list.people.map((p) => p.person) };
  await storage.put(commitsMetaKey(reportKey), gzipSync(JSON.stringify(meta)), { type: "application/json", encoding: "gzip" });
  metas.delete(reportKey);
  return { rows: n };
}

/** Deletes a repository's commit rows of every Report but `keep`. */
export async function dropCommits(db: Db, repoId: string, keep: string): Promise<void> {
  await db.delete(commits).where(and(eq(commits.repoId, repoId), ne(commits.reportKey, keep)));
}

const metas = new LRUCache<string, { meta: CommitsMeta; who: string[] }>({ max: 200 });

/** A stored Report's commit people and kinds, or null when it was stored before commits were rows. */
export async function readCommitsMeta(storage: Storage, reportKey: string): Promise<{ meta: CommitsMeta; who: string[] } | null> {
  const hit = metas.get(reportKey);
  if (hit) return hit;
  const object = await storage.get(commitsMetaKey(reportKey));
  if (!object) return null;
  const meta = JSON.parse((object.encoding === "gzip" ? gunzipSync(object.body) : Buffer.from(object.body)).toString("utf8")) as CommitsMeta;
  const found = { meta, who: meta.people.map((p) => `${p.name} ${p.login ?? ""}`.toLowerCase()) };
  metas.set(reportKey, found);
  return found;
}

/** One page of a stored Report's commits, newest first: every word in the subject or in the name or login of who made it, narrowed by person, kind and time; null when the Report has no commit rows. */
export async function commitPage(db: Db, storage: Storage, ask: CommitPageAsk): Promise<CommitPage | null> {
  const stored = await readCommitsMeta(storage, ask.reportKey);
  if (!stored) return null;
  const { meta, who } = stored;
  const where: SQL[] = [eq(commits.repoId, ask.repoId), eq(commits.reportKey, ask.reportKey)];
  if (ask.person !== undefined) where.push(eq(commits.personId, toRow(ask.person)));
  if (ask.kind !== undefined) where.push(eq(commits.kind, ask.kind));
  if (ask.from !== undefined) where.push(gte(commits.at, ask.from));
  if (ask.to !== undefined) where.push(lte(commits.at, ask.to));
  for (const word of wordsOf(ask.q).slice(0, 12)) {
    const subject = ilike(commits.subject, `%${escaped(word)}%`);
    const people = meta.people.flatMap((p, i) => ((who[i] ?? "").includes(word) ? [toRow(p.id)] : []));
    where.push(people.length === 0 ? subject : (or(subject, sql`${commits.personId} = any(${`{${people.join(",")}}`}::int[])`) as SQL));
  }
  const filtered = where.length > 2;
  const seq = seqOf(ask.cursor);
  const limit = pageLimit(ask.limit);
  const [rows, total] = await Promise.all([
    db
      .select({
        seq: commits.seq,
        sha: commits.sha,
        at: commits.at,
        offset: commits.offset,
        personId: commits.personId,
        subject: commits.subject,
        kind: commits.kind,
        merge: commits.merge,
        files: commits.files,
        added: commits.added,
        removed: commits.removed,
      })
      .from(commits)
      .where(and(...where, seq === null ? undefined : gt(commits.seq, seq)))
      .orderBy(asc(commits.seq))
      .limit(limit + 1),
    seq !== null
      ? null
      : filtered
        ? db
            .select({ n: count() })
            .from(commits)
            .where(and(...where))
            .then((r) => r[0]?.n ?? 0)
        : meta.count,
  ]);
  const shown = rows.slice(0, limit);
  const byId = new Map(meta.people.map((p) => [p.id, p]));
  const people: Record<string, PersonRef> = {};
  const out = shown.map((r): CommitRow => {
    const personId = fromRow(r.personId);
    const p = byId.get(personId);
    if (p) people[personId] = p;
    return { sha: r.sha, at: r.at, offset: r.offset, personId, subject: r.subject, kind: r.kind, merge: r.merge, files: r.files, added: r.added, removed: r.removed };
  });
  const last = shown.at(-1);
  return {
    link: meta.link,
    lines: meta.lines,
    kinds: meta.kinds,
    all: meta.count,
    people,
    rows: out,
    next: rows.length > limit && last ? cursorOf(last.seq) : null,
    total,
  };
}
