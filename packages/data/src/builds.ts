/**
 * What the Site and the Builder say to each other (ADR-0015), and the plain
 * words the Site shows for each way a Build can end.
 */

/** A Build, as the Site hands it to the Builder. */
export type BuildRequest = {
  id: string;
  owner: string;
  name: string;
  /** GitHub's size of the repository, in KB, which picks the clone. */
  sizeKb: number;
  /** A Connected Repository's: its clone is deleted after the Build. */
  private: boolean;
  /** A GitHub installation token for this Build, never stored (ADR-0017). */
  token: string | null;
  /** Proves the Report's upload belongs to this Build. */
  uploadToken: string;
  /** A Leaderboard seed's: its issue answers are read too (`health`). */
  seed?: boolean;
};

/** Where a running Build is. */
export type BuildStep = "queued" | "cloning" | "reading" | "uploading";

/** Why a Build ended without a Report. */
export type BuildFailure = "not_found" | "private" | "too_big" | "timed_out" | "error" | "paused";

/** How a Build ended, as the Builder tells the Site. */
/** A repository's numbers for the Leaderboards, from its Build. */
export type BuildStats = {
  commits: number;
  people: number;
  bus_factor: number | null;
  maintainers: number;
  commits_30d: number;
  people_30d: number;
  code_lines: number;
  untouched_5y: number;
  /** From `health`, for a seed: issues answered, and the middle hours to a first answer. */
  answered?: number | null;
  answer_hours?: number | null;
};

export type BuildOutcome =
  | { ok: true; seconds: number; lines: boolean; partial: boolean; stats?: BuildStats }
  | { ok: false; reason: BuildFailure; detail?: string };

/** What each failure means, for a person. */
export const FAILURE_WORDS: Record<BuildFailure, string> = {
  not_found: "GitHub has no public repository of that name. Check its spelling; it may also be private.",
  private:
    "This repository is private. Its owner can let the Site read it through commitscape's GitHub App, or run `npx commitscape share` in a clone.",
  too_big: "This repository is too big for the Site to read. Run `npx commitscape` in a clone of it on your own machine.",
  timed_out:
    "Reading this repository's history took longer than the Site allows. Run `npx commitscape` in a clone on your own machine, or try again later.",
  error: "Something went wrong while reading this repository. Try again in a while.",
  paused: "Builds are paused: the machine that reads histories is not answering. GitHub's facts are below; try again later.",
};
