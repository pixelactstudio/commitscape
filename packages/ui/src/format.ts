/** Numbers in the words the interface uses. */

/** 1234567 → "1,234,567". */
export function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** 1234 → "1.2k", 2500000 → "2.5M". */
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

/** A part of a whole as a whole percentage; "—" when there is no whole. */
export function share(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part * 100) / whole)}%`;
}

/** A day since the epoch as "12 Mar 2026". */
export function day(days: number): string {
  return new Date(days * 86_400_000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Seconds since the epoch as "12 Mar 2026". */
export function date(seconds: number): string {
  return day(Math.floor(seconds / 86_400));
}

/** A length of time in days, in the largest unit that reads well. */
export function duration(days: number): string {
  if (days < 45) return `${Math.max(0, Math.round(days))} ${Math.round(days) === 1 ? "day" : "days"}`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const years = Math.round((days / 365.25) * 10) / 10;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

/** A count and its noun: "1 commit", "3 commits". */
export function many(n: number, one: string, more: string): string {
  return `${grouped(n)} ${n === 1 ? one : more}`;
}

/** The Window's words. */
export const WINDOW_WORDS: Record<string, string> = {
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  "1y": "the last year",
  all: "all time",
  range: "the dates chosen",
};

/** Why there is nothing from GitHub, or how far reading it has got. */
export function githubWhy(github: string, history: string): string {
  if (github.startsWith("unavailable")) return `Nothing from GitHub: ${github.replace(/^unavailable: /, "")}.`;
  if (history === "off") return "GitHub's history is not read here.";
  if (history === "unavailable") return "GitHub's history could not be read.";
  if (history === "complete") return "GitHub has no pull requests or issues in this window.";
  if (history.startsWith("stopped early")) return `Reading GitHub's history ${history}.`;
  return `Reading GitHub's history: ${history}…`;
}
