export type Unit = "day" | "week" | "month" | "quarter" | "year";

export type Bucket = { from: number; to: number; key: string; label: string; short: string; tick?: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

const ymd = (d: number) => {
  const t = new Date(d * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate() };
};
const dayOf = (y: number, m: number) => Date.UTC(y, m, 1) / DAY_MS;

/** The period a chart counts in, by how many days it covers: fine enough to show a shape, coarse enough to stay readable. */
export function unitFor(days: number, fine: boolean): Unit {
  if (days <= 120) return "day";
  if (fine && days <= 550) return "week";
  if (days <= (fine ? 4 : 3) * 366) return "month";
  if (days <= 16 * 366) return "quarter";
  return "year";
}

function startOf(unit: Unit, d: number): number {
  const { y, m } = ymd(d);
  if (unit === "day") return d;
  if (unit === "week") return d - ((d + 3) % 7);
  if (unit === "month") return dayOf(y, m);
  if (unit === "quarter") return dayOf(y, m - (m % 3));
  return dayOf(y, 0);
}

function next(unit: Unit, d: number): number {
  const { y, m } = ymd(d);
  if (unit === "day") return d + 1;
  if (unit === "week") return d + 7;
  if (unit === "month") return dayOf(y, m + 1);
  if (unit === "quarter") return dayOf(y, m + 3);
  return dayOf(y + 1, 0);
}

function words(unit: Unit, d: number): { label: string; short: string } {
  const { y, m, day } = ymd(d);
  if (unit === "day") return { label: `${day} ${MONTHS[m]} ${y}`, short: `${day} ${MONTHS[m]}` };
  if (unit === "week") return { label: `Week of ${day} ${MONTHS[m]} ${y}`, short: `${day} ${MONTHS[m]}` };
  if (unit === "month") return { label: `${MONTHS[m]} ${y}`, short: `${MONTHS[m]} ${String(y).slice(2)}` };
  if (unit === "quarter") return { label: `Q${Math.floor(m / 3) + 1} ${y}`, short: `Q${Math.floor(m / 3) + 1} ${String(y).slice(2)}` };
  return { label: String(y), short: String(y) };
}

function ticks(unit: Unit, list: Bucket[], most: number): void {
  const first = list[0]?.from ?? 0;
  const last = list.at(-1)?.from ?? 0;
  const years = ymd(last).y - ymd(first).y;
  const candidates: [number, string][] = [];
  list.forEach((b, i) => {
    const { y, m, day } = ymd(b.from);
    const prev = i > 0 ? ymd(list[i - 1]?.from ?? 0) : null;
    if (unit === "day") candidates.push([i, `${day} ${MONTHS[m]}`]);
    else if (years >= 2 || unit === "quarter" || unit === "year") {
      if (!prev || prev.y !== y) candidates.push([i, String(y)]);
    } else if (!prev || prev.m !== m) candidates.push([i, m === 0 ? String(y) : (MONTHS[m] ?? "")]);
  });
  const every = Math.max(1, Math.ceil(candidates.length / most));
  candidates.forEach(([i, text], k) => {
    const b = list[i];
    if (b && k % every === 0) b.tick = text;
  });
}

/** The periods covering `days` days from `firstDay`, each clipped to them, with a label, a short label and a tick where an axis should name it. */
export function buckets(firstDay: number, days: number, fine: boolean, most = 8): Bucket[] {
  if (days <= 0) return [];
  const unit = unitFor(days, fine);
  const end = firstDay + days;
  const out: Bucket[] = [];
  for (let at = startOf(unit, firstDay); at < end; at = next(unit, at)) {
    const from = Math.max(at, firstDay);
    out.push({ from, to: Math.min(next(unit, at), end), key: String(at), ...words(unit, at) });
  }
  ticks(unit, out, most);
  return out;
}

/** Sums a day-by-day series into the periods given. */
export function sum(values: number[], firstDay: number, list: Bucket[]): number[] {
  return list.map((b) => {
    let n = 0;
    for (let d = b.from; d < b.to; d++) n += values[d - firstDay] ?? 0;
    return n;
  });
}
