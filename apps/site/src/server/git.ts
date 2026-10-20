import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import { rawBase, type FolderLast, type GitBranchInsight, type GitStatus, type PathCommit, type PathHistory } from "@commitscape/data";
import { gitCoupling, gitLog, gitTree, lastInFolder, monthsOf, personRef, type IndexView } from "@commitscape/data/answers";
import { gitFileKey, gitPullKey, readBlobs, readBranchDetail, readBranchInsight, readBranches, readGitObject, readOpenBranches, schema, sha256, subjectsOf, type StoredObject } from "@commitscape/server";
import { indexFile, inTurn, keptFile, stampOf, underOf, viewOf } from "./answers";
import { SiteError } from "./http";
import type { Packed } from "./packed";
import { readable, type Deps, type Row, type Viewer } from "./repos";

const { pullRequests, repoGit, storedIndexes } = schema;

export const NO_GIT = "This repository's files, branches and pull requests are read at its next Build.";
const NO_HISTORY = "This repository's history is read at its next Build.";

const FILES = /^(tree|coupling|log|branches|pulls)\.json$|^pull-(\d{1,8})\.json$|^branch-(\d{1,5})\.json$/;
const YEAR = 31_536_000;

export type GitRepo = { row: Row & { reportKey: string }; git: typeof repoGit.$inferSelect };

