import { BEAT, DURATION, GSAP_EASE, STAGGER, useScene } from "@commitscape/ui/motion";
import { Face } from "@commitscape/ui";
import { ANDREW, DAN, VERSUS } from "./data";
import { compact, count, whole } from "./kit";
import { Mini } from "./parts";

const short = (n: number) => (n >= 10_000 ? compact(n) : whole(n));

/** Two people's numbers race view by view; each view gets its own winner. */
export function VersusScene() {
  const ref = useScene(
    (tl, q) => {
      const bars = q("[data-vbar]");
      const wins = q("[data-win]");
      tl.addLabel("shown", 0);
      tl.addLabel("out", BEAT.hold);
      tl.to(bars, { scaleX: 0, duration: DURATION.base, ease: GSAP_EASE.in }, "out");
      tl.to(wins, { scale: 0, opacity: 0, duration: DURATION.fast, ease: GSAP_EASE.in }, "out");
      tl.addLabel("in", `out+=${DURATION.base}`);
      q("[data-vrow]").forEach((row, i) => {
        const r = VERSUS[i];
        if (!r) return;
        const at = `in+=${i * STAGGER.loose * 2}`;
        const pair = Array.from(row.querySelectorAll("[data-vbar]"));
        const [a, b] = Array.from(row.querySelectorAll("[data-vnum]"));
        const win = row.querySelector("[data-win]");
        count(tl, a, r.a, 0, "out", { format: short, suffix: r.unit, duration: DURATION.base });
        count(tl, b, r.b, 0, "out", { format: short, suffix: r.unit, duration: DURATION.base });
        tl.fromTo(pair, { scaleX: 0 }, { scaleX: 1, duration: DURATION.scene, ease: GSAP_EASE.out, immediateRender: false }, at);
        count(tl, a, 0, r.a, at, { format: short, suffix: r.unit, duration: DURATION.scene, prime: false });
        count(tl, b, 0, r.b, at, { format: short, suffix: r.unit, duration: DURATION.scene, prime: false });
        tl.fromTo(win ?? {}, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: DURATION.base, ease: GSAP_EASE.pop, immediateRender: false }, `${at}+=${DURATION.scene - DURATION.fast}`);
      });
    },
    { still: "shown", repeatDelay: 0 },
  );
  return (
    <div ref={ref} className="flex size-full items-center justify-center">
      <Mini className="w-full max-w-[20rem] px-4 pt-3.5 pb-2">
        <div className="flex items-center justify-between text-xs font-medium text-primary">
          <span className="flex items-center gap-2">
            <Face login={DAN.login} name={DAN.name} size={24} />
            {DAN.login}
          </span>
          <span className="rounded-full border border-line px-2 py-px type-eyebrow">vs</span>
          <span className="flex items-center gap-2">
            {ANDREW.login}
            <Face login={ANDREW.login} name={ANDREW.name} size={24} />
          </span>
        </div>
        <div className="mt-3 flex flex-col">
          {VERSUS.map((r) => {
            const max = Math.max(r.a, r.b);
            const leftWins = r.a > r.b;
            return (
              <div key={r.label} data-vrow className="flex flex-col gap-1 border-t border-line py-2">
                <div className="flex items-center justify-between text-2xs">
                  <span data-vnum className={`tnum ${leftWins ? "font-semibold text-primary" : "text-secondary"}`}>
                    {short(r.a)}
                    {r.unit}
                  </span>
                  <span className="truncate px-2 text-secondary">{r.label}</span>
                  <span data-vnum className={`tnum ${leftWins ? "text-secondary" : "font-semibold text-primary"}`}>
                    {short(r.b)}
                    {r.unit}
                  </span>
                </div>
                <div className="relative grid grid-cols-2 gap-0.5">
                  <span className="flex justify-end">
                    <span data-vbar className={`h-1.5 origin-right rounded-s-full ${leftWins ? "bg-brand" : "bg-line-strong"}`} style={{ width: `${(r.a / max) * 100}%` }} />
                  </span>
                  <span className="flex">
                    <span data-vbar className={`h-1.5 origin-left rounded-e-full ${leftWins ? "bg-line-strong" : "bg-brand"}`} style={{ width: `${(r.b / max) * 100}%` }} />
                  </span>
                  <span data-win className={`absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-brand ring-[3px] ring-brand-soft ${leftWins ? "-start-[3px]" : "-end-[3px]"}`} />
                </div>
              </div>
            );
          })}
        </div>
      </Mini>
    </div>
  );
}
