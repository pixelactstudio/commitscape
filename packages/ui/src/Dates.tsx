import { useState } from "react";
import { Calendar, type DateRange } from "@astryxdesign/core/Calendar";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Popover } from "@astryxdesign/core/Popover";
import { CalendarDays, X } from "lucide-react";
import { ICON } from "./design/tokens";
import { day } from "./format";
import type { Go, Route } from "./route";

const DAY = 86_400;

const isoDay = (days: number) => new Date(days * DAY * 1000).toISOString().slice(0, 10) as DateRange["start"];

const dayOf = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000 / DAY);

function wordsOf(from: number, to: number): string {
  const first = day(from);
  const last = day(to);
  if (from === to) return last;
  const year = first.slice(-4);
  return year === last.slice(-4) ? `${first.slice(0, -5)} – ${last}` : `${first} – ${last}`;
}

/** The Window as two dates: a quiet button that says "Any dates" or the dates chosen in the Site's own day format, opens a calendar to pick a range, and a button beside it that takes the range off. */
export function Dates({ route, go }: { route: Route; go: Go }) {
  const [open, setOpen] = useState(false);
  const [today] = useState(() => isoDay(Math.floor(Date.now() / 1000 / DAY)));
  const ranged = route.from !== undefined && route.to !== undefined;
  const value = ranged ? { start: isoDay(route.from as number), end: isoDay(route.to as number) } : null;
  return (
    <div className="flex h-7 w-full min-w-0 items-center gap-0.5">
      <Popover
        isOpen={open}
        onOpenChange={setOpen}
        placement="below"
        alignment="start"
        label="Choose the dates"
        content={
          <Calendar
            mode="range"
            max={today}
            value={value}
            weekStartsOn="mon"
            onChange={(r) => {
              go({ from: dayOf(r.start), to: dayOf(r.end), window: undefined });
              setOpen(false);
            }}
          />
        }
      >
        <button
          type="button"
          className="plain-button flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md ps-1.5 pe-2 text-start text-sm text-secondary transition-colors duration-(--duration-instant) hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <CalendarDays size={ICON.sm} strokeWidth={1.75} absoluteStrokeWidth aria-hidden className="flex-none" />
          <span className={`min-w-0 truncate ${ranged ? "font-medium text-primary tnum" : ""}`}>{ranged ? wordsOf(route.from as number, route.to as number) : "Any dates"}</span>
          <span className="sr-only">{ranged ? ", change the dates" : ", choose the dates"}</span>
        </button>
      </Popover>
      {ranged && <IconButton label="Clear the dates" tooltip="Back to the Window" variant="ghost" size="sm" icon={<X size={ICON.sm} aria-hidden />} onClick={() => go({ from: undefined, to: undefined })} />}
    </div>
  );
}
