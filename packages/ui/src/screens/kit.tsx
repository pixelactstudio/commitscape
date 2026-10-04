import type { ReactNode } from "react";
import { AreaTrend, StackedColumns, type Point } from "../charts/Trend";
import { buckets, sum } from "../charts/buckets";
import { useTip } from "../charts/tip";
import { day, grouped, WINDOW_WORDS } from "../format";

/** A Window in words that follow a count: "in the last 30 days", "over all time". */
export function within(window: string): string {
  if (window === "all") return "over all time";
  if (window === "range") return "over the dates chosen";
  return `in ${WINDOW_WORDS[window] ?? window}`;
}

/** A screen's column of Panels, faded while a new Window's numbers are on their way. */
export function ScreenFrame({ stale = false, children, label }: { stale?: boolean; children: ReactNode; label?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-4 pt-5 transition-opacity duration-200 ${stale ? "opacity-60" : ""}`} aria-busy={stale || undefined} aria-label={label}>
      {children}
    </div>
  );
}

/** A plain line saying there is nothing to show, and why. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="m-0 py-6 text-center text-sm text-pretty text-secondary">{children}</p>;
}

/** What went wrong reading an answer, in place of the screen. */
export function Failed({ words, action }: { words: string | null; action?: ReactNode }) {
  return (
    <ScreenFrame>
      <div className="flex flex-col items-center gap-4 rounded-[var(--radius-container)] border border-line bg-surface px-5 py-10 text-center text-sm text-pretty text-secondary">
        {words ?? "This part of the Report could not be read."}
        {action}
      </div>
    </ScreenFrame>
  );
}

/** A row of numbers in one bordered strip, each saying what it counts. */
export function NumberStrip({ children, columns = 5 }: { children: ReactNode; columns?: 4 | 5 | 6 | 7 }) {
  const lg = { 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6", 7: "lg:grid-cols-7" }[columns];
  return <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-container)] border border-line bg-[var(--color-border)] sm:grid-cols-3 ${lg}`}>{children}</div>;
}

/** One number of a NumberStrip. */
export function NumberCell({ id, value, label, note, tone }: { id: string; value: ReactNode; label: string; note?: ReactNode; tone?: "brand" }) {
  return (
    <div data-stat={id} className="flex min-w-0 flex-col gap-1 bg-surface px-4 py-4 sm:px-5">
      <span data-value className={`truncate text-[1.6rem] leading-none font-semibold tracking-[-0.03em] ${tone === "brand" ? "text-brand" : "text-primary"}`}>
        {value}
      </span>
      <span className="mt-1 truncate text-sm font-medium text-primary">{label}</span>
      <span className="truncate text-[0.8rem] text-secondary">{note ?? " "}</span>
    </div>
  );
}

export type BarItem = { key: string; label: ReactNode; value: number; shown: ReactNode; colour?: string; lead?: ReactNode; onClick?: () => void; title?: string };

/** Ranked bars, each with what it is and its number; rows that can be entered are buttons. */
export function BarList({ items, label, max }: { items: BarItem[]; label: string; max?: number }) {
  const most = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label={label}>
      {items.map((i) => {
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              {i.lead}
              <span className="truncate text-sm text-primary">{i.label}</span>
            </span>
            <span className="text-end text-[0.8rem] whitespace-nowrap text-secondary tnum">{i.shown}</span>
            <span className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-[var(--color-track)]" aria-hidden>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(i.value > 0 ? 1.5 : 0, (i.value * 100) / most)}%`, background: i.colour ?? "var(--s1)" }} />
            </span>
          </>
        );
        const grid = "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-element)] px-2 py-2 text-start";
        return (
          <li key={i.key}>
            {i.onClick ? (
              <button type="button" onClick={i.onClick} title={i.title} className={`${grid} cursor-pointer border-0 bg-transparent font-[inherit] transition-colors hover:bg-[var(--color-overlay-hover)]`}>
                {body}
              </button>
            ) : (
              <div className={grid} title={i.title}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type Release = { day: number; label: string };

/** Commits over time as one soft area, in periods that suit the span, with its releases as ticks beneath. */
export function TrendOverTime({ firstDay, days, unit, height = 240, releases }: { firstDay: number; days: number[]; unit: string; height?: number; releases?: Release[] }) {
  const list = buckets(firstDay, days.length, true);
  const sums = sum(days, firstDay, list);
  const points: Point[] = list.map((b, i) => ({ key: b.key, label: b.label, tick: b.tick, value: sums[i] ?? 0 }));
  return (
    <div className="flex flex-col gap-1">
      <AreaTrend points={points} series={{ key: "value", label: unit, colour: "var(--brand)" }} unit={unit} height={height} />
      {releases && <ReleaseRug firstDay={firstDay} days={days.length} releases={releases} buckets={list.map((b) => b.from)} />}
    </div>
  );
}

function ReleaseRug({ releases, buckets: starts, firstDay, days }: { releases: Release[]; buckets: number[]; firstDay: number; days: number }) {
  const tip = useTip();
  const inside = releases.filter((r) => r.day >= firstDay && r.day < firstDay + days);
  const n = starts.length;
  if (n < 2) return <div className="h-5" />;
  const at = (d: number) => {
    let i = 0;
    while (i + 1 < n && (starts[i + 1] ?? Infinity) <= d) i++;
    const from = starts[i] ?? 0;
    const to = starts[i + 1] ?? firstDay + days;
    return Math.max(0, Math.min(1, (i + (d - from) / Math.max(1, to - from) - 0.5) / (n - 1)));
  };
  return (
    <div className="relative ms-[34px] me-1 h-5" aria-label={`${grouped(inside.length)} releases`} role="img">
      {inside.length > 0 && <span className="absolute inset-x-0 top-2 h-px bg-[var(--color-border)]" aria-hidden />}
      {inside.map((r) => (
        <span
          key={`${r.label}${r.day}`}
          className="absolute top-0.5 h-3.5 w-2 -translate-x-1/2 cursor-default before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-[var(--color-text-secondary)] before:opacity-70 hover:before:bg-[var(--brand)] hover:before:opacity-100"
          style={{ left: `${at(r.day) * 100}%` }}
          {...tip(
            <>
              <strong>{r.label}</strong>
              <div className="note">released {day(r.day)}</div>
            </>,
          )}
        />
      ))}
    </div>
  );
}

export type Stack = { key: string; label: string; colour: string; days: number[] };

/** Several day-by-day series stacked into columns, in calendar periods that suit the span. */
export function StacksOverTime({ firstDay, stacks, unit, height = 260 }: { firstDay: number; stacks: Stack[]; unit: string; height?: number }) {
  const length = Math.max(0, ...stacks.map((s) => s.days.length));
  const list = buckets(firstDay, length, false);
  const sums = stacks.map((s) => sum(s.days, firstDay, list));
  const points: Point[] = list.map((b, i) => {
    const p: Point = { key: b.key, label: b.short };
    stacks.forEach((s, j) => {
      p[s.key] = sums[j]?.[i] ?? 0;
    });
    return p;
  });
  return <StackedColumns points={points} series={stacks.map((s) => ({ key: s.key, label: s.label, colour: s.colour }))} unit={unit} height={height} />;
}
