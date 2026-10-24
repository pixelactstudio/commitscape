import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { heat } from "../design/tokens";
import { grouped, share } from "../format";
import { TableAction, TableView } from "./common";
import { useTip } from "./tip";
import { TipCard } from "./Tip";
import { peakOf, type Peak } from "./peak";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

function step(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n / max) * 4)));
}

export type WeekPick = { weekday?: number; hour?: number };

const WIDE = "grid-cols-[2.5rem_repeat(24,minmax(0,1fr))_4.5rem]";
const NARROW = "grid-cols-[3rem_repeat(7,minmax(0,1fr))]";

type Shared = { week: number[][]; unit: string; one: string; onPick?: (pick: WeekPick) => void; peak: Peak | null; max: number; all: number; byDay: number[]; byHour: number[] };

function useCells({ week, unit, one, onPick, peak, max, all }: Shared) {
  const tip = useTip();
  const average = all / 168;
  const [at, setAt] = useState<[number, number]>([peak?.day ?? 0, peak?.hour ?? 12]);
  const cell = (d: number, h: number, size: string) => {
    const n = week[d]?.[h] ?? 0;
    const top = peak !== null && peak.day === d && peak.hour === h;
    const words = `${WEEKDAYS[d]}s, ${hh(h)} to ${hh(h + 1)}`;
    const handlers = tip(
      <TipCard
        kicker={top ? "The busiest hour" : undefined}
        title={words}
        value={grouped(n)}
        unit={n === 1 ? one : unit}
        note={n > 0 ? `${share(n, all)} of all` : undefined}
        rows={n > 0 && average > 0 ? [{ label: "Against a typical hour", value: `${(n / average).toFixed(n / average >= 10 ? 0 : 1)}×` }] : []}
        hint={onPick && n > 0 ? `Select for these ${unit}` : undefined}
      />,
    );
    return (
      <span
        key={`${d}-${h}`}
        role="gridcell"
        aria-colindex={h + 1}
        aria-label={`${words}: ${grouped(n)} ${n === 1 ? one : unit}`}
        data-cell={`${d}-${h}`}
        tabIndex={at[0] === d && at[1] === h ? 0 : -1}
        className={`${size} rounded-cell hover:brightness-125 focus-visible:z-(--z-raised) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${top ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""} ${onPick && n > 0 ? "cursor-pointer" : ""}`}
        style={{ background: heat(step(n, max)) }}
        onClick={onPick && n > 0 ? () => onPick({ weekday: d, hour: h }) : undefined}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && onPick && n > 0) {
            e.preventDefault();
            onPick({ weekday: d, hour: h });
          }
        }}
        onFocus={(e) => {
          setAt([d, h]);
          handlers.onFocus(e);
        }}
        onBlur={handlers.onBlur}
        onMouseMove={handlers.onMouseMove}
        onMouseLeave={handlers.onMouseLeave}
      />
    );
  };
  return { at, setAt, cell, tip };
}

function arrow(e: KeyboardEvent<HTMLDivElement>, at: [number, number], across: "hour" | "day"): [number, number] | null {
  const [d, h] = at;
  const sideways = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  const vertical = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  const clamp = (n: number, top: number) => Math.max(0, Math.min(top, n));
  if (across === "hour") {
    if (sideways) return [d, clamp(h + sideways, 23)];
    if (vertical) return [clamp(d + vertical, 6), h];
    if (e.key === "Home") return e.ctrlKey ? [0, 0] : [d, 0];
    if (e.key === "End") return e.ctrlKey ? [6, 23] : [d, 23];
  } else {
    if (sideways) return [clamp(d + sideways, 6), h];
    if (vertical) return [d, clamp(h + vertical, 23)];
    if (e.key === "Home") return e.ctrlKey ? [0, 0] : [0, h];
    if (e.key === "End") return e.ctrlKey ? [6, 23] : [6, h];
  }
  return null;
}

