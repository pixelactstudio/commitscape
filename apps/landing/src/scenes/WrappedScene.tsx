import { CalendarDays, Code2, Flame } from "lucide-react";
import { heat, ICON } from "@commitscape/ui/design";
import { levels } from "./data";
import { at, YEARS } from "./wrapped";

const DAYS = levels(20 * 7, 9);
const CHIPS = [
  { icon: CalendarDays, label: "busiest day" },
  { icon: Code2, label: "top language" },
  { icon: Flame, label: "longest streak" },
];

/** A year's Wrapped: it opens on this year; then the counter rolls up from years back, the days light up and the highlights appear. */
export function WrappedScene() {
  return (
    <div data-scene="wrapped" className="wrapped-stage relative flex size-full flex-col items-center justify-center gap-3 overflow-hidden text-on-stage">
      <span className="type-eyebrow text-on-stage-2!">Wrapped</span>
      <div data-year className="h-[1em] overflow-hidden text-5xl leading-none">
        <div data-years className="flex flex-col [will-change:transform]" style={{ transform: `translateY(${at(YEARS.length - 1)}%)` }}>
          {YEARS.map((y) => (
            <span key={y} className="block h-[1em] text-center font-semibold tracking-display tnum">
              {y}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 grid grid-flow-col grid-rows-7 gap-[2px]">
        {DAYS.map((v, i) => (
          <span key={i} className="relative size-[7px] rounded-cell" style={{ background: heat(0, "stage") }}>
            {v > 0 && <span data-lit className="absolute inset-0 rounded-cell" style={{ background: heat(v, "stage") }} />}
          </span>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-1.5">
        {CHIPS.map(({ icon: Glyph, label }) => (
          <span key={label} data-chip className="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-on-stage ring-1 ring-[var(--stage-cell-1)]" style={{ background: heat(0, "stage") }}>
            <Glyph size={ICON.xs} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
