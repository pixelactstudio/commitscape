export type WindowRow = { login: string; name: string | null; prsMerged: number; reviews: number; commits: number; contributions: number };

export type WindowStandings = { from: string; to: string; at: number; rows: WindowRow[] };

export type WindowView = "prsMerged" | "reviews" | "commits" | "contributions";

export const WINDOW_VIEWS: { id: WindowView; label: string; unit: [string, string] }[] = [
  { id: "prsMerged", label: "Pull requests merged", unit: ["pull request merged", "pull requests merged"] },
  { id: "reviews", label: "Reviews given", unit: ["review", "reviews"] },
  { id: "commits", label: "Commits", unit: ["commit", "commits"] },
  { id: "contributions", label: "Contributions", unit: ["contribution", "contributions"] },
];

/** Who leads each view: everyone with the most, when the most is above zero. Never one winner overall. */
export function leadersOf(rows: WindowRow[]): Record<WindowView, string[]> {
  const out = {} as Record<WindowView, string[]>;
  for (const v of WINDOW_VIEWS) {
    const most = Math.max(0, ...rows.map((r) => r[v.id]));
    out[v.id] = most > 0 ? rows.filter((r) => r[v.id] === most).map((r) => r.login) : [];
  }
  return out;
}

/** The Season a day falls in: its calendar month on UTC's calendar, like 2026-10. */
export function seasonOf(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** A Season's first and last day. */
export function seasonDates(season: string): { from: string; to: string } {
  const [y = 0, m = 1] = season.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${season}-01`, to: `${season}-${String(last).padStart(2, "0")}` };
}

/** The Season before. */
export function previousSeason(season: string): string {
  const [y = 0, m = 1] = season.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

export type RaceState = "upcoming" | "running" | "finished";

/** Whether a Race has started, is running or has finished, on UTC's calendar. */
export function raceState(from: string, to: string, today: string = new Date().toISOString().slice(0, 10)): RaceState {
  if (today < from) return "upcoming";
  return today > to ? "finished" : "running";
}

export type Member = { login: string; state: "invited" | "accepted" | "declined"; invitedBy: string };

export type RaceView = { id: string; name: string; from: string; to: string; state: RaceState; createdBy: string; members: Member[]; standings: WindowStandings | null; you: Member | null };

export type CrewView = { id: string; name: string; createdBy: string; members: Member[]; season: string; standings: WindowStandings | null; last: WindowStandings | null; you: Member | null };
