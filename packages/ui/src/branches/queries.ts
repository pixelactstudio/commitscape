import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { GitBranchDetail, GitBranchInsight } from "@commitscape/data";
import { gitKey, useGit } from "../git/source";

/** The queries a branch's view makes, only when the Build kept its files and commits. */
export function useBranchQueries(index: number, kept: boolean): { detail: UseQueryResult<GitBranchDetail>; insight: UseQueryResult<GitBranchInsight> } {
  const git = useGit();
  const detail = useQuery({ queryKey: gitKey(git, "branch", index), queryFn: () => git.branch(index), staleTime: Infinity, enabled: kept, retry: false });
  const insight = useQuery({ queryKey: gitKey(git, "insight", index), queryFn: () => git.branchInsight(index), staleTime: Infinity, enabled: kept, retry: false });
  return { detail, insight };
}
