import type { Profile } from "./profile";

export type TraitInput = {
  totals: Profile["totals"];
  years: Profile["years"];
  prs: Profile["prs"];
  clock: Profile["clock"];
  calendar: Profile["calendar"];
  complete: boolean;
  engine: { surviving: number; oldest: number | null } | null;
  now: number;
};

export type ArchetypeId = "reviewer" | "janitor" | "firefighter" | "night-owl" | "polyglot" | "weekend" | "marathoner" | "builder";

export type Archetype = { id: ArchetypeId; title: string; rule: string };

export const ARCHETYPE_MINIMUM = 50;

const FIX = /^(fix|hotfix|bugfix)\b|^fix(\([^)]*\))?!?:|^\[?fix\]?\s/i;

/** Whether a pull request's title says it is a fix: it starts with fix, hotfix or bugfix, or a conventional fix: or fix(…):. */
export function isFix(title: string): boolean {
  return FIX.test(title.trim());
}

function lastYear(input: TraitInput): { day: number; n: number }[] {
  const { firstDay, days } = input.calendar;
  return days.slice(-365).map((n, i, all) => ({ day: firstDay + days.length - all.length + i, n }));
}

const n = (v: number) => v.toLocaleString("en-US");
const pct = (part: number, whole: number) => `${whole > 0 ? Math.round((part * 100) / whole) : 0}%`;

function weekendDays(i: TraitInput) {
  const active = lastYear(i).filter((d) => d.n > 0);
  return { active: active.length, weekend: active.filter((d) => (d.day + 4) % 7 === 6 || (d.day + 4) % 7 === 0).length };
}

function languageShares(i: TraitInput) {
  const by = new Map<string, number>();
  for (const y of i.years) for (const l of y.languages) by.set(l.name, (by.get(l.name) ?? 0) + l.commits);
  const all = [...by.values()].reduce((a, b) => a + b, 0);
  return { all, big: [...by.entries()].filter(([, v]) => v * 20 >= all && all > 0).map(([k]) => k) };
}

function nightShare(i: TraitInput) {
  const night = [22, 23, 0, 1, 2, 3, 4].reduce((s, h) => s + (i.clock?.hours[h] ?? 0), 0);
  return { night, sampled: i.clock?.sampled ?? 0 };
}

function fixShare(i: TraitInput) {
  const merged = i.prs.filter((p) => p.state === "MERGED" && p.repo !== "");
  return { merged: merged.length, fixes: merged.filter((p) => isFix(p.title)).length };
}

export type Evidence = { label: string; value: string; goal: string; share: number; met: boolean };

const atLeast = (label: string, value: number, goal: number, unit = ""): Evidence => ({ label, value: `${n(value)}${unit}`, goal: `${n(goal)}${unit} or more`, share: goal > 0 ? Math.min(1, value / goal) : 0, met: value >= goal });
const shareOf = (label: string, part: number, whole: number, goal: number): Evidence => {
  const p = whole > 0 ? part / whole : 0;
  return { label, value: pct(part, whole), goal: `${Math.round(goal * 100)}% or more`, share: Math.min(1, p / goal), met: whole > 0 && p >= goal };
};
const above = (label: string, value: number, other: number, otherLabel: string): Evidence => ({ label, value: `${n(value)} to ${n(other)}`, goal: `more than ${otherLabel}`, share: value + other > 0 ? Math.min(1, value / Math.max(1, other + 1)) : 0, met: value > other });

