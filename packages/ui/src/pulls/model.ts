import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from "lucide-react";
import { PULL_SIZES, type PullHeader, type PullReview, type PullReviewState, type PullRow, type PullSize, type PullSpan, type PullState } from "@commitscape/data";
import { day, duration, grouped } from "../format";

export const DAY = 86_400;
const HOUR = 3600;
const MONTH = 30.44 * DAY;

export type Look = { Icon: LucideIcon; word: string; tone: string };

export const STATE_LOOK: Record<PullState | "draft", Look> = {
  open: { Icon: GitPullRequest, word: "Open", tone: "text-brand" },
  merged: { Icon: GitMerge, word: "Merged", tone: "text-(--s6)" },
  closed: { Icon: GitPullRequestClosed, word: "Closed", tone: "text-removed" },
  draft: { Icon: GitPullRequestDraft, word: "Draft", tone: "text-secondary" },
};

/** How a pull request looks now: a draft one is its own state while it is open. */
export const lookOf = (row: Pick<PullRow, "state" | "draft">): Look => (row.state === "open" && row.draft ? STATE_LOOK.draft : STATE_LOOK[row.state]);

export const SERIES = { opened: "var(--s1)", merged: "var(--s6)", closed: "var(--removed)" } as const;

/** A length of time as a number and its unit, for a figure that sets the unit small: "11.3" "h". */
export function spanParts(seconds: number): [string, string] {
  const one = (n: number) => String(Math.round(n * 10) / 10);
  if (seconds < 90) return [String(Math.max(0, Math.round(seconds))), "s"];
  if (seconds < 90 * 60) return [String(Math.round(seconds / 60)), "min"];
  if (seconds < 2 * DAY) return [one(seconds / HOUR), "h"];
  if (seconds < 60 * DAY) return [one(seconds / DAY), "d"];
  if (seconds < 2 * 365.25 * DAY) return [one(seconds / MONTH), "mo"];
  return [one(seconds / (365.25 * DAY)), "y"];
}

