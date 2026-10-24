import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { many } from "../format";
import { dayWords, type Span } from "./time";

export type Preset = { id: string; label: string; span: Span };

const same = (a: Span, b: Span) => a.from === b.from && a.to === b.to;

/** The days on view in words, and the spans that can be chosen in one press. */
export function RangeBar({ view, presets, onPick }: { view: Span; presets: Preset[]; onPick: (span: Span) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <output className="type-caption tnum" aria-live="polite">
        {dayWords(view.from)} to {dayWords(view.to - 1)} · {many(view.to - view.from, "day", "days")}
      </output>
      <div role="group" aria-label="Days to show" className="flex flex-wrap items-center gap-1">
        {presets.map((p) => (
          <ToggleButton key={p.id} label={p.label} size="sm" isPressed={same(p.span, view)} onPressedChange={() => onPick(p.span)}>
            {p.label}
          </ToggleButton>
        ))}
      </div>
    </div>
  );
}
