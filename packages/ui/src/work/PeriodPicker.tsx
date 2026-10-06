import { useState, useSyncExternalStore } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Calendar, type DateRange, type ISODateString } from "@astryxdesign/core/Calendar";
import { Popover } from "@astryxdesign/core/Popover";
import { CalendarDays, CalendarRange, Check, ChevronDown, ChevronLeft } from "lucide-react";
import { periodDates, PERIODS, type Period } from "@commitscape/data";
import { ICON } from "../design/tokens";
import { presetOf, shortRange } from "./helpers";

const LABELS: Record<Period, string> = { "last-month": "Last month", "this-month": "This month", "last-3-months": "Last 3 months", "this-year": "This year", "last-year": "Last year" };

const length = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 720px)").matches;
const listen = (on: () => void) => {
  const q = window.matchMedia("(min-width: 720px)");
  q.addEventListener("change", on);
  return () => q.removeEventListener("change", on);
};

/** One switcher for a period: the named periods, and a custom range picked on a calendar, at most a year long. Opens on its own, or as `isOpen` says. */
export function PeriodPicker({ from, to, onChange, isOpen, onOpenChange }: { from: string; to: string; onChange: (period: { from: string; to: string }) => void; isOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [shown, setShown] = useState(false);
  const open = isOpen ?? shown;
  const setOpen = onOpenChange ?? setShown;
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<DateRange>({ start: from as ISODateString, end: to as ISODateString });
  const [was, setWas] = useState(open);
  const twoMonths = useSyncExternalStore(listen, wide, () => false);
  const preset = presetOf(from, to);
  const today = new Date().toISOString().slice(0, 10) as ISODateString;
  if (open !== was) {
    setWas(open);
    if (open) {
      setCustom(!preset);
      setDraft({ start: from as ISODateString, end: to as ISODateString });
    }
  }
  const pick = (next: { from: string; to: string }) => {
    setOpen(false);
    if (next.from !== from || next.to !== to) onChange(next);
  };
  const toggle = (on: boolean) => setOpen(on);
  const content = (
    <div className="flex max-w-full flex-col sm:flex-row">
      <ul className={`m-0 list-none flex-col gap-0.5 p-1.5 ${custom ? "hidden border-line sm:flex sm:w-56 sm:flex-none sm:border-e" : "flex w-full sm:min-w-64"}`} aria-label="Periods">
        {PERIODS.map(([p]) => {
          const d = periodDates(p);
          const on = p === preset;
          return (
            <li key={p}>
              <button type="button" onClick={() => pick(d)} className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 px-2.5 py-2 text-start text-primary transition-colors hover:bg-overlay-hover ${on ? "bg-overlay-hover" : "bg-transparent"}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="type-label">{LABELS[p]}</span>
                  <span className="type-caption tnum">{shortRange(d.from, d.to)}</span>
                </span>
                {on && <Check size={ICON.md} className="flex-none text-brand" aria-label="Chosen" />}
              </button>
            </li>
          );
        })}
        <li className="mx-1 my-1 h-px bg-line" aria-hidden />
        <li>
          <button type="button" onClick={() => setCustom(true)} className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 px-2.5 py-2 text-start text-primary transition-colors hover:bg-overlay-hover ${custom ? "bg-overlay-hover" : "bg-transparent"}`}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="type-label">Custom</span>
              <span className="type-caption">Any days, up to a year</span>
            </span>
            {preset ? <CalendarDays size={ICON.md} className="flex-none text-secondary" aria-hidden /> : <Check size={ICON.md} className="flex-none text-brand" aria-label="Chosen" />}
          </button>
        </li>
      </ul>
      {custom && (
        <div className="flex min-w-0 flex-col gap-3 p-3">
          <button type="button" onClick={() => setCustom(false)} className="inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 type-caption hover:text-primary sm:hidden">
            <ChevronLeft size={ICON.sm} aria-hidden /> Named periods
          </button>
          <Calendar mode="range" numberOfMonths={twoMonths ? 2 : 1} value={draft} onChange={setDraft} max={today} maxRangeSpan={366} weekStartsOn="mon" />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-sm tnum">
              <span className="font-medium">{shortRange(draft.start, draft.end)}</span>
              <span className="text-secondary"> · {length(draft.start, draft.end)} days</span>
            </span>
            <div className="flex gap-2">
              <Button label="Cancel" variant="ghost" size="sm" onClick={() => setOpen(false)} />
              <Button label="Show these days" variant="primary" size="sm" onClick={() => pick({ from: draft.start, to: draft.end })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
  return (
    <Popover label="Choose a period" isOpen={open} onOpenChange={toggle} content={content} padding={0} placement="below" alignment="start">
      <button type="button" className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-line bg-surface ps-3 pe-2.5 text-base text-primary transition-colors hover:border-line-strong sm:w-auto" aria-label={`Period: ${preset ? LABELS[preset] : "Custom"}, ${shortRange(from, to)}`}>
        <CalendarRange size={ICON.md} className="flex-none text-secondary" aria-hidden />
        <span className="font-medium whitespace-nowrap">{preset ? LABELS[preset] : "Custom"}</span>
        <span className="min-w-0 flex-1 truncate text-start text-sm text-secondary tnum">{shortRange(from, to)}</span>
        <ChevronDown size={ICON.md} className="flex-none text-secondary" aria-hidden />
      </button>
    </Popover>
  );
}
