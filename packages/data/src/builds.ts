export type BuildStep = "queued" | "cloning" | "reading" | "uploading";

export type BuildFailure = "not_found" | "private" | "too_big" | "timed_out" | "error" | "paused";

export type BuildStats = {
  commits: number;
  people: number;
  bus_factor: number | null;
  maintainers: number;
  commits_30d: number;
  people_30d: number;
  code_lines: number;
  untouched_5y: number;
  answered?: number | null;
  answer_hours?: number | null;
};

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
