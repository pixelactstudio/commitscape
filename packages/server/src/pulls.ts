import type { PullDecision, PullLabel, PullReviewState } from "@commitscape/data";

export const PULLS_VERSION = 1;

const DECISIVE = new Set<PullReviewState>(["approved", "changes_requested", "dismissed"]);

/** A review's state as kept, from GitHub's GraphQL (`APPROVED`) or webhook (`approved`) spelling; null for a pending or unknown one. */
export function reviewStateOf(raw: string | null | undefined): PullReviewState | null {
  const s = (raw ?? "").toLowerCase();
  return s === "approved" || s === "changes_requested" || s === "commented" || s === "dismissed" ? s : null;
}

/** A pull request's review decision as kept, from GitHub's `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED`; null when it has none. */
export function decisionOf(raw: string | null | undefined): PullDecision | null {
  const s = (raw ?? "").toLowerCase();
  return s === "approved" || s === "changes_requested" || s === "review_required" ? s : null;
}

/** Labels as kept: their names and colours, without GitHub's `#`, at most `max`. */
export function labelsOf(raw: readonly { name?: string | null; color?: string | null }[] | null | undefined, max = 20): PullLabel[] {
  return (raw ?? []).flatMap((l) => (l.name ? [{ name: l.name.slice(0, 100), colour: (l.color ?? "").replace(/^#/, "").slice(0, 6) }] : [])).slice(0, max);
}

export type ReviewerRow = { reviews: number; firstAt: number; lastAt: number; state: PullReviewState | null; approvedAt: number | null };

/** Folds one reviewer's reviews of a pull request, in the order submitted, into their count, first and last review, last word and first approval. */
export function foldReview(seen: ReviewerRow | undefined, state: PullReviewState | null, at: number): ReviewerRow {
  const decisive = state !== null && DECISIVE.has(state);
  if (!seen) return { reviews: 1, firstAt: at, lastAt: at, state, approvedAt: state === "approved" ? at : null };
  const keep = seen.state !== null && DECISIVE.has(seen.state);
  return {
    reviews: seen.reviews + 1,
    firstAt: Math.min(seen.firstAt, at),
    lastAt: Math.max(seen.lastAt, at),
    state: decisive && at >= seen.lastAt ? state : keep ? seen.state : (state ?? seen.state),
    approvedAt: state === "approved" ? Math.min(seen.approvedAt ?? at, at) : seen.approvedAt,
  };
}
