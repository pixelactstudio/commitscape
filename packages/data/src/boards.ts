export type BoardRow = {
  owner: string;
  name: string;
  language: string | null;
  stars: number;
  value: number;
  shown: string;
};

export type Board = {
  id: "one_person" | "maintainers" | "active_commits" | "active_people" | "answers" | "oldest_code";
  title: string;
  how: string;
  rows: BoardRow[];
};

export type Boards = {
  builtAt: number;
  from: number;
  boards: Board[];
};
