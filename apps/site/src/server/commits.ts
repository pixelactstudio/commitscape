import "@tanstack/react-start/server-only";
import { wordsOf, type CommitPage, type CommitQuery } from "@commitscape/data";
import { indexCommitPage, indexCommitShas, sha256 } from "@commitscape/server";
import { packOf, withPack } from "./answers";
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

async function pageUnder(deps: Deps, si: number, pack: string, path: string, query: CommitQuery, cursor: string | undefined, link: string): Promise<CommitPage | null> {
  const said = wordsOf(query.q).length > 0 ? await indexCommitShas(deps.db, { si, q: query.q }) : null;
  const { shas, total, next } = await deps.engine.under(pack, path, query, cursor, said);
  const page = await indexCommitPage(deps.db, { si, link, shas, limit: Math.max(1, shas.length) });
  if (!page) return null;
  return { ...page, total, next };
}

/** One page of a readable Report's commits, with its ETag and how long it may be kept; no page when `seen` is already its ETag. Commits under a path are found by the engine service, their words and rows in Postgres. */
export async function reportCommitPage(deps: Deps, viewer: Viewer, owner: string, name: string, ask: CommitAsk, seen?: string | null): Promise<CommitAnswer> {
  const row = await readable(deps, viewer, owner, name);
  const { at, under, cursor, ...query } = ask;
  const si = row.indexId;
  if (si === null) throw new SiteError(404, COMMITS_UNAVAILABLE);
  const pinned = at !== undefined && at === row.reportAt;
  const pack = await packOf(deps.db, si, { after: row.reportAt });
  if (pack === null && under !== undefined) throw new SiteError(404, COMMITS_UNAVAILABLE);
  const keyed = { ...query, ...(under === undefined ? {} : { under }), ...(cursor === undefined ? {} : { cursor }) };
  const etag = `"${sha256(`${pack ?? `${si}@${row.reportAt ?? 0}`}\n${JSON.stringify(keyed, Object.keys(keyed).sort())}`).slice(0, 32)}"`;
  const cacheControl = row.isPrivate ? "private, max-age=60" : pinned ? "public, max-age=31536000, immutable" : "public, max-age=300";
  if (seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return { page: null, etag, cacheControl };
  const link = `https://github.com/${row.owner}/${row.name}/commit/`;
  let page: CommitPage | null;
  if (under === undefined) page = await indexCommitPage(deps.db, { ...query, cursor, si, link });
  else {
    const made = await withPack(deps.db, si, (p) => pageUnder(deps, si, p, under, query, cursor, link), row.reportAt);
    if (!made) throw new SiteError(404, COMMITS_UNAVAILABLE);
    page = made.value;
  }
  if (!page) throw new SiteError(404, COMMITS_UNAVAILABLE);
  return { page, etag, cacheControl };
}