/** A readable repository's row and the git data kept for it, or a 404 when none is. */
export async function gitOf(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<GitRepo> {
  const row = await readable(deps, viewer, owner, name);
  const [git] = await deps.db.select().from(repoGit).where(eq(repoGit.repoId, row.id));
  if (!git) throw new SiteError(404, NO_GIT);
  return { row, git };
}

/** What git data a repository the viewer may read has, or null when it has none yet. */
export async function gitStatus(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<GitStatus | null> {
  try {
    const { row, git } = await gitOf(deps, viewer, owner, name);
    const [openBranches, [pulls]] = await Promise.all([
      readOpenBranches(deps.db, row.id),
      deps.db.select({ open: sql<number>`(count(*) filter (where ${pullRequests.state} = 'OPEN'))::int`, total: sql<number>`count(*)::int` }).from(pullRequests).where(eq(pullRequests.repoId, row.id)),
    ]);
    return { builtAt: git.builtAt, head: git.head, branch: git.branch, branches: git.branches, branchesTotal: git.branchesTotal, openBranches, openPulls: pulls?.open ?? 0, pullsTotal: pulls?.total ?? 0, tags: git.tags, tagsTotal: git.tagsTotal, files: git.files, stored: git.stored, pulls: git.pulls, bytes: git.bytes, logged: git.logged, complete: git.complete };
  } catch (e) {
    if (e instanceof SiteError && e.status === 404) return null;
    throw e;
  }
}

export type Served = { packed?: Packed | null; object: StoredObject | null; etag: string; cacheControl: string };

const matches = (seen: string | null | undefined, etag: string) => !!seen && seen.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

async function fromIndex(deps: Deps, row: GitRepo["row"], git: GitRepo["git"], file: "tree" | "coupling"): Promise<Packed> {
  const indexId = row.indexId;
  if (indexId === null) throw new SiteError(404, NO_GIT);
  const made = await indexFile(deps.db, indexId, `${file}:${git.builtAt}`, async (view) => {
    if (file === "coupling") return inTurn(() => gitCoupling(view));
    const [blobs, [si]] = await Promise.all([readBlobs(deps.db, row.id), deps.db.select({ head: storedIndexes.head }).from(storedIndexes).where(eq(storedIndexes.id, indexId))]);
    const head = si?.head ?? git.head;
    return inTurn(() => gitTree(view, blobs, { builtAt: git.builtAt, head, branch: git.branch, raw: row.isPrivate ? null : rawBase(row.owner, row.name, head) }));
  });
  if (!made) throw new SiteError(404, NO_GIT);
  return made.packed;
}

/** One JSON file of a repository's git data: the tree and Change Coupling worked out from its Stored Index, its branches from their rows, each packed once per build; its pull requests as stored. Kept for a year when the address names the build it is of. */
export async function gitFile(deps: Deps, viewer: Viewer, owner: string, name: string, file: string, version: number | null, seen?: string | null): Promise<Served> {
  if (!FILES.test(file)) throw new SiteError(404, "No such file.");
  if (file === "log.json") return commitLog(deps, viewer, owner, name, version, seen);
  const { row, git } = await gitOf(deps, viewer, owner, name);
  const stamp = `${git.builtAt}-${row.indexId ?? 0}`;
  const etag = `"${stamp}-${file}"`;
  const pinned = version !== null && version === git.builtAt;
  const cacheControl = row.isPrivate ? "private, max-age=300" : pinned ? `public, max-age=${YEAR}, immutable` : "public, max-age=60";
  const sent = (packed: Packed): Served => ({ packed, object: null, etag, cacheControl });
  if (matches(seen, etag)) return { packed: null, object: null, etag, cacheControl };
  if (file === "tree.json" || file === "coupling.json") return sent(await fromIndex(deps, row, git, file === "tree.json" ? "tree" : "coupling"));
  if (file === "branches.json") {
    const branches = await keptFile(`git:${row.id}@${git.builtAt}#branches`, () => readBranches(deps.db, row.id));
    if (!branches) throw new SiteError(404, NO_GIT);
    return sent(branches);
  }
  const branch = /^branch-(\d+)\.json$/.exec(file);
  if (branch) {
    const detail = await keptFile(`git:${row.id}@${git.builtAt}#branch-${branch[1]}`, () => readBranchDetail(deps.db, row.id, Number(branch[1])));
    if (!detail) throw new SiteError(404, "This branch's commits were not kept.");
    return sent(detail);
  }
  const pull = /^pull-(\d+)\.json$/.exec(file);
  const key = pull ? gitPullKey(git.prefix, Number(pull[1])) : gitFileKey(git.prefix, "pulls");
  const object = await readGitObject(deps.storage, key);
  if (!object) throw new SiteError(404, pull ? "Git data of this pull request was not kept." : NO_GIT);
  return { packed: null, object, etag, cacheControl };
}

async function commitLog(deps: Deps, viewer: Viewer, owner: string, name: string, version: number | null, seen?: string | null): Promise<Served> {
  const row = await readable(deps, viewer, owner, name);
  if (row.indexId === null) throw new SiteError(404, NO_HISTORY);
  const pinned = version !== null && version === row.reportAt;
  const cacheControl = row.isPrivate ? "private, max-age=300" : pinned ? `public, max-age=${YEAR}, immutable` : "public, max-age=300";
  const tagOf = (stamp: string) => `"${row.indexId}-${sha256(stamp).slice(0, 16)}-log"`;
  const stamp = await stampOf(deps.db, row.indexId, pinned ? (row.reportAt ?? undefined) : undefined);
  if (stamp === null) throw new SiteError(404, NO_HISTORY);
  if (matches(seen, tagOf(stamp))) return { packed: null, object: null, etag: tagOf(stamp), cacheControl };
  const made = await indexFile(deps.db, row.indexId, "log", (view) => inTurn(() => gitLog(view)));
  if (!made) throw new SiteError(404, NO_HISTORY);
  return { packed: made.packed, object: null, etag: tagOf(made.stamp), cacheControl };
}

const RECENT = 12;
const FOLDER_MAX = 1000;

async function under(deps: Deps, row: GitRepo["row"], path: string): Promise<{ view: IndexView; commits: number[] }> {
  if (row.indexId === null) throw new SiteError(404, NO_GIT);
  const view = await viewOf(deps.db, row.indexId);
  if (!view) throw new SiteError(404, NO_GIT);
  return { view, commits: underOf(view, path) };
}

/** How often and how recently a file or folder changed, as commits by month, and its newest commits with who made them, from the Stored Index. */
export async function pathHistory(deps: Deps, viewer: Viewer, owner: string, name: string, path: string): Promise<PathHistory> {
  if (path.length > 1000 || path.includes("\0")) throw new SiteError(400, "That is not a path.");
  const { row } = await gitOf(deps, viewer, owner, name);
  const { view, commits } = await under(deps, row, path);
  const recent = commits.slice(0, RECENT);
  const subjects = await subjectsOf(deps.db, row.indexId ?? 0, recent.map((c) => view.ids[c] ?? ""));
  const list: PathCommit[] = recent.map((c) => {
    const sha = view.ids[c] ?? "";
    const who = view.person[c] ?? -1;
    return { sha, at: view.time[c] ?? 0, offset: view.offset[c] ?? 0, subject: subjects.get(sha) ?? "", merge: false, person: who >= 0 ? personRef(view, who) : null };
  });
  let logged = 0;
  for (let c = 0; c < view.time.length; c++) if (((view.flags[c] ?? 0) & 1) === 0) logged++;
  const until = Math.max(view.anchor, view.time[view.time.length - 1] ?? 0);
  return { path, total: commits.length, commits: list, logged, complete: true, months: monthsOf(view, commits, until) };
}

/** For each file and folder right inside a folder, the newest commit that touched it, with its subject and who made it. */
export async function folderLast(deps: Deps, viewer: Viewer, owner: string, name: string, path: string): Promise<FolderLast> {
  if (path.length > 1000 || path.includes("\0") || (path !== "" && !path.endsWith("/"))) throw new SiteError(400, "That is not a folder.");
  const { row } = await gitOf(deps, viewer, owner, name);
  if (row.indexId === null) throw new SiteError(404, NO_GIT);
  const view = await viewOf(deps.db, row.indexId);
  if (!view) throw new SiteError(404, NO_GIT);
  const found = [...lastInFolder(view, path)].slice(0, FOLDER_MAX);
  const subjects = await subjectsOf(deps.db, row.indexId, found.map(([, c]) => view.ids[c] ?? ""));
  return {
    path,
    entries: found.map(([entry, c]) => {
      const sha = view.ids[c] ?? "";
      const who = view.person[c] ?? -1;
      return { name: entry.replace(/\/$/, ""), dir: entry.endsWith("/"), sha, subject: subjects.get(sha) ?? "", at: view.time[c] ?? 0, person: who >= 0 ? personRef(view, who) : null };
    }),
  };
}

const insights = new Map<string, GitBranchInsight | null>();
const INSIGHTS_KEPT = 300;

/** Who holds the files a branch changes, and which of them the default branch changed after the branch left it, by the branch's place in the list; a 404 when its files were not kept. */
export async function branchInsight(deps: Deps, viewer: Viewer, owner: string, name: string, position: number): Promise<GitBranchInsight> {
  if (!Number.isInteger(position) || position < 0 || position > 100_000) throw new SiteError(400, "That is not a branch.");
  const { row, git } = await gitOf(deps, viewer, owner, name);
  const key = `${row.id}@${git.builtAt}-${row.indexId ?? 0}#${position}`;
  let made = insights.get(key);
  if (made === undefined) {
    made = await readBranchInsight(deps.db, row.id, position);
    insights.set(key, made);
    if (insights.size > INSIGHTS_KEPT) insights.delete(insights.keys().next().value as string);
  }
  if (!made) throw new SiteError(404, "This branch's files were not kept.");
  return made;
}
