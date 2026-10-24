export function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function compact(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [size, unit] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
    }
  }
  return grouped(n);
}

export function share(part: number, whole: number): string {
  if (whole === 0) return "—";
  const p = Math.round((part * 100) / whole);
  return p === 0 && part > 0 ? "<1%" : `${p}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A day as "4 Aug 2026": the same words in every browser and on the server, whatever the locale's own short month. */
export function day(days: number): string {
  const d = new Date(days * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function date(seconds: number): string {
  return day(Math.floor(seconds / 86_400));
}

export function duration(days: number): string {
  if (days < 45) return `${Math.max(0, Math.round(days))} ${Math.round(days) === 1 ? "day" : "days"}`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const years = Math.round((days / 365.25) * 10) / 10;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

export function many(n: number, one: string, more: string): string {
  return `${grouped(n)} ${n === 1 ? one : more}`;
}

export const WINDOW_WORDS: Record<string, string> = {
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  "1y": "the last year",
  all: "all time",
  range: "the dates chosen",
};


/** A Window in words that follow a count: "in the last 30 days", "over all time". */
export function within(window: string): string {
  if (window === "all") return "over all time";
  if (window === "range") return "over the dates chosen";
  return `in ${WINDOW_WORDS[window] ?? window}`;
}
