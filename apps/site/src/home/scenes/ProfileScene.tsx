import { Flame } from "lucide-react";
import { BEAT, DISTANCE, DURATION, GSAP_EASE, STAGGER, useScene } from "@commitscape/ui/motion";
import { Face } from "@commitscape/ui";
import { CALENDAR_WEEKS, DAN, levels } from "./data";
import { compact, count, whole } from "./kit";
import { Mini } from "./parts";

const STATS = [
  { label: "pull requests merged", value: DAN.merged, format: whole },
  { label: "reviews given", value: DAN.reviews, format: whole },
  { label: "lines still running", value: DAN.lines, format: compact },
];

const CELLS = levels(CALENDAR_WEEKS * 7, 3);

/** A Profile filling in: the numbers count up and the last year lights up week by week. */
export function ProfileScene() {
  const ref = useScene(
    (tl, q) => {
      const stats = q("[data-stat]");
      const lit = q("[data-lit]");
      const streak = q("[data-streak]");
      tl.from(stats, { opacity: 0, y: DISTANCE.nudge, duration: DURATION.slow, stagger: STAGGER.loose }, 0);
      const resets = q("[data-num]").map((el, i) => count(tl, el, 0, STATS[i]?.value ?? 0, i * STAGGER.loose, { format: STATS[i]?.format, duration: BEAT.long }));
      tl.from(lit, { opacity: 0, scale: 0.3, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: { amount: BEAT.long } }, DURATION.fast);
      tl.from(streak, { opacity: 0, scale: 0.85, duration: DURATION.base, ease: GSAP_EASE.pop }, `>-${DURATION.base}`);
      tl.addLabel("shown");
      tl.to([...stats, ...lit, ...streak], { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
      tl.call(() => resets.forEach((reset) => reset()));
    },
    { still: "shown" },
  );
  return (
    <div ref={ref} className="flex size-full items-center justify-center">
      <Mini className="w-full max-w-[38rem] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Face login={DAN.login} name={DAN.name} size={36} />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[0.9rem] font-semibold text-primary">{DAN.name}</span>
            <span className="text-[0.75rem] text-secondary">@{DAN.login}</span>
          </div>
          <span data-streak className="ms-auto inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[0.72rem] font-medium text-brand">
            <Flame size={12} aria-hidden />
            {DAN.streak}-day streak
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {STATS.map((s) => (
            <div key={s.label} data-stat className="flex min-w-0 flex-col gap-0.5">
              <span data-num className="text-[1.3rem] leading-none font-semibold tracking-[-0.03em] text-primary tnum sm:text-[1.5rem]">
                {s.format(s.value)}
              </span>
              <span className="text-[0.7rem] leading-snug text-secondary">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end overflow-hidden">
          <div className="grid flex-none grid-flow-col grid-rows-7 gap-[3px]">
            {CELLS.map((v, i) =>
              v ? <span key={i} data-lit className="size-[9px] rounded-[2px]" style={{ background: `var(--green-${v})` }} /> : <span key={i} className="size-[9px] rounded-[2px] bg-[var(--empty)]" />,
            )}
          </div>
        </div>
      </Mini>
    </div>
  );
}
