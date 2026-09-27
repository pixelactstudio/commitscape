/**
 * What the Site says about a repository on GitHub (ADR-0015): GitHub's
 * instant facts, which show at once, and its Report and Build.
 */
import type { BuildFailure, BuildStep } from "./builds";

/** What GitHub's API tells anyone about a public repository. */
export type Facts = {
  fullName: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  defaultBranch: string;
  license: string | null;
  topics: string[];
  archived: boolean;
  createdAt: string;
  pushedAt: string | null;
  /** Bytes of each language, largest first. */
  languages: { name: string; bytes: number }[];
  /** The people who made most commits, by GitHub's count, with avatars. */
  contributors: { login: string; avatar: string; contributions: number }[];
  releases: { name: string; tag: string; at: string | null }[];
};

export type Lookup = {
  id: string;
  owner: string;
  name: string;
  /** What GitHub said: a public repository, none, or a private one. */
  status: "ok" | "not_found" | "private";
  facts: Facts | null;
  report: { at: number; bytes: number; lines: boolean } | null;
  /** The last Build, running or ended. */
  build: {
    id: string;
    state: "queued" | "running" | "done" | "failed";
    step: BuildStep | null;
    reason: BuildFailure | null;
    requestedAt: number;
  } | null;
  /** A Report more than a day old is rebuilt when someone asks (ADR-0015). */
  stale: boolean;
  /** Whether asking for a Build now would start one. */
  canBuild: boolean;
  /**
   * Who may see it (ADR-0017): anyone (`public`); or, for a repository
   * GitHub does not show publicly, whether the person asking is signed in,
   * may see it on GitHub, and let the Site read it through the App.
   */
  access: "public" | "signed_out" | "denied" | "not_connected" | "allowed";
};
