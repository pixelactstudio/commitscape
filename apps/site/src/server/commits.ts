import "@tanstack/react-start/server-only";
import { pageLimit, seqOf, UNKNOWN_PERSON, wordsOf, type CommitPage, type CommitQuery } from "@commitscape/data";
import type { IndexView } from "@commitscape/data/answers";
import { afterCommit, afterOf, indexCommitPage, indexCommitShas, sha256 } from "@commitscape/server";
import { stampOf, underOf, viewOf } from "./answers";
import { SiteError } from "./http";
import { readable, type Deps, type Viewer } from "./repos";

export type CommitAsk = CommitQuery & { at?: number; cursor?: string };

export type CommitAnswer = { page: CommitPage | null; etag: string; cacheControl: string };

export const COMMITS_UNAVAILABLE = "This repository's commits show once it is built again.";

const INTEGERS = ["at", "person", "kind", "from", "to", "since", "until", "weekday", "hour", "merges", "limit"] as const;

const CURSOR = /^(?:[A-Za-z0-9_-]{1,40}|-?[0-9a-z]{1,12}\.[0-9a-f]{40,64})$/;

/** The commits API's query, read from the address; a number that is not one is a 400. */
export function commitAskOf(params: URLSearchParams): CommitAsk {
  const ask: CommitAsk = {};
  for (const name of INTEGERS) {
    const raw = params.get(name);
    if (raw === null || raw === "") continue;
    if (!/^-?\d{1,15}$/.test(raw)) throw new SiteError(400, `${name} must be a whole number.`);
    ask[name] = Number(raw) as never;
  }
  if (ask.merges !== undefined && ask.merges !== 0 && ask.merges !== 1) throw new SiteError(400, "merges must be 0 or 1.");
  if (ask.weekday !== undefined && (ask.weekday < 0 || ask.weekday > 6)) throw new SiteError(400, "weekday must be 0 (Monday) to 6.");
  if (ask.hour !== undefined && (ask.hour < 0 || ask.hour > 23)) throw new SiteError(400, "hour must be 0 to 23.");
  const q = params.get("q")?.trim();
  if (q) ask.q = q.slice(0, 200);
  const under = params.get("under");
  if (under !== null) {
    if (under.length > 1000 || under.includes("\0")) throw new SiteError(400, "under must be a path.");
    if (under !== "") ask.under = under;
  }
  const cursor = params.get("cursor");
  if (cursor) {
    if (!CURSOR.test(cursor)) throw new SiteError(400, "That is not a cursor this API gave.");
    ask.cursor = cursor;
  }
  return ask;
}

function matcher(v: IndexView, q: CommitQuery): (c: number) => boolean {
  const tests: ((c: number) => boolean)[] = [];
  const time = (c: number) => (v.time[c] ?? 0) + (v.authorDelta[c] ?? 0);
  const local = (c: number) => time(c) + (v.offset[c] ?? 0) * 60;
  if (q.person !== undefined) tests.push(q.person === UNKNOWN_PERSON ? (c) => (v.person[c] ?? -1) < 0 : (c) => v.person[c] === q.person);
  if (q.kind !== undefined) tests.push((c) => v.kind[c] === q.kind);
  if (q.from !== undefined) tests.push((c) => time(c) >= (q.from ?? 0));
  if (q.to !== undefined) tests.push((c) => time(c) <= (q.to ?? 0));
  if (q.since !== undefined) tests.push((c) => Math.floor(local(c) / 86_400) >= (q.since ?? 0));
  if (q.until !== undefined) tests.push((c) => Math.floor(local(c) / 86_400) <= (q.until ?? 0));
  if (q.weekday !== undefined) tests.push((c) => (Math.floor(local(c) / 86_400) + 3) % 7 === q.weekday);
  if (q.hour !== undefined) tests.push((c) => Math.floor((local(c) % 86_400) / 3600) === q.hour);
  return (c) => tests.every((t) => t(c));
}

const below = (v: IndexView, c: number, at: number, sha: string) => (v.time[c] ?? 0) < at || ((v.time[c] ?? 0) === at && (v.ids[c] ?? "") < sha);

async function pageUnder(deps: Deps, si: number, view: IndexView, path: string, query: CommitQuery, cursor: string | undefined, link: string): Promise<CommitPage | null> {
  const limit = pageLimit(query.limit);
  const keep = matcher(view, query);
  const said = wordsOf(query.q).length > 0 ? new Set(await indexCommitShas(deps.db, { si, q: query.q })) : null;
  const matched = underOf(view, path).filter((c) => keep(c) && (!said || said.has(view.ids[c] ?? "")));
  const after = afterOf(cursor);
  let start = 0;
  if (after) {
    let lo = 0;
    let hi = matched.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (below(view, matched[mid] ?? 0, after.at, after.sha)) hi = mid;
      else lo = mid + 1;
    }
    start = lo;
  } else start = seqOf(cursor) ?? 0;
  const shown = matched.slice(start, start + limit);
  const page = await indexCommitPage(deps.db, { si, link, shas: shown.map((c) => view.ids[c] ?? ""), limit: Math.max(1, shown.length) });
  if (!page) return null;
  const last = shown.at(-1);
  return { ...page, total: matched.length, next: start + limit < matched.length && last !== undefined ? afterCommit(view.time[last] ?? 0, view.ids[last] ?? "") : null };
}

/** One page of a readable Report's commits, with its ETag and how long it may be kept; no page when `seen` is already its ETag. Commits under a path are found in the Stored Index held in memory, their words in Postgres. */
export async function reportCommitPage(deps: Deps, viewer: Viewer, owner: string, name: string, ask: CommitAsk, seen?: string | null): Promise<CommitAnswer> {
  const row = await readable(deps, viewer, owner, name);
  const { at, under, cursor, ...query } = ask;
  if (row.indexId === null) throw new SiteError(404, COMMITS_UNAVAILABLE);
  const pinned = at !== undefined && at === row.reportAt;
  const stamp = await stampOf(deps.db, row.indexId, pinned ? (row.reportAt ?? undefined) : undefined);
  if (stamp === null) throw new SiteError(404, COMMITS_UNAVAILABLE);
  const keyed = { ...query, ...(under === undefined ? {} : { under }), ...(cursor === undefined ? {} : { cursor }) };
  const etag = `"${sha256(`${row.indexId}@${stamp}\n${JSON.stringify(keyed, Object.keys(keyed).sort())}`).slice(0, 32)}"`;
  const cacheControl = row.isPrivate ? "private, max-age=60" : pinned ? "public, max-age=31536000, immutable" : "public, max-age=300";
  if (seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return { page: null, etag, cacheControl };
  const link = `https://github.com/${row.owner}/${row.name}/commit/`;
  let page: CommitPage | null;
  if (under === undefined) page = await indexCommitPage(deps.db, { ...query, cursor, si: row.indexId, link });
  else {
    const view = await viewOf(deps.db, row.indexId);
    if (!view) throw new SiteError(404, COMMITS_UNAVAILABLE);
    page = await pageUnder(deps, row.indexId, view, under, query, cursor, link);
  }
  if (!page) throw new SiteError(404, COMMITS_UNAVAILABLE);
  return { page, etag, cacheControl };
}
