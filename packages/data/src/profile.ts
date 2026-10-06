import type { BuildFailure } from "./builds";

export type Identity = {
  login: string;
  githubId: number;
  name: string | null;
  avatar: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  website: string | null;
  twitter: string | null;
  followers: number;
  createdAt: string;
  kind: "user" | "organization";
};

export type ProfileRepo = {
  owner: string;
  name: string;
  private: boolean;
  stars: number;
  language: string | null;
  colour: string | null;
  commits: number;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
  linesAdded: number;
  linesRemoved: number;
  first: string | null;
  last: string | null;
};

export type ProfileYear = {
  year: number;
  commits: number;
  prs: number;
  reviews: number;
  issues: number;
  hidden: number;
  languages: { name: string; colour: string | null; commits: number }[];
  top?: { repo: string; commits: number; private: boolean }[];
};

export type ProfileMonth = { month: string; contributions: number; prsMerged: number; prs?: { merged: number; open: number; closed: number } };

export type Partner = { login: string; avatar: string; reviewedTheirs: number; reviewedYours: number };

export type ProfilePr = {
  repo: string;
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  private: boolean;
  stars: number;
};

export type ProfileTotals = {
  prsOpened: number;
  prsMerged: number;
  prsClosed: number;
  prsOpen: number;
  reviews: number;
  commits: number;
  issues: number;
  hidden: number;
  linesAdded: number | null;
  linesRemoved: number | null;
  hoursToMerge: number | null;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  contributions: number;
};

export type Profile = {
  identity: Identity;
  fetchedAt: number;
  scope: "public" | "self";
  totals: ProfileTotals;
  years: ProfileYear[];
  months: ProfileMonth[];
  calendar: { firstDay: number; days: number[] };
  repositories: ProfileRepo[];
  partners: Partner[];
  prs: ProfilePr[];
  read: { prs: number; prsTotal: number; requests: number; complete: boolean; clockAt?: number };
  clock: { hours: number[]; sampled: number; week?: number[][] } | null;
};

export type ProfileLookup =
  | { status: "ok"; identity: Identity; hidden: boolean; self: boolean; fetchedAt: number | null }
  | { status: "not_found" | "hidden" | "organization"; login: string; identity?: Identity };

export type EngineRepo = {
  owner: string;
  name: string;
  private: boolean;
  builtAt: number;
  commits: number;
  linesAdded: number | null;
  linesRemoved: number | null;
  first: number | null;
  last: number | null;
  surviving: { status: "counting" | "counted" | "over_budget" | "not_counted" | "failed" | "stale"; lines: number | null; added: number | null };
};

export type UnreadRepo = {
  owner: string;
  name: string;
  private: boolean;
  commits: number;
  state: "not_read" | "reading" | "failed" | "not_in_it";
  reason: BuildFailure | null;
  canRead: boolean;
};

export type EngineView = { repos: EngineRepo[]; surviving: number | null; added: number | null; counting: number; unread?: UnreadRepo[] };
