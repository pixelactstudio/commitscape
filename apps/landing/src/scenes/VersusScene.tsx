import { Face } from "@commitscape/ui/components/Face";
import { ANDREW, DAN, VERSUS } from "./data";
import { short } from "./format";
import { Mini } from "./parts";

/** Two people's numbers race view by view; each view gets its own winner. */
export function VersusScene() {
  return (
    <div data-scene="versus" className="flex size-full items-center justify-center">
      <Mini className="w-full max-w-80 px-4 pt-3.5 pb-2">
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
