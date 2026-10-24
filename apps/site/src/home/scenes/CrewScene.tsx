import { Crown } from "lucide-react";
import { Chip, Face } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { CREW } from "./data";
import { Mini, MiniHead } from "./parts";

const MAX = Math.max(...CREW.map((c) => c.merged));
const LEAD = CREW.reduce((best, c, i) => (c.merged > (CREW[best]?.merged ?? 0) ? i : best), 0);

/** A Crew's Season, drawn with made-up people: who leads the month in pull requests merged, and the recap Card to come. */
export function CrewScene() {
  return (
    <div className="relative flex size-full items-center justify-center">
      <Mini className="w-full max-w-80 overflow-hidden">
        <MiniHead title="Crew · The night shift" end={<span className="tnum">October</span>} />
        <div className="flex flex-col gap-2.5 px-4 py-3">
          {CREW.map((c, i) => (
            <div key={c.name} className="flex items-center gap-2.5">
              <Face login={null} name={c.name} size={24} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-1.5 text-2xs">
                  <span className={c.you ? "font-semibold text-primary" : "text-primary"}>{c.name}</span>
                  {i === LEAD && <Crown size={ICON.xs} className="text-(--s4)" aria-hidden />}
                  <span className="ms-auto text-secondary tnum">{c.merged}</span>
                </div>
                <span className="block h-1.5 overflow-hidden rounded-full bg-sunken">
                  <span className={`block h-full rounded-full ${c.you ? "bg-brand" : "bg-line-strong"}`} style={{ width: `${(c.merged * 100) / MAX}%` }} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex h-10 items-center justify-between border-t border-line px-4 type-micro">
          <span>Starts again on the 1st</span>
          <Chip tone="brand">Recap Card</Chip>
        </div>
      </Mini>
    </div>
  );
}
