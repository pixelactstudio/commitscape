/**
 * The Leaderboards (IDEA.md): repositories ranked by what commitscape
 * measures, never people. Written once a day as one document the pages read.
 */
export type BoardRow = {
  owner: string;
  name: string;
  language: string | null;
  stars: number;
  /** What the board ranks by, and its words. */
  value: number;
  shown: string;
};

export type Board = {
  id: "one_person" | "maintainers" | "active_commits" | "active_people" | "answers" | "oldest_code";
  title: string;
  /** How it is ranked, in words. */
  how: string;
  rows: BoardRow[];
};

export type Boards = {
  /** When they were written, seconds since the epoch. */
  builtAt: number;
  /** How many repositories they were ranked from. */
  from: number;
  boards: Board[];
};
