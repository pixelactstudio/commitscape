import { Crown } from "lucide-react";
import { BEAT, DURATION, GSAP_EASE, useScene } from "@commitscape/ui/motion";
import { Face } from "@commitscape/ui";
import { RACERS } from "./data";
import { count } from "./kit";
import { Mini, MiniHead } from "./parts";

const DAYS = RACERS[0]?.days.length ?? 7;
const MAX = Math.max(...RACERS.flatMap((r) => r.days));

function leader(day: number) {
  let best = 0;
  RACERS.forEach((r, i) => {
    if ((r.days[day] ?? 0) > (RACERS[best]?.days[day] ?? 0)) best = i;
  });
  return best;
}

/** A week's Race between friends: day by day the bars grow and the lead changes hands. */
export function RaceScene() {
  const ref = useScene(
    (tl, q) => {
      const bars = q("[data-rbar]");
      const nums = q("[data-rnum]");
      const crowns = q("[data-crown]");
      const day = q("[data-day]")[0];
      const won = q("[data-won]")[0];
      const resets: (() => void)[] = [];
      tl.set(bars, { scaleX: 0 }, 0);
      tl.set(crowns, { opacity: 0, scale: 0.6 }, 0);
      tl.set(won ?? {}, { opacity: 0, scale: 0.8 }, 0);
      for (let d = 0; d < DAYS; d++) {
        const at = d === 0 ? BEAT.short : `+=${DURATION.base}`;
        tl.addLabel(`d${d}`, at);
        tl.call(() => day && (day.textContent = `Day ${d + 1} of ${DAYS}`), undefined, `d${d}`);
        RACERS.forEach((r, i) => {
          tl.to(bars[i] ?? {}, { scaleX: (r.days[d] ?? 0) / MAX, duration: DURATION.slow, ease: GSAP_EASE.out }, `d${d}`);
          const reset = count(tl, nums[i], d === 0 ? 0 : (r.days[d - 1] ?? 0), r.days[d] ?? 0, `d${d}`, { duration: DURATION.slow, prime: d === 0 });
          if (d === 0) resets.push(reset);
        });
        const lead = leader(d);
        tl.to(crowns, { opacity: (i) => (i === lead ? 1 : 0), scale: (i) => (i === lead ? 1 : 0.6), duration: DURATION.base, ease: GSAP_EASE.pop }, `d${d}`);
      }
      tl.to(won ?? {}, { opacity: 1, scale: 1, duration: DURATION.base, ease: GSAP_EASE.pop }, `+=${DURATION.base}`);
      tl.addLabel("shown");
      tl.to([...bars, won], { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
      tl.call(() => resets.forEach((reset) => reset()));
      tl.set(bars, { opacity: 1, scaleX: 0 });
    },
    { still: "shown" },
  );
  const last = DAYS - 1;
  const lead = leader(last);
  return (
    <div ref={ref} className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-[20rem] overflow-hidden">
        <MiniHead
          title="Race · pull requests merged"
          end={
            <span data-day className="tnum">
              Day {DAYS} of {DAYS}
            </span>
          }
        />
        <div className="flex flex-col gap-2.5 px-3.5 py-3">
          {RACERS.map((r, i) => (
            <div key={r.name} className="flex items-center gap-2.5">
              <Face login={null} name={r.name} size={24} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-1.5 text-[0.7rem]">
                  <span className={r.you ? "font-semibold text-primary" : "text-primary"}>{r.name}</span>
                  <Crown data-crown size={11} className="text-[var(--s4)]" style={{ opacity: i === lead ? 1 : 0 }} aria-hidden />
                  <span data-rnum className="ms-auto text-secondary tnum">
                    {r.days[last]}
                  </span>
                </div>
                <span className="block h-[5px] overflow-hidden rounded-full bg-[var(--color-background-muted)]">
                  <span data-rbar className={`block h-full w-full origin-left rounded-full ${r.you ? "bg-brand" : "bg-[var(--color-border-emphasized)]"}`} style={{ transform: `scaleX(${(r.days[last] ?? 0) / MAX})` }} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[0.66rem] text-secondary">
          <span>Ends Sunday at midnight</span>
          <span data-won className="rounded-full bg-brand-soft px-2 py-px font-medium text-brand">You won</span>
        </div>
      </Mini>
    </div>
  );
}
