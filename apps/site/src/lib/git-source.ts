import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { FILE_BINARY, type CodeStory, type GitBranchDetail, type GitBranchInsight, type GitBranches, type GitCoupling, type GitPull, type GitStatus, type GitTree } from "@commitscape/data";
import { gitKeyOf, readText, toSearch, type GitSource } from "@commitscape/ui";
import { getBranchInsight, getFolderLast, getPathHistory } from "#/functions/git";
import { getCodeLog, getCodeStory } from "#/functions/code";
import { getPull, getPullAuthors, getPullInsight, getPullLabels, getPulls, getPullStats } from "#/functions/pulls";

export const gitId = (owner: string, repo: string, builtAt: number) => `gh:${owner}/${repo}@git${builtAt}`.toLowerCase();

const base = (owner: string, repo: string) => `/api/reports/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

async function read(url: string): Promise<Response> {
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(((await answer.json().catch(() => null)) as { error?: string } | null)?.error ?? `Could not read ${url} (${answer.status}).`);
  return answer;
}

const blob = async (owner: string, repo: string, sha: string) => (await read(`${base(owner, repo)}/blob/${sha}`)).text();

/** A repository's git data read through the Site's own addresses: each file keyed by the build it is of, so a browser keeps it for good. */
export function siteGit(owner: string, repo: string, status: GitStatus, conversation: (number: number) => ReactNode): GitSource {
  const root = base(owner, repo);
  const v = `?v=${status.builtAt}`;
  const json = async <T>(file: string) => (await (await read(`${root}/git/${file}${v}`)).json()) as T;
  return {
    id: gitId(owner, repo, status.builtAt),
    github: `https://github.com/${owner}/${repo}`,
    status,
    tree: () => json<GitTree>("tree.json"),
    coupling: () => json<GitCoupling>("coupling.json"),
    text: (sha) => blob(owner, repo, sha),
    history: (path) => getPathHistory({ data: { owner, repo, path } }),
    lastIn: (path) => getFolderLast({ data: { owner, repo, path } }),
    story: (path) => getCodeStory({ data: { owner, repo, path } }),
    log: (path, page) => getCodeLog({ data: { owner, repo, path, page } }),
    branches: () => json<GitBranches>("branches.json"),
    branch: (index) => json<GitBranchDetail>(`branch-${index}.json`),
    branchInsight: (index): Promise<GitBranchInsight> => getBranchInsight({ data: { owner, repo, position: index } }),
    pulls: (ask) => getPulls({ data: { owner, repo, ...ask } }),
    pull: (number) => getPull({ data: { owner, repo, number } }),
    pullStats: (ask) => getPullStats({ data: { owner, repo, ...ask } }),
    pullAuthors: (q) => getPullAuthors({ data: { owner, repo, q } }),
    pullLabels: () => getPullLabels({ data: { owner, repo } }),
    pullInsight: (number) => getPullInsight({ data: { owner, repo, number } }),
    pullGit: (number) => json<GitPull>(`pull-${number}.json`),
    conversation,
    rawUrl: (sha) => `${root}/blob/${sha}`,
    href: (change) => {
      const search = new URLSearchParams();
      for (const [k, value] of Object.entries(toSearch({ ...change }))) if (value !== undefined) search.set(k, String(value));
      return `/gh/${owner}/${repo}?${search}`;
    },
  };
}

const pathOf = (code: string) => (code === "/" ? "" : code);

/** What the Code window needs first for a path, made ready: its story (awaited on the server, so the window is drawn with its header), then on the client the file's text. */
export async function warmCode(queryClient: QueryClient, owner: string, repo: string, status: GitStatus, code: string): Promise<void> {
  const id = gitId(owner, repo, status.builtAt);
  const path = pathOf(code);
  const story = queryClient.ensureQueryData({ queryKey: gitKeyOf(id, "story", path), queryFn: () => getCodeStory({ data: { owner, repo, path } }), staleTime: Infinity });
  const folder = path === "" || path.endsWith("/") ? queryClient.ensureQueryData({ queryKey: gitKeyOf(id, "last", path), queryFn: () => getFolderLast({ data: { owner, repo, path } }), staleTime: Infinity }) : null;
  if (typeof window === "undefined") {
    await Promise.all([story.catch(() => null), folder?.catch(() => null)]);
    return;
  }
  void prefetchTree(queryClient, owner, repo, status).catch(() => null);
  const told: CodeStory | null = await story.catch(() => null);
  const file = told?.file;
  if (!told || !file || told.kind !== "file" || (file.flags & FILE_BINARY) !== 0 || file.bytes > 1024 * 1024) return;
  await queryClient.prefetchQuery({ queryKey: gitKeyOf(id, "text", file.sha), queryFn: () => readText({ text: (sha) => blob(owner, repo, sha) }, told.raw, path, file.sha), staleTime: Infinity });
}

/** Warms the file tree, which the Code window needs first. */
export async function prefetchTree(queryClient: QueryClient, owner: string, repo: string, status: GitStatus): Promise<void> {
  const id = gitId(owner, repo, status.builtAt);
  await queryClient.prefetchQuery({ queryKey: gitKeyOf(id, "tree"), queryFn: async () => (await (await read(`${base(owner, repo)}/git/tree.json?v=${status.builtAt}`)).json()) as GitTree, staleTime: Infinity });
}
