import { Flame } from "lucide-react";
import { Face } from "@commitscape/ui/components/Face";
import { heat, ICON } from "@commitscape/ui/design";
import { Chip } from "@commitscape/ui/kit/primitives";
import { CALENDAR_WEEKS, DAN, levels } from "./data";
import { compact, whole } from "./format";
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
  return (
    <div data-scene="profile" className="flex size-full items-center justify-center">
      <Mini className="w-full max-w-152 p-4 sm:p-5">
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
