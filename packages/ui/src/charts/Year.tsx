import { useEffect, useRef } from "react";
import { day, grouped } from "../format";
import { TableView } from "./common";
import { useTip } from "./tip";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "", "Wed", "", "Fri", "", ""];
const CELL = 13;
const GAP = 3;
const LEFT = 28;
const TOP = 18;

function bounds(values: number[]): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [1, 1, 1, 1];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 1;
  const out = [at(0.25), at(0.5), at(0.75), sorted.at(-1) ?? 1];
  for (let i = 1; i < 4; i++) out[i] = Math.max(out[i] ?? 0, out[i - 1] ?? 0);
  return out;
}

function step(n: number, b: number[]): number {
  if (n <= 0) return 0;
  const i = b.findIndex((x) => n <= x);
  return i === -1 ? 4 : i + 1;
}

const fill = (s: number) => (s === 0 ? "var(--empty)" : `var(--green-${s})`);

/** A year of days as a grid of squares, a column a week from Monday, shaded by how much happened each day. */
export function YearGrid({ firstDay, days, unit = "contributions", label, table = true }: { firstDay: number; days: number[]; unit?: string; label?: string; table?: boolean }) {
  const tip = useTip();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const b = bounds(days);
  const weekday = (d: number) => (d + 3) % 7;
  const offset = weekday(firstDay);
  const weeks = Math.ceil((days.length + offset) / 7);
  const width = LEFT + weeks * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  const months: { x: number; label: string }[] = [];
  days.forEach((_, i) => {
    const date = new Date((firstDay + i) * 86_400_000);
    if (date.getUTCDate() === 1 || i === 0) {
      const col = Math.floor((i + offset) / 7);
      const x = LEFT + col * (CELL + GAP);
      if (months.length === 0 || x - (months.at(-1)?.x ?? 0) > 30) months.push({ x, label: MONTHS[date.getUTCMonth()] ?? "" });
    }
  });
  return (
    <div className="flex flex-col gap-3">
      <div ref={scroller} className="overflow-x-auto pb-1 [scrollbar-width:thin]">
        <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" style={{ minWidth: Math.round(width * 0.8) }} role="img" aria-label={label ?? `${unit} a day`}>
          {months.map((m) => (
            <text key={`${m.x}${m.label}`} x={m.x} y={10} className="fill-[var(--color-text-secondary)] text-[10px]">
              {m.label}
            </text>
          ))}
          {DAYS.map((d, i) =>
            d ? (
              <text key={d} x={0} y={TOP + i * (CELL + GAP) + CELL - 3} className="fill-[var(--color-text-secondary)] text-[10px]">
                {d}
              </text>
            ) : null,
          )}
          {days.map((n, i) => {
            const d = firstDay + i;
            const col = Math.floor((i + offset) / 7);
            return (
              <rect
                key={i}
                x={LEFT + col * (CELL + GAP)}
                y={TOP + weekday(d) * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={3}
                fill={fill(step(n, b))}
                className="transition-opacity hover:opacity-80"
                {...tip(
                  <>
                    <strong>
                      {grouped(n)} {unit}
                    </strong>
                    <div className="note">{day(d)}</div>
                  </>,
                )}
              />
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-secondary">
        {table ? <TableView head={["Day", unit]} rows={days.flatMap((n, i) => (n > 0 ? [[day(firstDay + i), n]] : []))} /> : <span />}
        <span className="flex items-center gap-1.5">
          Less
          {[0, 1, 2, 3, 4].map((s) => (
            <span key={s} className="inline-block size-[11px] rounded-[3px]" style={{ background: fill(s) }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
