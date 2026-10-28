import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import { rawBase, type FolderLast, type GitBranchInsight, type GitStatus, type PathHistory } from "@commitscape/data";
import { gitFileKey, gitPullKey, readBlobs, readBranchDetail, readBranchInsight, readBranches, readGitObject, readOpenBranches, schema, sha256, type StoredObject } from "@commitscape/server";
import { keptFile, keptText, withPack } from "./answers";
import { SiteError } from "./http";
import type { Packed } from "./packed";
import { readable, type Deps, type Row, type Viewer } from "./repos";

const { pullRequests, repoGit, storedIndexes } = schema;

export const NO_GIT = "This repository's files, branches and pull requests are read at its next Build.";

const FILES = /^(tree|coupling|branches|pulls)\.json$|^pull-(\d{1,8})\.json$|^branch-(\d{1,5})\.json$/;
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

async function fromEngine(deps: Deps, row: GitRepo["row"], git: GitRepo["git"], file: "tree" | "coupling", seen: string | null | undefined, cacheControl: string): Promise<Served> {
  const indexId = row.indexId;
  const made = await withPack(deps.db, indexId, async (pack) => {
    const etag = `"${git.builtAt}-${sha256(pack).slice(0, 16)}-${file}"`;
    if (matches(seen, etag)) return { packed: null, etag };
    const packed = await keptText(`${pack}#${file}:${git.builtAt}`, async () => {
      if (file === "coupling") return deps.engine.couplingText(pack);
      const [blobs, [si]] = await Promise.all([readBlobs(deps.db, row.id), deps.db.select({ head: storedIndexes.head }).from(storedIndexes).where(eq(storedIndexes.id, indexId ?? 0))]);
      const head = si?.head ?? git.head;
      return deps.engine.treeText(pack, Object.fromEntries(blobs), { builtAt: git.builtAt, head, branch: git.branch, raw: row.isPrivate ? null : rawBase(row.owner, row.name, head) });
    });
    return { packed, etag };
  }, row.reportAt);
  if (!made || (made.value.packed === null && !matches(seen, made.value.etag))) throw new SiteError(404, NO_GIT);
  return { packed: made.value.packed, object: null, etag: made.value.etag, cacheControl };
}

/** One JSON file of a repository's git data: the tree and Change Coupling from the engine service, its branches from their rows, each packed once per pack and build; its pull requests as stored. Kept for a year when the address names the build it is of. */
export async function gitFile(deps: Deps, viewer: Viewer, owner: string, name: string, file: string, version: number | null, seen?: string | null): Promise<Served> {
  if (!FILES.test(file)) throw new SiteError(404, "No such file.");
  const { row, git } = await gitOf(deps, viewer, owner, name);
  const pinned = version !== null && version === git.builtAt;
  const cacheControl = row.isPrivate ? "private, max-age=300" : pinned ? `public, max-age=${YEAR}, immutable` : "public, max-age=60";
  if (file === "tree.json" || file === "coupling.json") return fromEngine(deps, row, git, file === "tree.json" ? "tree" : "coupling", seen, cacheControl);
  const etag = `"${git.builtAt}-${row.indexId ?? 0}-${file}"`;
  const sent = (packed: Packed): Served => ({ packed, object: null, etag, cacheControl });
  if (matches(seen, etag)) return { packed: null, object: null, etag, cacheControl };
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

const checkedPath = (path: string) => {
  if (path.length > 1000 || path.includes("\0")) throw new SiteError(400, "That is not a path.");
};

/** How often and how recently a file or folder changed, as commits by month, and its newest commits with who made them, from the engine service. */
export async function pathHistory(deps: Deps, viewer: Viewer, owner: string, name: string, path: string): Promise<PathHistory> {
  checkedPath(path);
  const { row } = await gitOf(deps, viewer, owner, name);
  const made = await withPack(deps.db, row.indexId, (pack) => deps.engine.pathHistory(pack, path), row.reportAt);
  if (!made) throw new SiteError(404, NO_GIT);
  return made.value;
}

/** For each file and folder right inside a folder, the newest commit that touched it, with its subject and who made it. */
export async function folderLast(deps: Deps, viewer: Viewer, owner: string, name: string, path: string): Promise<FolderLast> {
  if (path.length > 1000 || path.includes("\0") || (path !== "" && !path.endsWith("/"))) throw new SiteError(400, "That is not a folder.");
  const { row } = await gitOf(deps, viewer, owner, name);
  const made = await withPack(deps.db, row.indexId, (pack) => deps.engine.folderLast(pack, path), row.reportAt);
  if (!made) throw new SiteError(404, NO_GIT);
  return made.value;
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
