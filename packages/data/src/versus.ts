import type { Identity, Profile, ProfileRepo, ProfileTotals } from "./profile";
import type { Achievement, Archetype } from "./traits";

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

export type VersusPerson = {
  identity: Identity;
  totals: ProfileTotals;
  surviving: number | null;
  lastYear: { firstDay: number; days: number[] };
  years: { year: number; contributions: number; commits: number; prs: number; reviews: number; issues: number }[];
  languages: { name: string; colour: string | null; commits: number }[];
  clock: { hours: number[]; sampled: number } | null;
  archetypes: Archetype[];
  achievements: Achievement[];
  repositories: number;
  read: { prs: number; prsTotal: number; complete: boolean };
};

export type SharedWork = { prsMerged: number; commits: number; reviews: number };

export type SharedRepo = { owner: string; name: string; stars: number; language: string | null; colour: string | null; a: SharedWork; b: SharedWork };

export type Between = { aReviewedB: number; bReviewedA: number };

export type VersusFull = { a: VersusSide; b: VersusSide; rows: VersusRow[]; people: { a: VersusPerson; b: VersusPerson }; shared: SharedRepo[]; between: Between | null };

const SHARED_MAX = 24;

const weight = (w: SharedWork) => w.prsMerged * 4 + w.commits + w.reviews;

/** The public repositories where both people have work, the ones where the lesser of the two did the most first. */
export function sharedRepositories(a: ProfileRepo[], b: ProfileRepo[]): SharedRepo[] {
  const theirs = new Map(b.filter((r) => !r.private).map((r) => [`${r.owner}/${r.name}`.toLowerCase(), r]));
  const work = (r: ProfileRepo): SharedWork => ({ prsMerged: r.prsMerged, commits: r.commits, reviews: r.reviews });
  const both: SharedRepo[] = [];
  for (const r of a) {
    const o = r.private ? undefined : theirs.get(`${r.owner}/${r.name}`.toLowerCase());
    if (!o) continue;
    const x = work(r);
    const y = work(o);
    if (weight(x) === 0 || weight(y) === 0) continue;
    both.push({ owner: r.owner, name: r.name, stars: Math.max(r.stars, o.stars), language: r.language ?? o.language, colour: r.colour ?? o.colour, a: x, b: y });
  }
  return both.sort((p, q) => Math.min(weight(q.a), weight(q.b)) - Math.min(weight(p.a), weight(p.b)) || weight(q.a) + weight(q.b) - (weight(p.a) + weight(p.b)) || q.stars - p.stars).slice(0, SHARED_MAX);
}

/** How often each reviewed the other's pull requests, as far as either Profile saw; null when neither saw any. */
export function betweenOf(a: Pick<Profile, "identity" | "partners">, b: Pick<Profile, "identity" | "partners">): Between | null {
  const find = (p: Pick<Profile, "partners">, login: string) => p.partners.find((x) => x.login.toLowerCase() === login.toLowerCase());
  const inA = find(a, b.identity.login);
  const inB = find(b, a.identity.login);
  const aReviewedB = Math.max(inA?.reviewedTheirs ?? 0, inB?.reviewedYours ?? 0);
  const bReviewedA = Math.max(inA?.reviewedYours ?? 0, inB?.reviewedTheirs ?? 0);
  return aReviewedB + bReviewedA > 0 ? { aReviewedB, bReviewedA } : null;
}
