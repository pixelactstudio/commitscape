import type { VersusRow } from "@commitscape/data";
import { compact, grouped, many } from "../format";

/** A view's number on a Versus Card. */
export function versusValue(r: VersusRow, n: number | null): string {
  if (n === null) return "—";
  if (r.view === "hoursToMerge") return n < 1 ? `${Math.max(1, Math.round(n * 60))} min` : n < 48 ? `${Math.round(n)} h` : `${Math.round(n / 24)} days`;
  if (r.view === "longestStreak" || r.view === "activeDays") return many(n, "day", "days");
  return n >= 10_000 ? compact(n) : grouped(n);
}
