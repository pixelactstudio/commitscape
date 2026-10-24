import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { PullAsk, PullStatsAsk } from "@commitscape/data";
import { gitKey, type GitSource } from "../git/source";

export const listQuery = (git: GitSource, ask: PullAsk) =>
  queryOptions({ queryKey: gitKey(git, "pulls", JSON.stringify(ask)), queryFn: () => git.pulls(ask), staleTime: 60_000, placeholderData: keepPreviousData, retry: 1 });

export const statsQuery = (git: GitSource, ask: PullStatsAsk) =>
  queryOptions({ queryKey: gitKey(git, "pull-stats", JSON.stringify(ask)), queryFn: () => git.pullStats(ask), staleTime: 60_000, placeholderData: keepPreviousData, retry: 1 });

export const labelsQuery = (git: GitSource) => queryOptions({ queryKey: gitKey(git, "pull-labels"), queryFn: () => git.pullLabels(), staleTime: 10 * 60_000, retry: 1 });

export const headerQuery = (git: GitSource, number: number) => queryOptions({ queryKey: gitKey(git, "pull", number), queryFn: () => git.pull(number), staleTime: 60_000, retry: false });

export const keptQuery = (git: GitSource, number: number, enabled: boolean) => queryOptions({ queryKey: gitKey(git, "pull-git", number), queryFn: () => git.pullGit(number), staleTime: Infinity, enabled, retry: 1 });

export const insightQuery = (git: GitSource, number: number) => queryOptions({ queryKey: gitKey(git, "pull-insight", number), queryFn: () => git.pullInsight(number), staleTime: 5 * 60_000, retry: 1 });
