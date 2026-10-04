import type { AchievementCardData, ArchetypeCardData, WindowCardData, WrappedCardData, HallOfFameData, ProfileCardData, StandingCardData, VersusCardData } from "@commitscape/data";

const days = Array.from({ length: 400 }, (_, i) => ((i * 7) % 11 === 0 ? 0 : (i * 13) % 9));

export const PROFILE: ProfileCardData = {
  identity: { login: "alice", name: "Alice Example" },
  totals: { prsOpened: 640, prsMerged: 597, prsClosed: 20, prsOpen: 23, reviews: 212, commits: 4883, issues: 41, hidden: 0, linesAdded: 182_000, linesRemoved: 66_300, hoursToMerge: 2.5, activeDays: 407, longestStreak: 33, currentStreak: 3, contributions: 5384 },
  repositories: [
    { owner: "acme", name: "rocket", private: false, stars: 1200, language: "TypeScript", colour: "#3178c6", commits: 271, prsOpened: 30, prsMerged: 28, reviews: 1, linesAdded: 1, linesRemoved: 1, first: null, last: null },
    { owner: "acme", name: "engine", private: false, stars: 3, language: "Rust", colour: "#dea584", commits: 158, prsOpened: 11, prsMerged: 11, reviews: 1, linesAdded: 1, linesRemoved: 1, first: null, last: null },
    { owner: "alice", name: "dots", private: false, stars: 0, language: "Shell", colour: "#89e051", commits: 81, prsOpened: 3, prsMerged: 3, reviews: 0, linesAdded: 1, linesRemoved: 1, first: null, last: null },
  ],
  years: [
    { year: 2024, commits: 300, prs: 10, reviews: 2, issues: 0, hidden: 0, languages: [{ name: "TypeScript", colour: null, commits: 300 }] },
    { year: 2025, commits: 900, prs: 80, reviews: 20, issues: 4, hidden: 0, languages: [{ name: "TypeScript", colour: null, commits: 800 }, { name: "Rust", colour: null, commits: 100 }] },
    { year: 2026, commits: 3683, prs: 550, reviews: 190, issues: 37, hidden: 0, languages: [{ name: "TypeScript", colour: null, commits: 2600 }, { name: "Rust", colour: null, commits: 700 }, { name: "Nix", colour: null, commits: 300 }, { name: "Shell", colour: null, commits: 83 }] },
  ],
  calendar: { firstDay: 20_000, days },
  engine: { surviving: 41_200, added: 120_400, repositories: 3 },
  at: 1_790_000_000,
};

export const STANDING: StandingCardData = {
  identity: { login: "alice", name: "Alice Example" },
  repo: { owner: "facebook", name: "react" },
  places: [
    { view: "surviving", place: 4, of: 120, value: 22_213 },
    { view: "prsMerged", place: 12, of: 1_890, value: 340 },
    { view: "reviews", place: 7, of: 640, value: 910 },
    { view: "commits", place: 12, of: 1_950, value: 1_200 },
  ],
  people: 1_950,
  top: "Top 1% of facebook/react's 1,950 contributors by commits",
  numbers: { surviving: 22_213, prsMerged: 340, reviews: 910, commits: 1_200 },
};

export const HALL: HallOfFameData = {
  repo: { owner: "BurntSushi", name: "ripgrep", stars: 68_826 },
  people: [
    { login: "BurntSushi", name: "Andrew Gallant", surviving: 61_148, prsMerged: 106, commits: 1_551 },
    { login: "dana", name: "dana", surviving: 893, prsMerged: 33, commits: 56 },
    { login: null, name: "Igor Gnatenko", surviving: null, prsMerged: null, commits: 10 },
  ],
  total: 478,
};

export const VERSUS: VersusCardData = {
  a: { identity: { login: "alice", name: "Alice Example" } },
  b: { identity: { login: "bob", name: "Bob Example" } },
  rows: [
    { view: "surviving", label: "Lines that still run", a: 41_200, b: 12_000, winner: "a" },
    { view: "prsMerged", label: "Pull requests merged", a: 597, b: 811, winner: "b" },
    { view: "reviews", label: "Reviews given", a: 212, b: 212, winner: "tie" },
    { view: "commits", label: "Commits", a: 4_883, b: 2_100, winner: "a" },
    { view: "linesAdded", label: "Lines added, merged", a: 182_000, b: null, winner: null },
    { view: "activeDays", label: "Active days", a: 407, b: 512, winner: "b" },
    { view: "longestStreak", label: "Longest streak", a: 33, b: 21, winner: "a" },
    { view: "hoursToMerge", label: "Time to merge", a: 2.5, b: 0.4, winner: "b" },
  ],
};

export const ARCHETYPE: ArchetypeCardData = {
  identity: { login: "alice", name: "Alice Example" },
  archetype: { id: "reviewer", title: "Reviewer", rule: "Gave more reviews than they opened pull requests, and at least 20 reviews." },
  also: ["Marathoner", "Builder"],
};

export const ACHIEVEMENT: AchievementCardData = {
  identity: { login: "alice", name: "Alice Example" },
  achievement: { id: "star-10k", title: "Merged into a 10k-star repository", rule: "A pull request of theirs merged into a repository with 10,000 stars or more, as it has now.", earned: true, at: "2024-03-02", detail: "facebook/react#28411" },
};

export const WINDOW: WindowCardData = {
  title: "The October sprint",
  subtitle: "A Race from 2026-10-01 to 2026-10-31, finished",
  rows: [
    { login: "alice", name: "Alice Example", prsMerged: 12, reviews: 30, commits: 140, contributions: 190 },
    { login: "bob", name: "Bob Example", prsMerged: 12, reviews: 8, commits: 210, contributions: 230 },
    { login: "carol", name: null, prsMerged: 3, reviews: 41, commits: 20, contributions: 70 },
  ],
};

export const WRAPPED: WrappedCardData = {
  login: "alice",
  name: "Alice Example",
  year: 2026,
  contributions: 4_917,
  commits: 3_683,
  prsOpened: 600,
  prsMerged: 581,
  reviews: 190,
  issues: 37,
  linesAdded: 1_400_000,
  linesRemoved: 520_000,
  activeDays: 263,
  longestStreak: 33,
  busiest: { day: "2026-09-19", contributions: 161 },
  languages: [{ name: "TypeScript", commits: 2600 }],
  repositories: [{ repo: "acme/rocket", commits: 900, private: false }],
  months: [100, 200, 300, 400, 500, 600, 700, 800, 900, 417, 0, 0],
  calendar: { firstDay: Date.UTC(2026, 0, 1) / 86_400_000, days: Array.from({ length: 365 }, (_, i) => (i > 276 ? 0 : (i * 7) % 13)) },
  complete: true,
};
