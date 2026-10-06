export type View = "surviving" | "prsMerged" | "reviews" | "linesAdded" | "commits";

export const VIEWS: { id: View; label: string; unit: [string, string]; why: string }[] = [
  { id: "surviving", label: "Lines that still run", unit: ["line still running", "lines still running"], why: "Lines at the repository's head that blame gives to them, reformats and generated files left out." },
  { id: "prsMerged", label: "Pull requests merged", unit: ["pull request merged", "pull requests merged"], why: "Their pull requests merged into the repository." },
  { id: "reviews", label: "Pull requests reviewed", unit: ["pull request reviewed", "pull requests reviewed"], why: "Others' pull requests they reviewed at least once." },
  { id: "linesAdded", label: "Lines added", unit: ["line added", "lines added"], why: "Lines their commits added, lockfiles, generated files and bulk commits left out." },
  { id: "commits", label: "Commits", unit: ["commit", "commits"], why: "Their commits that are not merges." },
];

export type StandingRow = {
  key: string;
  login: string | null;
  name: string;
  personId: number | null;
  you: boolean;
  commits: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  prsMerged: number | null;
  prsOpened: number | null;
  reviews: number | null;
  surviving: number | null;
  survivingStatus: "counting" | "counted" | "over_budget" | "not_counted" | "failed" | "stale" | "not_asked" | null;
  first: number | null;
  last: number | null;
  worksOn?: string | null;
};

export type Place = { view: View; place: number; of: number; value: number };

export type Standings = {
  repo: { owner: string; name: string; private: boolean; builtAt: number; pullsReadAt: number | null; stars: number };
  people: StandingRow[];
  counted: number;
  hidden: number;
};

/** Where each person stands in each view, counted from the top; those tied share the higher place, and people with nothing in a view have no place in it. */
export function placesOf(people: StandingRow[], view: View): Map<string, Place> {
  const valued = people.flatMap((p) => {
    const v = p[view];
    return typeof v === "number" && v > 0 ? [{ key: p.key, value: v }] : [];
  });
  const out = new Map<string, Place>();
  for (const p of valued) out.set(p.key, { view, place: 1 + valued.filter((o) => o.value > p.value).length, of: valued.length, value: p.value });
  return out;
}

/** A place in words: "1st", "2nd", "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
