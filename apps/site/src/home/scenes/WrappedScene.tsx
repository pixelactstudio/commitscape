import { CalendarDays, Code2, Flame } from "lucide-react";
import { heat, ICON } from "@commitscape/ui/design";
import { BEAT, DISTANCE, DURATION, gsap, GSAP_EASE, STAGGER, useScene } from "@commitscape/ui/motion";
import { levels, YEAR } from "./data";

const YEARS = Array.from({ length: 8 }, (_, i) => YEAR - 7 + i);
const DAYS = levels(20 * 7, 9);
const CHIPS = [
  { icon: CalendarDays, label: "busiest day" },
  { icon: Code2, label: "top language" },
  { icon: Flame, label: "longest streak" },
];

const at = (i: number) => -(i * 100) / YEARS.length;

/** A year's Wrapped: it opens on this year; then the counter rolls up from years back, the days light up and the highlights appear. */
export function WrappedScene() {
  const ref = useScene(
    (tl, q) => {
      const list = q("[data-years]")[0];
      const year = q("[data-year]")[0];
      const lit = q("[data-lit]");
      const chips = q("[data-chip]");
      if (list) gsap.set(list, { y: 0, yPercent: at(YEARS.length - 1) });
      tl.addLabel("shown", 0);
      tl.addLabel("out", BEAT.hold);
      tl.to(lit, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in, stagger: { amount: DURATION.base, from: "end" } }, "out");
      tl.to(chips, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.fast, ease: GSAP_EASE.in, stagger: STAGGER.tight }, "out");
      tl.to(year ?? {}, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, "out");
      tl.set(list ?? {}, { yPercent: at(0) }, ">");
      tl.to(year ?? {}, { opacity: 1, duration: DURATION.base }, ">");
      YEARS.slice(1).forEach((_, i) => {
        const last = i === YEARS.length - 2;
        tl.to(list ?? {}, { yPercent: at(i + 1), duration: last ? DURATION.slow : DURATION.fast, ease: last ? GSAP_EASE.pop : GSAP_EASE.inOut }, i === 0 ? ">" : `+=${STAGGER.base}`);
      });
      tl.fromTo(year ?? {}, { scale: 1 }, { scale: 1.06, duration: DURATION.fast, yoyo: true, repeat: 1, ease: GSAP_EASE.inOut, immediateRender: false }, ">");
      tl.fromTo(lit, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: { amount: DURATION.scene }, immediateRender: false }, "<");
      tl.fromTo(chips, { opacity: 0, y: DISTANCE.nudge }, { opacity: 1, y: 0, duration: DURATION.base, stagger: STAGGER.loose, immediateRender: false }, `-=${DURATION.slow}`);
    },
    { still: "shown", repeatDelay: 0 },
  );
  return (
    <div ref={ref} className="wrapped-stage relative flex size-full flex-col items-center justify-center gap-3 overflow-hidden text-on-stage">
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
