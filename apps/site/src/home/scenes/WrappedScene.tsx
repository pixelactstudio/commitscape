import { CalendarDays, Code2, Flame } from "lucide-react";
import { BEAT, DISTANCE, DURATION, GSAP_EASE, STAGGER, useScene } from "@commitscape/ui/motion";
import { levels, YEAR } from "./data";

const LINE = 72;
const YEARS = Array.from({ length: 8 }, (_, i) => YEAR - 7 + i);
const DAYS = levels(20 * 7, 9);
const CHIPS = [
  { icon: CalendarDays, label: "busiest day" },
  { icon: Code2, label: "top language" },
  { icon: Flame, label: "longest streak" },
];

/** A year counter rolls up to this year, then the year fills in and its highlights appear. */
export function WrappedScene() {
  const ref = useScene(
    (tl, q) => {
      const list = q("[data-years]")[0];
      const year = q("[data-year]")[0];
      const days = q("[data-day]");
      const chips = q("[data-chip]");
      tl.set(list ?? {}, { y: 0 }, 0);
      tl.from(year ?? {}, { opacity: 0, duration: DURATION.base }, 0);
      YEARS.slice(1).forEach((_, i) => {
        const last = i === YEARS.length - 2;
        tl.to(list ?? {}, { y: -(i + 1) * LINE, duration: last ? DURATION.slow : DURATION.fast, ease: last ? GSAP_EASE.pop : GSAP_EASE.inOut }, i === 0 ? BEAT.short : `+=${STAGGER.base}`);
      });
      tl.fromTo(year ?? {}, { scale: 1 }, { scale: 1.06, duration: DURATION.fast, yoyo: true, repeat: 1, ease: GSAP_EASE.inOut }, ">");
      tl.from(days, { opacity: 0, scale: 0.3, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: { amount: DURATION.scene } }, "<");
      tl.from(chips, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.base, stagger: STAGGER.loose }, `-=${DURATION.slow}`);
      tl.addLabel("shown");
      tl.to([year, ...days, ...chips], { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
    },
    { still: "shown" },
  );
  return (
    <div ref={ref} className="wrapped-stage relative flex size-full flex-col items-center justify-center gap-3 overflow-hidden text-white">
      <span className="relative text-[0.68rem] font-medium tracking-[0.18em] text-white/70 uppercase">Wrapped</span>
      <div data-year className="relative overflow-hidden" style={{ height: LINE }}>
        <div data-years className="flex flex-col [will-change:transform]" style={{ transform: `translateY(${-(YEARS.length - 1) * LINE}px)` }}>
          {YEARS.map((y) => (
            <span key={y} className="block text-center text-[64px] font-semibold tracking-[-0.05em] tnum" style={{ height: LINE, lineHeight: `${LINE}px` }}>
              {y}
            </span>
          ))}
        </div>
      </div>
      <div className="relative grid grid-flow-col grid-rows-7 gap-[2px]">
        {DAYS.map((v, i) => (
          <span key={i} data-day={v ? "" : undefined} className="size-[7px] rounded-[2px]" style={{ background: v ? `rgb(255 255 255 / ${0.2 + v * 0.18})` : "rgb(255 255 255 / 0.08)" }} />
        ))}
      </div>
      <div className="relative flex flex-wrap justify-center gap-1.5">
        {CHIPS.map(({ icon: Glyph, label }) => (
          <span key={label} data-chip className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-[0.64rem] text-white/90 ring-1 ring-white/15">
            <Glyph size={10} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
