import { queryOptions } from "@tanstack/react-query";
import type { Lookup } from "@commitscape/data";
import { getBoards, getMe, getPeopleBoards } from "#/functions/account";
import { getDashboard } from "#/functions/dashboard";
import { getGitStatus } from "#/functions/git";
import { getPullConversation } from "#/functions/pulls";
import { getLookup, getReportHead } from "#/functions/repos";
import { getMyChoices, getStandings } from "#/functions/standings";
import { getCardGallery } from "#/functions/cards";
import { getSharedWork, getWork } from "#/functions/work";
import { getMyRivals, getRivalGaps, getVersus } from "#/functions/versus";
import { getCrew, getMyRaces, getRace } from "#/functions/races";
import { getDayCommits, getEngine, getFullProfile, getProfile, getProfileLookup, getTraits, getWrapped } from "#/functions/profiles";

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

export const gitStatusQuery = (owner: string, repo: string, at: number) =>
  queryOptions({ queryKey: ["git-status", owner.toLowerCase(), repo.toLowerCase(), at], queryFn: () => getGitStatus({ data: { owner, repo } }), staleTime: 5 * 60_000 });

export const pullConversationQuery = (owner: string, repo: string, number: number) =>
  queryOptions({ queryKey: ["pull-conversation", owner.toLowerCase(), repo.toLowerCase(), number], queryFn: () => getPullConversation({ data: { owner, repo, number } }), staleTime: 5 * 60_000 });

export const boardsQuery = () => queryOptions({ queryKey: ["boards"], queryFn: () => getBoards(), staleTime: 10 * 60_000 });

export const meQuery = () => queryOptions({ queryKey: ["me"], queryFn: () => getMe(), staleTime: 60_000 });

export { running };

export const profileLookupQuery = (login: string) =>
  queryOptions({ queryKey: ["profile-lookup", login.toLowerCase()], queryFn: () => getProfileLookup({ data: { login } }), staleTime: 5 * 60_000 });

export const profileQuery = (login: string) =>
  queryOptions({ queryKey: ["profile", login.toLowerCase()], queryFn: () => getProfile({ data: { login } }), staleTime: 5 * 60_000 });

export const fullProfileQuery = (login: string) =>
  queryOptions({ queryKey: ["profile-full", login.toLowerCase()], queryFn: () => getFullProfile({ data: { login } }), staleTime: 5 * 60_000 });

export const engineQuery = (login: string) =>
  queryOptions({
    queryKey: ["engine", login.toLowerCase()],
    queryFn: () => getEngine({ data: { login } }),
    staleTime: 60_000,
  });

export const liveEngineQuery = (login: string) =>
  queryOptions({ queryKey: ["engine-live", login.toLowerCase()], queryFn: () => getEngine({ data: { login } }), refetchInterval: (q) => (!q.state.data || q.state.data.counting > 0 || q.state.data.unread?.some((r) => r.state === "reading") ? 3000 : false) });

export const standingsQuery = (owner: string, repo: string, focus?: string, limit?: number) =>
  queryOptions({
    queryKey: ["standings", owner.toLowerCase(), repo.toLowerCase(), focus?.toLowerCase() ?? "", limit ?? "all"],
    queryFn: () => getStandings({ data: { owner, repo, focus, limit } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

export const choicesQuery = () => queryOptions({ queryKey: ["choices"], queryFn: () => getMyChoices(), staleTime: 60_000 });

export const cardGalleryQuery = (login: string) => queryOptions({ queryKey: ["card-gallery", login.toLowerCase()], queryFn: () => getCardGallery({ data: { login } }), staleTime: 60_000 });

export const workQuery = (login: string, from: string, to: string, filter: string | null) =>
  queryOptions({ queryKey: ["work", login.toLowerCase(), from, to, filter ?? ""], queryFn: () => getWork({ data: { login, from, to, filter } }), staleTime: 5 * 60_000 });

export const sharedWorkQuery = (id: string) => queryOptions({ queryKey: ["shared-work", id], queryFn: () => getSharedWork({ data: { id } }), staleTime: Infinity });

export const versusQuery = (a: string, b: string) => queryOptions({ queryKey: ["versus", a.toLowerCase(), b.toLowerCase()], queryFn: () => getVersus({ data: { a, b } }), staleTime: 5 * 60_000 });

export const rivalsQuery = () => queryOptions({ queryKey: ["rivals"], queryFn: () => getMyRivals(), staleTime: 60_000 });

export const rivalGapsQuery = () => queryOptions({ queryKey: ["rival-gaps"], queryFn: () => getRivalGaps(), staleTime: 60_000 });

export const traitsQuery = (login: string) => queryOptions({ queryKey: ["traits", login.toLowerCase()], queryFn: () => getTraits({ data: { login } }), staleTime: 5 * 60_000 });

export const raceQuery = (id: string) => queryOptions({ queryKey: ["race", id], queryFn: () => getRace({ data: { id } }), staleTime: 60_000 });

export const crewQuery = (id: string) => queryOptions({ queryKey: ["crew", id], queryFn: () => getCrew({ data: { id } }), staleTime: 60_000 });

export const myRacesQuery = () => queryOptions({ queryKey: ["my-races"], queryFn: () => getMyRaces(), staleTime: 30_000 });

export const peopleBoardsQuery = (window: "season" | "last-season" | "90d" | "all", repo: string | null) =>
  queryOptions({ queryKey: ["people-boards", window, repo ?? ""], queryFn: () => getPeopleBoards({ data: { window, repo } }), staleTime: 5 * 60_000 });

export const wrappedQuery = (login: string, year: number) => queryOptions({ queryKey: ["wrapped", login.toLowerCase(), year], queryFn: () => getWrapped({ data: { login, year } }), staleTime: 5 * 60_000 });

export const dayCommitsQuery = (login: string, day: number) =>
  queryOptions({ queryKey: ["day-commits", login.toLowerCase(), day], queryFn: () => getDayCommits({ data: { login, day } }), staleTime: 5 * 60_000 });

export const dashboardQuery = () => queryOptions({ queryKey: ["dashboard"], queryFn: () => getDashboard(), staleTime: 30_000 });
