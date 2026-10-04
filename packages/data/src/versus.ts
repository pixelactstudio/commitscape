import type { Identity, ProfileTotals } from "./profile";

export type VersusSide = {
  identity: Pick<Identity, "login" | "name">;
  totals: ProfileTotals;
  surviving: number | null;
  thisMonth: { prsMerged: number; contributions: number };
};

export type VersusView = "surviving" | "prsMerged" | "reviews" | "commits" | "linesAdded" | "activeDays" | "longestStreak" | "hoursToMerge";

export const VERSUS_VIEWS: { id: VersusView; label: string; lowerWins?: boolean }[] = [
  { id: "surviving", label: "Lines that still run" },
  { id: "prsMerged", label: "Pull requests merged" },
  { id: "reviews", label: "Reviews given" },
  { id: "commits", label: "Commits" },
  { id: "linesAdded", label: "Lines added, merged" },
  { id: "activeDays", label: "Active days" },
  { id: "longestStreak", label: "Longest streak" },
  { id: "hoursToMerge", label: "Time to merge", lowerWins: true },
];

export type VersusRow = { view: VersusView; label: string; a: number | null; b: number | null; winner: "a" | "b" | "tie" | null };

function valueOf(side: VersusSide, view: VersusView): number | null {
  if (view === "surviving") return side.surviving;
  return side.totals[view];
}

/** Each view's winner between two people: the higher number, or the lower for time to merge; a tie when equal; no winner when either is unknown. Never an overall winner. */
export function versusRows(a: VersusSide, b: VersusSide): VersusRow[] {
  return VERSUS_VIEWS.map((v) => {
    const x = valueOf(a, v.id);
    const y = valueOf(b, v.id);
    let winner: VersusRow["winner"] = null;
    if (x !== null && y !== null) winner = x === y ? "tie" : (x > y) !== !!v.lowerWins ? "a" : "b";
    return { view: v.id, label: v.label, a: x, b: y, winner };
  });
}

export type Gap = { label: string; mine: number; theirs: number; unit: [string, string] };

/** How far a person is from their Rival, this month and over all time, view by view. */
export function gapsTo(me: VersusSide, rival: VersusSide): Gap[] {
  return [
    { label: "pull requests merged this month", mine: me.thisMonth.prsMerged, theirs: rival.thisMonth.prsMerged, unit: ["pull request merged", "pull requests merged"] },
    { label: "contributions this month", mine: me.thisMonth.contributions, theirs: rival.thisMonth.contributions, unit: ["contribution", "contributions"] },
    ...(me.surviving !== null && rival.surviving !== null ? [{ label: "lines that still run, all time", mine: me.surviving, theirs: rival.surviving, unit: ["line that still runs", "lines that still run"] as [string, string] }] : []),
  ];
}