/** A length of time in words that follow a count: "11.3 hours". */
export function spanWords(seconds: number): string {
  const [n, unit] = spanParts(seconds);
  const words: Record<string, [string, string]> = { s: ["second", "seconds"], min: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"], mo: ["month", "months"], y: ["year", "years"] };
  const [one, more] = words[unit] ?? [unit, unit];
  return `${n} ${n === "1" ? one : more}`;
}

/** How long before an anchor a time was: "5 minutes ago", "3 days ago", "2 months ago". */
export function agoOf(anchor: number, at: number): string {
  const s = Math.max(0, anchor - at);
  if (s < 90) return "just now";
  if (s < 90 * 60) return `${Math.round(s / 60)} minutes ago`;
  if (s < 36 * HOUR) return `${Math.round(s / HOUR)} hours ago`;
  return `${duration(s / DAY)} ago`;
}

export const SIZE_WORDS: Record<PullSize, string> = { xs: "under 10 lines", s: "10 to 49 lines", m: "50 to 249 lines", l: "250 to 999 lines", xl: "1,000 lines or more" };

export const sizeLabel = (size: PullSize): string => PULL_SIZES.find((s) => s.id === size)?.label ?? "";

export const sizeTitle = (size: PullSize, lines: number): string => `Size ${sizeLabel(size)}: ${grouped(lines)} lines added and removed together; ${SIZE_WORDS[size]}`;

/** The Window as dates: "20 Sep – 19 Oct 2026", or "since the first pull request" for all time. */
export function spanDates(span: PullSpan): string {
  const until = day(Math.floor(span.until / DAY));
  if (span.since === null) return `All time, to ${until}`;
  const from = day(Math.floor(span.since / DAY));
  return from === until ? from : `${from} to ${until}`;
}

/** How long a pull request was open before it merged or closed, or has been open until the anchor; null when its end was not read. */
export function lifeOf(row: Pick<PullRow, "state" | "createdAt" | "mergedAt" | "closedAt">, anchor: number): number | null {
  if (row.state === "merged") return row.mergedAt === null ? null : row.mergedAt - row.createdAt;
  if (row.state === "closed") return row.closedAt === null ? null : row.closedAt - row.createdAt;
  return anchor - row.createdAt;
}

export const REVIEW_WORDS: Record<PullReviewState, string> = { approved: "approved", changes_requested: "asked for changes", commented: "commented", dismissed: "review dismissed" };

export type Period = { from: number; to: number; opened: number; merged: number; closed: number };

function nextStart(at: number, unit: "week" | "month"): number {
  if (unit === "week") return at + 7 * DAY;
  const d = new Date(at * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

/** Weeks or months of throughput folded into at most `most` columns: calendar quarters, then calendar years, when there are more months than that; the first column holds only the months the series has of its quarter or year. */
export function periodsOf(series: { unit: "week" | "month"; from: number; opened: number[]; merged: number[]; closed: number[] }, most = 48): { periods: Period[]; unit: "week" | "month" | "quarter" | "year" } {
  const n = series.opened.length;
  const fold = series.unit === "week" ? 1 : n <= most ? 1 : n <= most * 3 ? 3 : 12;
  const periods: Period[] = [];
  let start = series.from;
  let i = 0;
  while (i < n) {
    const take = series.unit === "month" && fold > 1 ? fold - (new Date(start * 1000).getUTCMonth() % fold) : fold;
    let end = start;
    const sum = { opened: 0, merged: 0, closed: 0 };
    for (let k = 0; k < take && i + k < n; k++) {
      sum.opened += series.opened[i + k] ?? 0;
      sum.merged += series.merged[i + k] ?? 0;
      sum.closed += series.closed[i + k] ?? 0;
      end = nextStart(end, series.unit);
    }
    periods.push({ from: start, to: end, ...sum });
    start = end;
    i += take;
  }
  return { periods, unit: series.unit === "week" ? "week" : fold === 1 ? "month" : fold === 3 ? "quarter" : "year" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** What a column of throughput is called: "Oct 2026", "Q3 2026", "2026", or "12 Oct 2026" for the week that starts then. */
export function periodWords(p: Pick<Period, "from">, unit: "week" | "month" | "quarter" | "year"): string {
  const d = new Date(p.from * 1000);
  const y = d.getUTCFullYear();
  if (unit === "year") return String(y);
  if (unit === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`;
  if (unit === "month") return `${MONTHS[d.getUTCMonth()]} ${y}`;
  return `Week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${y}`;
}

/** The short tick under a column, or an empty string where it would crowd the one before. */
export function periodTick(p: Pick<Period, "from">, unit: "week" | "month" | "quarter" | "year", index: number, count: number): string {
  const d = new Date(p.from * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const every = count > 40 ? 12 : count > 20 ? 6 : count > 10 ? 3 : 1;
  if (unit === "year") return count > 10 && index % 2 === 1 ? "" : String(y);
  if (unit === "quarter") return m < 3 ? String(y) : "";
  if (unit === "month") return m % every === 0 ? (m === 0 ? String(y) : MONTHS[m] ?? "") : "";
  return index % Math.max(1, Math.round(count / 6)) === 0 ? `${d.getUTCDate()} ${MONTHS[m]}` : "";
}

export const BANDS = ["Under an hour", "Under a day", "Under a week", "Under a month", "A month or more"] as const;

/** The share of a whole as a percentage with no decimals, but "<1%" for a share that rounds to nothing. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const p = (part * 100) / whole;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

export type Moment = { key: string; at: number; who: string | null; verb: string; kind: "opened" | "review" | "merged" | "closed" | "now"; state?: PullReviewState | null };

function reviewMoments(r: PullReview): Moment[] {
  const out: Moment[] = [];
  const last = r.lastAt ?? r.firstAt;
  const single = r.reviews <= 1 || last === r.firstAt;
  out.push({ key: `${r.login}:first`, at: r.firstAt, who: r.login, verb: single && r.state ? REVIEW_WORDS[r.state] : "reviewed", kind: "review", state: single ? r.state : "commented" });
  if (!single) out.push({ key: `${r.login}:last`, at: last, who: r.login, verb: r.state ? REVIEW_WORDS[r.state] : "reviewed again", kind: "review", state: r.state });
  if (r.approvedAt !== null && r.approvedAt !== r.firstAt && r.approvedAt !== last) out.push({ key: `${r.login}:approved`, at: r.approvedAt, who: r.login, verb: "approved", kind: "review", state: "approved" });
  return out;
}

/** A pull request's life as it was read: when it opened, each review with what it said, and when it merged or closed, or that it is still open. */
export function momentsOf(h: PullHeader, anchor: number): Moment[] {
  const list: Moment[] = [{ key: "opened", at: h.createdAt, who: h.author, verb: "opened it", kind: "opened" }];
  for (const r of h.reviews) list.push(...reviewMoments(r));
  if (h.state === "merged" && h.mergedAt !== null) list.push({ key: "merged", at: h.mergedAt, who: h.mergedBy, verb: "merged it", kind: "merged" });
  if (h.state === "closed" && h.closedAt !== null) list.push({ key: "closed", at: h.closedAt, who: null, verb: "closed it without merging", kind: "closed" });
  list.sort((a, b) => a.at - b.at || (a.kind === "opened" ? -1 : 0));
  if (h.state === "open") list.push({ key: "now", at: anchor, who: null, verb: "still open", kind: "now" });
  return list;
}

export const TAB_WORDS: Record<PullState, string> = { open: "Open", merged: "Merged", closed: "Closed" };

/** What each sort is called, by the tab it is on: the first is the tab's own order. */
export function sortsOf(tab: PullState): { value: string; label: string }[] {
  return [
    { value: "default", label: tab === "merged" ? "Latest merged" : tab === "closed" ? "Latest closed" : "Newest opened" },
    ...(tab === "open" ? [] : [{ value: "created", label: "Newest opened" }]),
    { value: "updated", label: "Recently updated" },
    { value: "oldest", label: "Oldest opened" },
    { value: "size", label: "Largest" },
    { value: "comments", label: "Most comments" },
  ];
}