const RULES: (Archetype & { test: (i: TraitInput) => boolean; measure: (i: TraitInput) => string; evidence: (i: TraitInput) => Evidence[] })[] = [
  {
    id: "reviewer",
    title: "Reviewer",
    rule: "Gave more reviews than they opened pull requests, and at least 20 reviews.",
    test: (i) => i.totals.reviews >= 20 && i.totals.reviews > i.totals.prsOpened,
    measure: (i) => `${n(i.totals.reviews)} reviews given, ${n(i.totals.prsOpened)} pull requests opened`,
    evidence: (i) => [atLeast("Reviews given", i.totals.reviews, 20), above("Reviews to pull requests opened", i.totals.reviews, i.totals.prsOpened, "pull requests opened")],
  },
  {
    id: "janitor",
    title: "Janitor",
    rule: "Removed more lines than they added in their merged pull requests, and at least 1,000 lines.",
    test: (i) => i.totals.linesRemoved !== null && i.totals.linesAdded !== null && i.totals.linesRemoved >= 1000 && i.totals.linesRemoved > i.totals.linesAdded,
    measure: (i) => (i.totals.linesAdded === null || i.totals.linesRemoved === null ? "Lines not read yet" : `${n(i.totals.linesRemoved)} lines removed, ${n(i.totals.linesAdded)} added`),
    evidence: (i) => [atLeast("Lines removed", i.totals.linesRemoved ?? 0, 1000), above("Removed to added", i.totals.linesRemoved ?? 0, i.totals.linesAdded ?? 0, "lines added")],
  },
  {
    id: "firefighter",
    title: "Firefighter",
    rule: "At least half of their merged pull requests, and 10 or more, are fixes: titled fix, hotfix or bugfix, or a conventional fix:.",
    test: (i) => {
      const merged = i.prs.filter((p) => p.state === "MERGED" && p.repo !== "");
      const fixes = merged.filter((p) => isFix(p.title)).length;
      return fixes >= 10 && fixes * 2 >= merged.length;
    },
    measure: (i) => {
      const f = fixShare(i);
      return `${n(f.fixes)} fixes in ${n(f.merged)} merged pull requests read (${pct(f.fixes, f.merged)})`;
    },
    evidence: (i) => {
      const f = fixShare(i);
      return [atLeast("Fixes merged", f.fixes, 10), shareOf("Of merged pull requests", f.fixes, f.merged, 0.5)];
    },
  },
  {
    id: "night-owl",
    title: "Night Owl",
    rule: "At least 40% of their newest 100 commits, 30 or more read, were made between 22:00 and 04:59 on the commit's own clock.",
    test: (i) => {
      if (!i.clock || i.clock.sampled < 30) return false;
      const night = [22, 23, 0, 1, 2, 3, 4].reduce((n, h) => n + (i.clock?.hours[h] ?? 0), 0);
      return night * 100 >= i.clock.sampled * 40;
    },
    measure: (i) => {
      const s = nightShare(i);
      return i.clock ? `${n(s.night)} of ${n(s.sampled)} commits at night (${pct(s.night, s.sampled)})` : "Commit times not read";
    },
    evidence: (i) => {
      const s = nightShare(i);
      return [atLeast("Commit times read", s.sampled, 30), shareOf("Made 22:00 to 04:59", s.night, s.sampled, 0.4)];
    },
  },
  {
    id: "polyglot",
    title: "Polyglot",
    rule: "Committed in five or more languages, each at least 5% of their commits, by the main language of each repository.",
    test: (i) => {
      const by = new Map<string, number>();
      for (const y of i.years) for (const l of y.languages) by.set(l.name, (by.get(l.name) ?? 0) + l.commits);
      const all = [...by.values()].reduce((a, b) => a + b, 0);
      return all > 0 && [...by.values()].filter((n) => n * 20 >= all).length >= 5;
    },
    measure: (i) => {
      const l = languageShares(i);
      return l.big.length > 0 ? `${l.big.length} at 5% or more: ${l.big.join(", ")}` : "No language read yet";
    },
    evidence: (i) => [atLeast("Languages at 5% or more", languageShares(i).big.length, 5)],
  },
  {
    id: "weekend",
    title: "Weekend Warrior",
    rule: "At least 40% of their active days in the last year fell on a Saturday or Sunday, with 30 or more active days.",
    test: (i) => {
      const active = lastYear(i).filter((d) => d.n > 0);
      const weekend = active.filter((d) => (d.day + 4) % 7 === 6 || (d.day + 4) % 7 === 0).length;
      return active.length >= 30 && weekend * 100 >= active.length * 40;
    },
    measure: (i) => {
      const w = weekendDays(i);
      return `${n(w.weekend)} of ${n(w.active)} active days on a weekend (${pct(w.weekend, w.active)})`;
    },
    evidence: (i) => {
      const w = weekendDays(i);
      return [atLeast("Active days, last year", w.active, 30), shareOf("On a weekend", w.weekend, w.active, 0.4)];
    },
  },
  {
    id: "marathoner",
    title: "Marathoner",
    rule: "A streak of 30 days or more in a row with a contribution.",
    test: (i) => i.totals.longestStreak >= 30,
    measure: (i) => `Longest streak ${n(i.totals.longestStreak)} ${i.totals.longestStreak === 1 ? "day" : "days"}`,
    evidence: (i) => [atLeast("Longest streak", i.totals.longestStreak, 30, " days")],
  },
  {
    id: "builder",
    title: "Builder",
    rule: "Merged 25 or more pull requests, adding at least twice the lines they removed.",
    test: (i) => i.totals.prsMerged >= 25 && i.totals.linesAdded !== null && i.totals.linesRemoved !== null && i.totals.linesAdded >= 2 * i.totals.linesRemoved,
    measure: (i) => `${n(i.totals.prsMerged)} merged${i.totals.linesAdded !== null && i.totals.linesRemoved !== null ? `, ${n(i.totals.linesAdded)} lines added to ${n(i.totals.linesRemoved)} removed` : ""}`,
    evidence: (i) => {
      const added = i.totals.linesAdded ?? 0;
      const removed = i.totals.linesRemoved ?? 0;
      return [
        atLeast("Pull requests merged", i.totals.prsMerged, 25),
        { label: "Lines added to removed", value: removed > 0 ? `${(added / removed).toFixed(1)}×` : added > 0 ? "all added" : "none", goal: "2× or more", share: removed > 0 ? Math.min(1, added / (2 * removed)) : added > 0 ? 1 : 0, met: i.totals.linesAdded !== null && i.totals.linesRemoved !== null && added >= 2 * removed },
      ];
    },
  },
];

