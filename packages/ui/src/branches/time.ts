export const DAY = 86_400;

export type Span = { from: number; to: number };

export type Tick = { day: number; label: string; major: boolean };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The day, counted from 1 January 1970 in UTC, that a time in seconds falls on. */
export const dayOf = (seconds: number): number => Math.floor(seconds / DAY);

/** Where a time falls across a span: 0 at its start, 1 at its end. */
export const fractionOf = (span: Span, seconds: number): number => (seconds / DAY - span.from) / Math.max(1, span.to - span.from);

const startOfMonth = (year: number, month: number): number => Date.UTC(year, month, 1) / 86_400_000;

type Step = { unit: "day" | "month" | "year"; n: number };

const STEPS: Step[] = [
  { unit: "day", n: 1 },
  { unit: "day", n: 2 },
  { unit: "day", n: 7 },
  { unit: "day", n: 14 },
  { unit: "month", n: 1 },
  { unit: "month", n: 2 },
  { unit: "month", n: 3 },
  { unit: "month", n: 6 },
  { unit: "year", n: 1 },
  { unit: "year", n: 2 },
  { unit: "year", n: 5 },
  { unit: "year", n: 10 },
  { unit: "year", n: 20 },
];

const MONDAY = 4;

function daysOf(step: Step, span: Span): number[] {
  const out: number[] = [];
  if (step.unit === "day") {
    const offset = step.n === 7 ? MONDAY : 0;
    for (let d = Math.ceil((span.from - offset) / step.n) * step.n + offset; d <= span.to; d += step.n) out.push(d);
    return out;
  }
  const first = new Date(span.from * 86_400_000);
  let year = first.getUTCFullYear();
  let month = step.unit === "year" ? 0 : first.getUTCMonth();
  for (let guard = 0; guard < 2000; guard++) {
    const aligned = step.unit === "year" ? year % step.n === 0 : month % step.n === 0;
    const day = startOfMonth(year, month);
    if (day > span.to) break;
    if (aligned && day >= span.from) out.push(day);
    if (step.unit === "year") year += 1;
    else if (month === 11) {
      month = 0;
      year += 1;
    } else month += 1;
  }
  return out;
}

function labelOf(step: Step, day: number): Tick {
  const at = new Date(day * 86_400_000);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  if (step.unit === "year") return { day, label: String(year), major: true };
  if (step.unit === "month") return month === 0 ? { day, label: String(year), major: true } : { day, label: MONTHS[month] ?? "", major: false };
  return { day, label: `${at.getUTCDate()} ${MONTHS[month] ?? ""}`, major: at.getUTCDate() === 1 };
}

/** Marks along a span of days at calendar boundaries, the finest step that keeps them to `max`. */
export function ticksOf(span: Span, max: number): Tick[] {
  if (span.to <= span.from) return [];
  for (const step of STEPS) {
    const days = daysOf(step, span);
    if (days.length <= max) return days.map((d) => labelOf(step, d));
  }
  return [];
}

/** A day as a short date: "12 Oct 2025". */
export function dayWords(day: number): string {
  const at = new Date(day * 86_400_000);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()] ?? ""} ${at.getUTCFullYear()}`;
}

/** The span, kept inside `extent`, that is `size` days wide and starts at `from`, or as near as fits. */
export function clampSpan(from: number, size: number, extent: Span): Span {
  const width = Math.min(Math.max(1, size), extent.to - extent.from);
  const start = Math.min(Math.max(from, extent.from), extent.to - width);
  return { from: start, to: start + width };
}

/** How many of these times, in seconds, fall in each of `n` equal slices of a span. */
export function binTimes(times: readonly number[], span: Span, n: number): number[] {
  const bins = new Array<number>(n).fill(0);
  const width = Math.max(1, span.to - span.from);
  for (const t of times) {
    const at = (t / DAY - span.from) / width;
    if (at < 0 || at >= 1) continue;
    const slot = Math.min(n - 1, Math.floor(at * n));
    bins[slot] = (bins[slot] ?? 0) + 1;
  }
  return bins;
}
