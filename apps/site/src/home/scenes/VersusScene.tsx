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
      const resets: (() => void)[] = [];
      tl.set(q("[data-vbar], [data-win]"), { opacity: 1 }, 0);
      q("[data-vrow]").forEach((row, i) => {
        const r = VERSUS[i];
        if (!r) return;
        const at = i * (DURATION.slow + STAGGER.loose);
        const [left, right] = Array.from(row.querySelectorAll("[data-vbar]"));
        const [a, b] = Array.from(row.querySelectorAll("[data-vnum]"));
        const win = row.querySelector("[data-win]");
        tl.from([left, right], { scaleX: 0, duration: DURATION.scene, ease: GSAP_EASE.out }, at);
        resets.push(count(tl, a, 0, r.a, at, { format: short, suffix: r.unit, duration: DURATION.scene }));
        resets.push(count(tl, b, 0, r.b, at, { format: short, suffix: r.unit, duration: DURATION.scene }));
        tl.from(win ?? {}, { scale: 0, opacity: 0, duration: DURATION.base, ease: GSAP_EASE.pop }, at + DURATION.scene - DURATION.fast);
      });
      tl.addLabel("shown");
      tl.to(q("[data-vbar], [data-win]"), { opacity: 0, duration: DURATION.base, ease: GSAP_EASE.in }, `+=${BEAT.hold}`);
      tl.call(() => resets.forEach((reset) => reset()));
    },
    { still: "shown" },
  );
  return (
    <div ref={ref} className="flex size-full items-center justify-center">
      <Mini className="w-full max-w-[20rem] px-3.5 pt-3 pb-2">
        <div className="flex items-center justify-between text-[0.74rem] font-medium text-primary">
          <span className="flex items-center gap-2">
            <Face login={DAN.login} name={DAN.name} size={24} />
            {DAN.login}
          </span>
          <span className="rounded-full border border-line px-2 py-px text-[0.62rem] tracking-[0.08em] text-secondary uppercase">vs</span>
          <span className="flex items-center gap-2">
            {ANDREW.login}
            <Face login={ANDREW.login} name={ANDREW.name} size={24} />
          </span>
        </div>
        <div className="mt-2.5 flex flex-col">
          {VERSUS.map((r) => {
            const max = Math.max(r.a, r.b);
            const leftWins = r.a > r.b;
            return (
              <div key={r.label} data-vrow className="flex flex-col gap-1 border-t border-line py-[7px]">
                <div className="flex items-center justify-between text-[0.68rem]">
                  <span data-vnum className={`tnum ${leftWins ? "font-semibold text-primary" : "text-secondary"}`}>
                    {short(r.a)}
                    {r.unit}
                  </span>
                  <span className="text-secondary">{r.label}</span>
                  <span data-vnum className={`tnum ${leftWins ? "text-secondary" : "font-semibold text-primary"}`}>
                    {short(r.b)}
                    {r.unit}
                  </span>
                </div>
                <div className="relative grid grid-cols-2 gap-[3px]">
                  <span className="flex justify-end">
                    <span data-vbar className={`h-[5px] origin-right rounded-s-full ${leftWins ? "bg-brand" : "bg-[var(--color-border-emphasized)]"}`} style={{ width: `${(r.a / max) * 100}%` }} />
                  </span>
                  <span className="flex">
                    <span data-vbar className={`h-[5px] origin-left rounded-e-full ${leftWins ? "bg-[var(--color-border-emphasized)]" : "bg-brand"}`} style={{ width: `${(r.b / max) * 100}%` }} />
                  </span>
                  <span data-win className={`absolute top-1/2 size-[7px] -translate-y-1/2 rounded-full bg-brand ring-[3px] ring-[var(--brand-soft)] ${leftWins ? "-start-[3px]" : "-end-[3px]"}`} />
                </div>
              </div>
            );
          })}
        </div>
      </Mini>
    </div>
  );
}
