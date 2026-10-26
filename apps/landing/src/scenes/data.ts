export const YEAR = new Date().getUTCFullYear();

export const DAN = { login: "gaearon", name: "dan", lines: 78_000, merged: 2928, reviews: 3669, streak: 43 };
export const ANDREW = { login: "acdlite", name: "Andrew Clark", lines: 75_000, merged: 1465, reviews: 1364, streak: 28 };

export const VERSUS = [
  { label: "Lines that still run", a: DAN.lines, b: ANDREW.lines, unit: "" },
  { label: "Pull requests merged", a: DAN.merged, b: ANDREW.merged, unit: "" },
  { label: "Reviews given", a: DAN.reviews, b: ANDREW.reviews, unit: "" },
  { label: "Longest streak", a: DAN.streak, b: ANDREW.streak, unit: " days" },
];

export const STANDING_VIEWS = [
  { id: "lines", label: "Lines", unit: "lines still running" },
  { id: "prs", label: "PRs", unit: "pull requests" },
  { id: "commits", label: "Commits", unit: "commits" },
] as const;

export const STANDING_PEOPLE = [
  { login: "josephsavona", name: "Joe Savona", values: [140_000, 285, 3500] },
  { login: "sebmarkbage", name: "sebmarkbage", values: [137_000, 1500, 2700] },
  { login: "acdlite", name: "acdlite", values: [75_000, 1000, 1800] },
  { login: "bvaughn", name: "Brian Vaughn", values: [67_000, 738, 1600] },
  { login: "gaearon", name: "gaearon", values: [56_000, 968, 2000] },
];

export const STANDING_FOCUS = "gaearon";

export const WORK = [
  { title: "Count streaks in the person’s own time zone", repo: "acme/api", added: 184 },
  { title: "Dark theme for README Cards", repo: "acme/web", added: 312 },
  { title: "Follow renamed folders through history", repo: "acme/engine", added: 421 },
  { title: "Blame large files in one pass", repo: "acme/engine", added: 263 },
];

export const CALENDAR_WEEKS = 46;

/** A steady, made-up year of activity for drawings: the same levels on the server and in the browser. */
export function levels(count: number, seed: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    const v = x - Math.floor(x);
    const busy = 0.55 + 0.45 * Math.sin(i / 23 + seed);
    const lit = v * busy;
    return lit > 0.5 ? 4 : lit > 0.36 ? 3 : lit > 0.24 ? 2 : lit > 0.14 ? 1 : 0;
  });
}
