import type { Profile } from "@commitscape/data";

export const DAY = 86_400;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const weekdayOf = (d: number) => (d + 3) % 7;

export const monthKey = (d: number) => new Date(d * DAY * 1000).toISOString().slice(0, 7);

export function monthLabel(key: string): string {
  const [y = "", m = "01"] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** The last 52 weeks and this one, from the Monday that starts them. */
export function lastYear(profile: Profile) {
  const { firstDay, days } = profile.calendar;
  const from = Math.max(0, days.length - 364 - (((firstDay + days.length - 1 + 3) % 7) + 1));
  return { firstDay: firstDay + from, days: days.slice(from) };
}

/** The longest run of days with a contribution in a list of days, and where it starts. */
export function longestRun(days: number[]): { length: number; start: number } {
  let best = { length: 0, start: -1 };
  let run = 0;
  days.forEach((n, i) => {
    run = n > 0 ? run + 1 : 0;
    if (run > best.length) best = { length: run, start: i - run + 1 };
  });
  return best;
}

const HEAT = [
  { from: 100, colour: "light-dark(#c2185b, #ff5fa2)", word: "Legendary" },
  { from: 30, colour: "light-dark(#d32f2f, #ff6b5e)", word: "On fire" },
  { from: 14, colour: "light-dark(#d9480f, #ff8a3d)", word: "Blazing" },
  { from: 7, colour: "light-dark(#b7791f, #f5b83d)", word: "Heating up" },
  { from: 3, colour: "light-dark(#0f8a6a, #3ccfa4)", word: "Warming up" },
  { from: 1, colour: "light-dark(#2a6fd6, #5aa2f0)", word: "Just lit" },
];

/** The colour and word for a streak of this many days, cool for short ones and hot for long ones. */
export function streakHeat(days: number): { colour: string; word: string } {
  return HEAT.find((h) => days >= h.from) ?? { colour: "var(--color-text-secondary)", word: "Not lit" };
}

/** What a person's commit clock can show: their commit times, nothing because they have no commits, or nothing because GitHub did not answer. */
export function clockState(profile: Profile): "shown" | "none" | "failed" {
  if (profile.clock && profile.clock.sampled > 0) return "shown";
  if (profile.clock) return "none";
  return profile.read.complete ? "failed" : "none";
}
