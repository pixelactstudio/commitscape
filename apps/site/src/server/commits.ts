import "@tanstack/react-start/server-only";
import type { CommitPage, CommitQuery } from "@commitscape/data";
import { commitPage, sha256 } from "@commitscape/server";
import { SiteError } from "./http";
import { readable, type Deps, type Viewer } from "./repos";

export type CommitAsk = CommitQuery & { at?: number; cursor?: string };

export type CommitAnswer = { page: CommitPage | null; etag: string; cacheControl: string };

export const COMMITS_UNAVAILABLE = "This Report was built before its commits were kept apart: they show once it is built again.";

const INTEGERS = ["at", "person", "kind", "from", "to", "limit"] as const;

/** The commits API's query, read from the address; a number that is not one is a 400. */
export function commitAskOf(params: URLSearchParams): CommitAsk {
  const ask: CommitAsk = {};
  for (const name of INTEGERS) {
    const raw = params.get(name);
    if (raw === null || raw === "") continue;
    if (!/^-?\d{1,15}$/.test(raw)) throw new SiteError(400, `${name} must be a whole number.`);
    ask[name] = Number(raw);
  }
  const q = params.get("q")?.trim();
  if (q) ask.q = q.slice(0, 200);
  const cursor = params.get("cursor");
  if (cursor) {
    if (cursor.length > 40) throw new SiteError(400, "That is not a cursor this API gave.");
    ask.cursor = cursor;
  }
  return ask;
}

/** One page of a readable Report's commits, with its ETag and how long it may be kept; no page when `seen` is already its ETag. */
export async function reportCommitPage(deps: Deps, viewer: Viewer, owner: string, name: string, ask: CommitAsk, seen?: string | null): Promise<CommitAnswer> {
  const row = await readable(deps, viewer, owner, name);
  const { at, ...query } = ask;
  const etag = `"${sha256(`${row.reportKey}\n${JSON.stringify(query, Object.keys(query).sort())}`).slice(0, 32)}"`;
  const cacheControl = row.isPrivate ? "private, max-age=60" : at !== undefined && at === row.reportAt ? "public, max-age=31536000, immutable" : "public, max-age=300";
  if (seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return { page: null, etag, cacheControl };
  const page = await commitPage(deps.db, deps.storage, { ...query, repoId: row.id, reportKey: row.reportKey });
  if (!page) throw new SiteError(404, COMMITS_UNAVAILABLE);
  return { page, etag, cacheControl };
}
