import { Flame } from "lucide-react";
import { Chip, Face } from "@commitscape/ui";
import { heat, ICON } from "@commitscape/ui/design";
import { BEAT, DURATION, GSAP_EASE, useScene } from "@commitscape/ui/motion";
import { CALENDAR_WEEKS, DAN, levels } from "./data";
import { compact, count, whole } from "./kit";
import { Mini } from "./parts";

const STATS = [
  { label: "pull requests merged", value: DAN.merged, format: whole },
  { label: "reviews given", value: DAN.reviews, format: whole },
  { label: "lines still running", value: DAN.lines, format: compact },
];

const CELLS = levels(CALENDAR_WEEKS * 7, 3);

/**
 * A Profile filling in. It opens finished; then the year empties back to grey days, and the numbers count up again as
 * the year lights up week by week.
 */
export function ProfileScene() {
  const ref = useScene(
    (tl, q) => {
      const lit = q("[data-lit]");
      const streak = q("[data-streak]");
      const nums = q("[data-num]");
      tl.addLabel("shown", 0);
      tl.addLabel("empty", BEAT.hold);
      tl.to(lit, { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in, stagger: { amount: DURATION.slow, from: "end" } }, "empty");
      nums.forEach((el, i) => {
        const s = STATS[i];
        if (s) count(tl, el, s.value, 0, "empty", { format: s.format, duration: DURATION.slow + DURATION.base });
      });
      tl.addLabel("fill", `empty+=${DURATION.slow + DURATION.base + BEAT.short}`);
      tl.fromTo(lit, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: DURATION.base, ease: GSAP_EASE.pop, stagger: { amount: BEAT.long }, immediateRender: false }, "fill");
      nums.forEach((el, i) => {
        const s = STATS[i];
        if (s) count(tl, el, 0, s.value, "fill", { format: s.format, duration: BEAT.long + DURATION.base, prime: false });
      });
      tl.fromTo(streak, { scale: 1 }, { scale: 1.08, duration: DURATION.fast, yoyo: true, repeat: 1, ease: GSAP_EASE.inOut, immediateRender: false }, `fill+=${BEAT.long}`);
    },
    { still: "shown", repeatDelay: 0 },
  );
  return (
    <div ref={ref} className="flex size-full items-center justify-center">
      <Mini className="w-full max-w-[38rem] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Face login={DAN.login} name={DAN.name} size={36} />
          <div className="flex min-w-0 flex-col">
            <span className="type-label">{DAN.name}</span>
            <span className="type-caption">@{DAN.login}</span>
          </div>
          <span data-streak className="ms-auto flex">
            <Chip tone="brand" icon={<Flame size={ICON.xs} aria-hidden />}>
              {DAN.streak}-day streak
            </Chip>
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {STATS.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col gap-1">
              <span data-num className="type-stat-sm text-primary sm:type-stat">
                {s.format(s.value)}
              </span>
              <span className="type-micro">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end overflow-hidden">
          <div className="grid flex-none grid-flow-col grid-rows-7 gap-[3px]">
            {CELLS.map((v, i) => (
              <span key={i} className="relative size-[9px] rounded-cell bg-heat-0">
                {v > 0 && <span data-lit className="absolute inset-0 rounded-cell" style={{ background: heat(v) }} />}
              </span>
            ))}
          </div>
        </div>
      </Mini>
    </div>
  );
}
