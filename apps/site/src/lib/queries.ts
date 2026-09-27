import { queryOptions } from "@tanstack/react-query";
import type { Lookup } from "@commitscape/data";
import { getBoards, getMe } from "#/functions/account";
import { getLookup, getReportHead } from "#/functions/repos";

const running = (l: Lookup | undefined) => !!l?.build && (l.build.state === "queued" || l.build.state === "running");

export const lookupQuery = (owner: string, repo: string) =>
  queryOptions({
    queryKey: ["lookup", owner.toLowerCase(), repo.toLowerCase()],
    queryFn: () => getLookup({ data: { owner, repo } }),
    staleTime: 30_000,
    refetchInterval: (q) => (running(q.state.data) ? 2000 : false),
  });

export const reportHeadQuery = (owner: string, repo: string, at: number) =>
  queryOptions({
    queryKey: ["report-head", owner.toLowerCase(), repo.toLowerCase(), at],
    queryFn: () => getReportHead({ data: { owner, repo } }),
    staleTime: Infinity,
  });

export const boardsQuery = () => queryOptions({ queryKey: ["boards"], queryFn: () => getBoards(), staleTime: 10 * 60_000 });

export const meQuery = () => queryOptions({ queryKey: ["me"], queryFn: () => getMe(), staleTime: 60_000 });

export { running };
