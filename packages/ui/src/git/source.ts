import { createContext, useContext, type ReactNode } from "react";
import type { Route } from "../route";
import type { CodeLog, CodeStory, FolderLast, GitBranchDetail, GitBranchInsight, GitBranches, GitCoupling, GitPull, GitStatus, GitTree, PathHistory, PullAsk, PullAuthor, PullHeader, PullInsight, PullLabel, PullList, PullStats, PullStatsAsk } from "@commitscape/data";

export interface GitSource {
  readonly id: string;
  readonly github: string;
  readonly status: GitStatus;
  tree(): Promise<GitTree>;
  coupling(): Promise<GitCoupling>;
  text(sha: string): Promise<string>;
  history(path: string): Promise<PathHistory>;
  lastIn(path: string): Promise<FolderLast>;
  story(path: string): Promise<CodeStory>;
  log(path: string, page: number): Promise<CodeLog>;
  branches(): Promise<GitBranches>;
  branch(index: number): Promise<GitBranchDetail>;
  branchInsight(index: number): Promise<GitBranchInsight>;
  pulls(ask: PullAsk): Promise<PullList>;
  pull(number: number): Promise<PullHeader>;
  pullStats(ask: PullStatsAsk): Promise<PullStats>;
  pullAuthors(q: string): Promise<PullAuthor[]>;
  pullLabels(): Promise<(PullLabel & { pulls: number })[]>;
  pullInsight(number: number): Promise<PullInsight>;
  pullGit(number: number): Promise<GitPull>;
  conversation(number: number): ReactNode;
  rawUrl(sha: string): string;
  href(change: Partial<Route>): string;
}

export const GitContext = createContext<GitSource | null>(null);

/** The git data of the repository on screen, when the Site has it. */
export function useGitOptional(): GitSource | null {
  return useContext(GitContext);
}

/** The git data of the repository on screen. */
export function useGit(): GitSource {
  const git = useContext(GitContext);
  if (!git) throw new Error("No git source: wrap the app in <GitContext value={…}>.");
  return git;
}

export const gitKeyOf = (id: string, ...parts: (string | number)[]) => ["git", id, ...parts] as const;

export const gitKey = (source: Pick<GitSource, "id">, ...parts: (string | number)[]) => gitKeyOf(source.id, ...parts);
