import "@tanstack/react-start/server-only";
import { and, eq, inArray } from "drizzle-orm";
import { rawBase, type CodeLog, type CodePull, type CodeStory, type PullState } from "@commitscape/data";
import { schema } from "@commitscape/server";
import { withPack } from "./answers";
import { gitOf, NO_GIT } from "./git";
import { SiteError } from "./http";
import type { Deps, Viewer } from "./repos";

const { pullRequests, storedIndexes } = schema;

const checked = (path: string) => {
  if (path.length > 1000 || path.includes("\0")) throw new SiteError(400, "That is not a path.");
  return path === "/" ? "" : path;
};

/** The story of a file or folder at HEAD for the Code window's header, from the engine service, with where its text can be read and the other paths a file had. */
export async function codeStory(deps: Deps, viewer: Viewer, owner: string, name: string, asked: string): Promise<CodeStory> {
  const path = checked(asked);
  const { row, git } = await gitOf(deps, viewer, owner, name);
  const [made, [index]] = await Promise.all([
    withPack(deps.db, row.indexId, (pack) => deps.engine.story(pack, path), row.reportAt),
    deps.db.select({ head: storedIndexes.head }).from(storedIndexes).where(eq(storedIndexes.id, row.indexId ?? 0)),
  ]);
  if (!made) throw new SiteError(404, NO_GIT);
  const head = index?.head ?? git.head;
  return { ...made.value, head, raw: row.isPrivate ? null : rawBase(row.owner, row.name, head) };
}

const STATES: Record<string, PullState> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };

/** One page of every commit that touched a file or folder at HEAD, newest first, merges left out: its lines there, its kind, and the pull request its subject names. */
export async function codeLog(deps: Deps, viewer: Viewer, owner: string, name: string, asked: string, page: number): Promise<CodeLog> {
  const path = checked(asked);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new SiteError(400, "That is not a page.");
  const { row } = await gitOf(deps, viewer, owner, name);
  const made = await withPack(deps.db, row.indexId, (pack) => deps.engine.codeLog(pack, path, page), row.reportAt);
  if (!made) throw new SiteError(404, NO_GIT);
  const log = made.value;
  const wantedPulls = [...new Set(log.commits.flatMap((c) => (c.pull ? [c.pull.number] : [])))];
  const pulls = new Map<number, CodePull>();
  if (wantedPulls.length > 0) {
    const rows = await deps.db.select({ number: pullRequests.number, title: pullRequests.title, state: pullRequests.state }).from(pullRequests).where(and(eq(pullRequests.repoId, row.id), inArray(pullRequests.number, wantedPulls)));
    for (const r of rows) pulls.set(r.number, { number: r.number, title: r.title, state: STATES[r.state] ?? null });
  }
  return { ...log, commits: log.commits.map((c) => (c.pull ? { ...c, pull: pulls.get(c.pull.number) ?? c.pull } : c)) };
}
