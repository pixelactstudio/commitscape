import { Check, Minus, X } from "lucide-react";
import { pullSizeOf, type PullLabel, type PullReviewState, type PullRow } from "@commitscape/data";
import { Face } from "../components/Face";
import { ICON } from "../design/tokens";
import { grouped } from "../format";
import { lookOf, REVIEW_WORDS, sizeLabel, sizeTitle } from "./model";

/** A pull request's state as a glyph in its colour, named for people who cannot see either. */
export function StateMark({ row, size = ICON.md }: { row: Pick<PullRow, "state" | "draft">; size?: number }) {
  const { Icon, word, tone } = lookOf(row);
  return (
    <span role="img" aria-label={word} title={word} className={`inline-flex flex-none ${tone}`}>
      <Icon size={size} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />
    </span>
  );
}

/** A label as GitHub colours it: a dot in its colour and its name in the text colour, so the colour never has to carry the words. */
export function LabelChip({ label }: { label: PullLabel }) {
  const hex = /^[0-9a-f]{6}$/i.test(label.colour) ? `#${label.colour}` : "var(--other)";
  return (
    <span className="inline-flex h-5 max-w-40 flex-none items-center gap-1.5 rounded-full border border-line px-2 text-xs whitespace-nowrap text-secondary" title={label.name}>
      <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: hex }} />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

const BADGE: Record<PullReviewState, { bg: string; Glyph: typeof Check | null }> = {
  approved: { bg: "bg-added-solid", Glyph: Check },
  changes_requested: { bg: "bg-removed-solid", Glyph: X },
  commented: { bg: "bg-(--other)", Glyph: null },
  dismissed: { bg: "bg-(--other)", Glyph: Minus },
};

/** A reviewer's face with what their last review said: a tick for approved, a cross for changes asked for, a plain dot for a comment. */
export function Reviewer({ login, state, size = 20 }: { login: string; state: PullReviewState | null; size?: 20 | 24 }) {
  const look = state ? BADGE[state] : null;
  return (
    <span className="relative inline-flex flex-none" title={`${login}${state ? `: ${REVIEW_WORDS[state]}` : ""}`}>
      <Face login={login} name={login} size={size} edge="surface" />
      {look && (
        <span aria-hidden className={`absolute -end-1 -bottom-1 grid size-3 place-items-center rounded-full text-on-brand ring-2 ring-(--color-background-surface) ${look.bg}`}>
          {look.Glyph && <look.Glyph size={8} strokeWidth={3.5} />}
        </span>
      )}
    </span>
  );
}

/** A pull request's size: its bucket letter, and the lines added and removed exactly. */
export function Size({ additions, deletions, className = "" }: { additions: number; deletions: number; className?: string }) {
  const lines = additions + deletions;
  const size = pullSizeOf(lines);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`} title={sizeTitle(size, lines)}>
      <span className="inline-grid h-5 min-w-6 place-items-center rounded-xs bg-sunken px-1 text-xs font-semibold text-secondary" aria-label={`Size ${sizeLabel(size)}`}>
        {sizeLabel(size)}
      </span>
      <span className="text-sm tnum">
        <span className="text-added">+{grouped(additions)}</span> <span className="text-removed">−{grouped(deletions)}</span>
      </span>
    </span>
  );
}