function Wide(props: Shared) {
  const { week, unit, one, onPick, all, byDay, byHour } = props;
  const grid = useRef<HTMLDivElement>(null);
  const { at, setAt, cell, tip } = useCells(props);
  const hourMost = Math.max(1, ...byHour);
  const dayMost = Math.max(1, ...byDay);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = arrow(e, at, "hour");
    if (!next) return;
    e.preventDefault();
    setAt(next);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-cell="${next[0]}-${next[1]}"]`)?.focus());
  };
  return (
    <div className="hidden flex-col gap-0.75 type-micro tnum @min-[36rem]:flex">
      <div className={`grid ${WIDE} items-end gap-0.75`} aria-hidden>
        <span />
        {byHour.map((n, h) => (
          <span
            key={h}
            className={`flex h-7 items-end ${onPick && n > 0 ? "cursor-pointer" : ""}`}
            onClick={onPick && n > 0 ? () => onPick({ hour: h }) : undefined}
            {...tip(<TipCard kicker="Every day" title={`${hh(h)} to ${hh(h + 1)}`} value={grouped(n)} unit={n === 1 ? one : unit} note={`${share(n, all)} of all`} hint={onPick && n > 0 ? `Select for these ${unit}` : undefined} />)}
          >
            <span className="block w-full rounded-t-cell bg-heat-3" style={{ height: `${Math.max(n > 0 ? 6 : 0, (n * 100) / hourMost)}%` }} />
          </span>
        ))}
        <span />
      </div>
      <div ref={grid} role="grid" aria-label={`${unit} by weekday and hour`} aria-rowcount={7} aria-colcount={24} onKeyDown={move} className="flex flex-col gap-0.75">
        {week.map((hours, d) => (
          <div key={d} role="row" aria-rowindex={d + 1} className={`grid ${WIDE} items-center gap-0.75`}>
            <span role="rowheader" className="pe-1.5 text-end">
              {WEEKDAYS[d]?.slice(0, 3)}
            </span>
            {hours.map((_, h) => cell(d, h, "aspect-square"))}
            <span
              aria-hidden
              className={`flex h-full items-center gap-1.5 ps-1.5 ${onPick && (byDay[d] ?? 0) > 0 ? "cursor-pointer hover:text-primary" : ""}`}
              onClick={onPick && (byDay[d] ?? 0) > 0 ? () => onPick({ weekday: d }) : undefined}
              {...tip(<TipCard title={`${WEEKDAYS[d]}s`} value={grouped(byDay[d] ?? 0)} unit={(byDay[d] ?? 0) === 1 ? one : unit} note={`${share(byDay[d] ?? 0, all)} of all`} hint={onPick && (byDay[d] ?? 0) > 0 ? `Select for these ${unit}` : undefined} />)}
            >
              <span className="flex w-5 flex-none">
                <span className="block h-1.5 rounded-full bg-heat-3" style={{ width: `${Math.max((byDay[d] ?? 0) > 0 ? 12 : 0, ((byDay[d] ?? 0) * 100) / dayMost)}%` }} />
              </span>
              <span className="whitespace-nowrap">{share(byDay[d] ?? 0, all)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className={`grid ${WIDE} gap-0.75`} aria-hidden>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="relative h-4">
            {h % 6 === 0 && <span className="absolute start-0 top-0.5 whitespace-nowrap">{hh(h)}</span>}
          </span>
        ))}
        <span />
      </div>
    </div>
  );
}

function Narrow(props: Shared) {
  const { week, unit, one, onPick, all, byDay } = props;
  const grid = useRef<HTMLDivElement>(null);
  const { at, setAt, cell, tip } = useCells(props);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = arrow(e, at, "day");
    if (!next) return;
    e.preventDefault();
    setAt(next);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-cell="${next[0]}-${next[1]}"]`)?.focus());
  };
  const dayMost = Math.max(1, ...byDay);
  return (
    <div className="flex flex-col gap-1 type-micro tnum @min-[36rem]:hidden">
      <div className={`grid ${NARROW} items-end gap-0.5`} aria-hidden>
        <span />
        {week.map((_, d) => (
          <span
            key={d}
            className="flex flex-col items-center gap-1"
            onClick={onPick && (byDay[d] ?? 0) > 0 ? () => onPick({ weekday: d }) : undefined}
            {...tip(<TipCard title={`${WEEKDAYS[d]}s`} value={grouped(byDay[d] ?? 0)} unit={(byDay[d] ?? 0) === 1 ? one : unit} note={`${share(byDay[d] ?? 0, all)} of all`} hint={onPick && (byDay[d] ?? 0) > 0 ? `Select for these ${unit}` : undefined} />)}
          >
            <span className="block h-1.5 w-full rounded-full bg-track">
              <span className="block h-full rounded-full bg-heat-3" style={{ width: `${((byDay[d] ?? 0) * 100) / dayMost}%` }} />
            </span>
            <span>{WEEKDAYS[d]?.slice(0, 3)}</span>
          </span>
        ))}
      </div>
      <div ref={grid} role="grid" aria-label={`${unit} by weekday and hour`} aria-rowcount={24} aria-colcount={7} onKeyDown={move} className="flex flex-col gap-0.5">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} role="row" aria-rowindex={h + 1} className={`grid ${NARROW} items-center gap-0.5`}>
            <span role="rowheader" className="pe-2 text-end">
              <span className={h % 3 === 0 ? "" : "sr-only"}>{hh(h)}</span>
            </span>
            {week.map((_, d) => cell(d, h, "h-6"))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Commits by weekday and hour as a grid of cells on the authors' own clocks, with each hour's and each day's totals beside it and the busiest hour ringed. Wide, a row a weekday and a column an hour; narrow, turned so the 7 days fit a phone. One stop for the keyboard: arrows move between cells, Enter picks the cell's commits; each day's commits are also a button in the table beneath. */
export function WeekGrid({ week, unit = "commits", onPick }: { week: number[][]; unit?: string; onPick?: (pick: WeekPick) => void }) {
  const one = unit === "commits" ? "commit" : unit;
  const peak = peakOf(week);
  const max = Math.max(0, ...week.flat());
  const all = week.flat().reduce((a, b) => a + b, 0);
  const byHour = Array.from({ length: 24 }, (_, h) => week.reduce((n, hours) => n + (hours[h] ?? 0), 0));
  const byDay = week.map((hours) => hours.reduce((a, b) => a + b, 0));
  const shared: Shared = { week, unit, one, onPick, peak, max, all, byDay, byHour };
  const rows: ReactNode[][] = week.map((hours, d) => [
    WEEKDAYS[d] ?? "",
    ...hours,
    ...(onPick ? [(byDay[d] ?? 0) > 0 ? <TableAction key={d} onClick={() => onPick({ weekday: d })}>Show {WEEKDAYS[d]}s’ {unit}</TableAction> : ""] : []),
  ]);
  return (
    <figure aria-label={`${unit} by weekday and hour, on each author’s own clock`} className="@container m-0 flex min-w-0 flex-col gap-2">
      <Wide {...shared} />
      <Narrow {...shared} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 type-micro">
        <TableView title="Commits by weekday and hour" head={["Day", ...Array.from({ length: 24 }, (_, h) => `${h}`), ...(onPick ? ["Open"] : [])]} rows={rows} />
        <span className="flex items-center gap-1.5" role="img" aria-label={`From none to ${grouped(max)} ${unit} in one hour of the week; each shade is a step of the square root of the count`}>
          <span className="tnum">0</span>
          {[0, 1, 2, 3, 4].map((s) => (
            <span key={s} aria-hidden className="inline-block size-3 rounded-cell" style={{ background: heat(s) }} />
          ))}
          <span className="tnum">
            {grouped(max)} {unit} in an hour
          </span>
        </span>
      </div>
    </figure>
  );
}
