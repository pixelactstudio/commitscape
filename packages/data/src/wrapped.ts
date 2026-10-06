import type { Profile } from "./profile";

export type Wrapped = {
  login: string;
  name: string | null;
  year: number;
  contributions: number;
  commits: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  issues: number;
  linesAdded: number;
  linesRemoved: number;
  activeDays: number;
  longestStreak: number;
  busiest: { day: string; contributions: number } | null;
  languages: { name: string; commits: number; colour: string | null }[];
  repositories: { repo: string; commits: number; private: boolean }[];
  mergedIn: { repo: string; prs: number; private: boolean }[];
  months: number[];
  weekdays: number[];
  merges: number[];
  opened: { merged: number; closed: number; open: number };
  biggest: { repo: string; number: number; title: string; additions: number; deletions: number; private: boolean } | null;
  calendar: { firstDay: number; days: number[] };
  complete: boolean;
};

const DAY = 86_400;

/** A person's year across GitHub, from their Profile: its contributions day by day, by month and by weekday (Monday first), totals, merged pull requests by month with their lines and the biggest of them, what became of the pull requests opened, busiest day, longest streak, languages and repositories. */
export function wrappedOf(p: Profile, year: number): Wrapped {
  const first = Date.UTC(year, 0, 1) / 1000 / DAY;
  const last = Date.UTC(year, 11, 31) / 1000 / DAY;
  const days = Array.from({ length: last - first + 1 }, (_, i) => p.calendar.days[first + i - p.calendar.firstDay] ?? 0);
  const today = Math.floor(Date.now() / 1000 / DAY);
  const shown = days.slice(0, Math.max(0, Math.min(days.length, today - first + 1)));
  let longest = 0;
  let run = 0;
  let busiest: Wrapped["busiest"] = null;
  shown.forEach((n, i) => {
    run = n > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (n > 0 && (!busiest || n > busiest.contributions)) busiest = { day: new Date((first + i) * DAY * 1000).toISOString().slice(0, 10), contributions: n };
  });
  const months = Array.from({ length: 12 }, () => 0);
  shown.forEach((n, i) => {
    months[new Date((first + i) * DAY * 1000).getUTCMonth()] = (months[new Date((first + i) * DAY * 1000).getUTCMonth()] ?? 0) + n;
  });
  const weekdays = Array.from({ length: 7 }, () => 0);
  shown.forEach((n, i) => {
    const w = (first + i + 3) % 7;
    weekdays[w] = (weekdays[w] ?? 0) + n;
  });
  const y = p.years.find((x) => x.year === year);
  const merged = p.prs.filter((x) => x.mergedAt?.startsWith(String(year)));
  const opened = p.prs.filter((x) => x.createdAt.startsWith(String(year)));
  const merges = Array.from({ length: 12 }, () => 0);
  for (const x of merged) {
    const m = Number(x.mergedAt?.slice(5, 7)) - 1;
    merges[m] = (merges[m] ?? 0) + 1;
  }
  const byRepo = new Map<string, { repo: string; prs: number; private: boolean }>();
  for (const x of merged) byRepo.set(x.repo, { repo: x.repo, prs: (byRepo.get(x.repo)?.prs ?? 0) + 1, private: x.private });
  const top = [...merged].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))[0];
  return {
    login: p.identity.login,
    name: p.identity.name,
    year,
    contributions: shown.reduce((a, b) => a + b, 0),
    commits: y?.commits ?? 0,
    prsOpened: y?.prs ?? opened.length,
    prsMerged: merged.length,
    reviews: y?.reviews ?? 0,
    issues: y?.issues ?? 0,
    linesAdded: merged.reduce((n, x) => n + x.additions, 0),
    linesRemoved: merged.reduce((n, x) => n + x.deletions, 0),
    activeDays: shown.filter((n) => n > 0).length,
    longestStreak: longest,
    busiest,
    languages: (y?.languages ?? []).map((l) => ({ name: l.name, commits: l.commits, colour: l.colour })),
    repositories: y?.top ?? [],
    mergedIn: [...byRepo.values()].sort((a, b) => b.prs - a.prs || (a.repo < b.repo ? -1 : 1)),
    months,
    weekdays,
    merges,
    opened: { merged: opened.filter((x) => x.state === "MERGED").length, closed: opened.filter((x) => x.state === "CLOSED").length, open: opened.filter((x) => x.state === "OPEN").length },
    biggest: top ? { repo: top.repo, number: top.number, title: top.title, additions: top.additions, deletions: top.deletions, private: top.private } : null,
    calendar: { firstDay: first, days },
    complete: p.read.complete && p.read.prs >= p.read.prsTotal,
  };
}
