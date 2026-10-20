import { PULL_SIZES, type PullAsk, type PullReviewFilter, type PullSize, type PullSort, type PullStatsAsk } from "@commitscape/data";
import type { Route } from "../route";

export const PULL_STATES = ["open", "merged", "closed"] as const;

export type PullFilter = (typeof PULL_STATES)[number];

export const pullFilterOf = (state: string | undefined): PullFilter => ((PULL_STATES as readonly string[]).includes(state ?? "") ? (state as PullFilter) : "open");

const WINDOWS = ["30d", "90d", "1y", "all"] as const;

const SORTS: readonly PullSort[] = ["created", "updated", "merged", "closed", "size", "oldest", "comments"];

const REVIEWS: readonly PullReviewFilter[] = ["none", "reviewed", "approved", "changes"];

type Ask = Pick<Route, "state" | "by" | "q" | "page" | "author" | "label" | "size" | "review" | "stale" | "draft" | "window" | "from" | "to">;

/** The Window a pull request screen asks for: the dates chosen, else the named Window (the Report's own when the address names none), all time for any other. */
export function pullWindowOf(route: Pick<Route, "window" | "from" | "to">, reported?: string): PullStatsAsk {
  if (route.from !== undefined || route.to !== undefined) return { ...(route.from === undefined ? {} : { from: route.from }), ...(route.to === undefined ? {} : { to: route.to }) };
  const named = route.window ?? reported ?? "all";
  return { window: (WINDOWS as readonly string[]).includes(named) ? (named as (typeof WINDOWS)[number]) : "all" };
}

export const pullSizeFilterOf = (size: string | undefined): PullSize | undefined => PULL_SIZES.find((s) => s.id === size)?.id;

export const pullReviewFilterOf = (review: string | undefined): PullReviewFilter | undefined => REVIEWS.find((r) => r === review);

export const pullSortOf = (by: string | undefined): PullSort | undefined => SORTS.find((s) => s === by);

/** What the pull request list asks for, as the address says it: open ones unless another state is chosen, over the Window. */
export function pullAskOf(route: Ask, reported?: string): PullAsk {
  const size = pullSizeFilterOf(route.size);
  const review = pullReviewFilterOf(route.review);
  const sort = pullSortOf(route.by);
  return {
    state: pullFilterOf(route.state),
    ...(route.author ? { author: route.author } : {}),
    ...(route.q ? { q: route.q } : {}),
    ...(route.page && route.page > 1 ? { page: route.page } : {}),
    ...(route.label ? { label: route.label } : {}),
    ...(size ? { size } : {}),
    ...(review ? { review } : {}),
    ...(route.stale === "1" ? { stale: true } : {}),
    ...(route.draft === "yes" ? { draft: true } : route.draft === "no" ? { draft: false } : {}),
    ...(sort ? { sort } : {}),
    ...pullWindowOf(route, reported),
  };
}

/** What the numbers of the pull request screen are computed over. */
export const pullStatsAskOf = (route: Pick<Route, "window" | "from" | "to">, reported?: string): PullStatsAsk => pullWindowOf(route, reported);
