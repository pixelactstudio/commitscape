import type { WindowStandings } from "@commitscape/data";
import { many } from "@commitscape/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

const parts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Two days as a short range: "1–7 Oct 2026", "28 Sep – 4 Oct 2026". */
export function shortRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  const end = `${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${end}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${end}`;
  return `${a.d}–${end}`;
}

/** Where a window stands today, on UTC's calendar: which day of how many, and how long until it starts or ends. */
export function windowClock(from: string, to: string, today: string = new Date().toISOString().slice(0, 10)) {
  const total = days(from, to) + 1;
  if (today < from) {
    const n = days(today, from);
    return { day: 0, total, words: n === 1 ? "Starts tomorrow" : `Starts in ${n} days` };
  }
  if (today > to) {
    const b = parts(to);
    return { day: total, total, words: `Finished on ${b.d} ${MONTHS[b.m - 1]} ${b.y}` };
  }
  const left = days(today, to);
  return { day: days(from, today) + 1, total, words: left === 0 ? "Last day" : left === 1 ? "Ends tomorrow" : `${left} days left` };
}

/** When a window's numbers were read, in words. */
export function readAt(standings: WindowStandings): string {
  return `${new Date(standings.at * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** How many people, in words. */
export const people = (n: number) => many(n, "person", "people");

/** The GitHub usernames typed into an invite field, without "@" and repeats. */
export function namesIn(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((n) => n.replace(/^@/, "")).filter(Boolean))];
}
