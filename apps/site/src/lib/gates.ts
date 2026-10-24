export type Gate = "visitor" | "profile" | "work" | "wrapped" | "build" | "pr";

export const GATES: Record<Gate, { on: boolean; title: string; words: string }> = {
  visitor: {
    on: true,
    title: "Sign in to read someone new",
    words: "commitscape has not read this person yet. Reading someone takes many GitHub requests, so new people are read for people signed in.",
  },
  profile: {
    on: true,
    title: "Sign in to see the rest",
    words: "Pull requests, reviews, the people they work with, when they commit and every repository they work in are for people signed in with GitHub.",
  },
  work: {
    on: true,
    title: "Sign in to see Proof of Work",
    words: "Proof of Work reads a person’s pull requests and commit histories from GitHub, so it is for people signed in.",
  },
  wrapped: {
    on: true,
    title: "Sign in to see their year",
    words: "A year in review reads a person’s whole year from GitHub, so it is for people signed in.",
  },
  build: {
    on: true,
    title: "Sign in to read this repository",
    words: "commitscape has not read this repository yet. Sign in with GitHub and it starts reading at once; it takes a minute or two.",
  },
  pr: {
    on: true,
    title: "Sign in to read the conversation",
    words: "A pull request’s description, comments and reviews come from GitHub's API, read with your own token, so they are for people signed in. Its commits, files and diff are open to everyone.",
  },
};

export type Locked = { locked: Gate };

/** Whether a server function's answer is a gate rather than data. */
export function isLocked(value: unknown): value is Locked {
  return typeof value === "object" && value !== null && "locked" in value && typeof (value as Locked).locked === "string";
}

export class LockedError extends Error {
  readonly gate: Gate;
  constructor(gate: Gate) {
    super(GATES[gate].title);
    this.name = "LockedError";
    this.gate = gate;
  }
}

/** The data, or a LockedError for the Section around it to draw as a sign-in prompt. */
export function unlocked<T>(value: T | Locked): T {
  if (isLocked(value)) throw new LockedError(value.locked);
  return value;
}