/** Every Archetype and its rule, in the order they are tried. */
export const ARCHETYPES: Archetype[] = RULES.map(({ id, title, rule }) => ({ id, title, rule }));

/** The Archetypes whose rules a person meets, in order; the first is theirs. None below 50 contributions. */
export function archetypesOf(input: TraitInput): Archetype[] {
  if (input.totals.contributions < ARCHETYPE_MINIMUM) return [];
  return RULES.filter((r) => r.test(input)).map(({ id, title, rule }) => ({ id, title, rule }));
}

export type ArchetypeCheck = Archetype & { met: boolean; numbers: string; evidence: Evidence[] };

/** Every Archetype rule in the order they are tried, whether this person meets it, and the numbers it was tried on. */
export function archetypeChecks(input: TraitInput): ArchetypeCheck[] {
  const enough = input.totals.contributions >= ARCHETYPE_MINIMUM;
  return RULES.map(({ id, title, rule, test, measure, evidence }) => ({ id, title, rule, met: enough && test(input), numbers: measure(input), evidence: evidence(input) }));
}

export type AchievementId = "star-10k" | "prs-100" | "prs-1000" | "reviews-100" | "reviews-1000" | "demolition" | "streak-30" | "streak-100" | "surviving-10k" | "survivor-5y";

export type Achievement = { id: AchievementId; title: string; rule: string; earned: boolean; at: string | null; detail: string | null };

const YEAR = 365.25 * 86_400;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** Every Achievement, earned or not, with its rule, when it was reached when that is known, and what reached it. */
export function achievementsOf(input: TraitInput): Achievement[] {
  const merged = input.prs.filter((p) => p.state === "MERGED" && p.mergedAt).sort((a, b) => ((a.mergedAt ?? "") < (b.mergedAt ?? "") ? -1 : 1));
  const big = merged.find((p) => p.stars >= 10_000);
  const demolition = merged.find((p) => p.deletions >= 10_000);
  const t = input.totals;
  const e = input.engine;
  const oldest = e?.oldest ?? null;
  const all = merged.length === t.prsMerged;
  const out: Achievement[] = [
    { id: "star-10k", title: "Merged into a 10k-star repository", rule: "A pull request of theirs merged into a repository with 10,000 stars or more, as it has now.", earned: !!big, at: day(big?.mergedAt ?? null), detail: big ? (big.repo ? `${big.repo}#${big.number}` : "a private repository") : null },
    { id: "prs-100", title: "100 pull requests merged", rule: "100 or more of their pull requests merged.", earned: t.prsMerged >= 100, at: all ? day(merged[99]?.mergedAt ?? null) : null, detail: null },
    { id: "prs-1000", title: "1,000 pull requests merged", rule: "1,000 or more of their pull requests merged.", earned: t.prsMerged >= 1000, at: all ? day(merged[999]?.mergedAt ?? null) : null, detail: null },
    { id: "reviews-100", title: "100 reviews", rule: "100 or more reviews of others' pull requests.", earned: t.reviews >= 100, at: null, detail: null },
    { id: "reviews-1000", title: "1,000 reviews", rule: "1,000 or more reviews of others' pull requests.", earned: t.reviews >= 1000, at: null, detail: null },
    { id: "demolition", title: "Removed 10k lines in one pull request", rule: "A merged pull request of theirs that removed 10,000 lines or more.", earned: !!demolition, at: day(demolition?.mergedAt ?? null), detail: demolition ? `${demolition.repo ? `${demolition.repo}#${demolition.number}` : "a private repository"}, −${demolition.deletions.toLocaleString("en-US")}` : null },
    { id: "streak-30", title: "A 30-day streak", rule: "30 days or more in a row with a contribution.", earned: t.longestStreak >= 30, at: null, detail: null },
    { id: "streak-100", title: "A 100-day streak", rule: "100 days or more in a row with a contribution.", earned: t.longestStreak >= 100, at: null, detail: null },
    { id: "surviving-10k", title: "10,000 lines still running", rule: "10,000 or more of their lines at the heads of the repositories commitscape has read.", earned: (e?.surviving ?? 0) >= 10_000, at: null, detail: null },
    { id: "survivor-5y", title: "A line that has survived five years", rule: "A line of theirs still at a repository's head, written five years ago or more.", earned: oldest !== null && input.now - oldest >= 5 * YEAR, at: oldest !== null ? new Date(oldest * 1000).toISOString().slice(0, 10) : null, detail: null },
  ];
  return out;
}
