import type { GitPullFile } from "@commitscape/data";

export type DiffLine = { kind: "hunk" | "add" | "del" | "ctx" | "note"; old: number | null; now: number | null; text: string };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** The lines of one file's unified diff, past its header: each hunk's heading, then added, removed and unchanged lines with their numbers in the old and the new file. */
export function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: DiffLine[] = [];
  let old = 0;
  let now = 0;
  let inside = false;
  for (const line of lines) {
    const h = HUNK.exec(line);
    if (h) {
      inside = true;
      old = Number(h[1]);
      now = Number(h[2]);
      out.push({ kind: "hunk", old: null, now: null, text: line });
      continue;
    }
    if (!inside) continue;
    const mark = line[0];
    if (mark === "+") out.push({ kind: "add", old: null, now: now++, text: line.slice(1) });
    else if (mark === "-") out.push({ kind: "del", old: old++, now: null, text: line.slice(1) });
    else if (mark === "\\") out.push({ kind: "note", old: null, now: null, text: line.slice(1).trim() });
    else out.push({ kind: "ctx", old: old++, now: now++, text: line.slice(1) });
  }
  return out;
}

export const STATUS_WORDS: Record<string, string> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type changed" };

export const HEIGHTS = { file: 44, hunk: 24, line: 20, note: 60, gap: 12 } as const;

export type DiffRow =
  | { kind: "file"; file: number }
  | { kind: "hunk"; file: number; text: string }
  | { kind: "line"; file: number; line: DiffLine; at: number }
  | { kind: "note"; file: number; why: "binary" | "large" | "cap" | "none" | "empty" }
  | { kind: "gap"; file: number };

export const heightOf = (row: DiffRow): number => HEIGHTS[row.kind === "line" ? "line" : row.kind];

export type Built = { rows: DiffRow[]; starts: number[]; longest: number; digits: number; lines: DiffLine[][] };

const cache = new WeakMap<GitPullFile, DiffLine[]>();

/** A file's patch as lines, worked out once for the file. */
export function linesOf(file: GitPullFile): DiffLine[] {
  let held = cache.get(file);
  if (!held) {
    held = file.patch ? parsePatch(file.patch) : [];
    cache.set(file, held);
  }
  return held;
}

/** Builds the rows of a diff viewer: for each file a header, its hunks and lines, or a note that says why it has none. */
export function buildRows(files: readonly GitPullFile[], collapsed: ReadonlySet<number>): Built {
  const rows: DiffRow[] = [];
  const starts: number[] = [];
  const lines: DiffLine[][] = [];
  let longest = 0;
  let digits = 1;
  const push = (row: DiffRow) => void rows.push(row);
  files.forEach((f, i) => {
    starts.push(rows.length);
    const parsed = linesOf(f);
    lines.push(parsed);
    push({ kind: "file", file: i });
    if (!collapsed.has(i)) {
      if (parsed.length > 0) {
        parsed.forEach((line, at) => {
          if (line.kind === "hunk") push({ kind: "hunk", file: i, text: line.text });
          else {
            push({ kind: "line", file: i, line, at });
            longest = Math.max(longest, line.text.length);
            digits = Math.max(digits, String(Math.max(line.old ?? 0, line.now ?? 0)).length);
          }
        });
      } else push({ kind: "note", file: i, why: f.binary ? "binary" : f.omitted === "large" ? "large" : f.omitted === "cap" ? "cap" : f.patch === "" || ((f.added ?? 0) === 0 && (f.removed ?? 0) === 0) ? "empty" : "none" });
    }
    push({ kind: "gap", file: i });
  });
  return { rows, starts, longest, digits, lines };
}

export type Sides = { now: string; old: string | null; where: ([0 | 1, number] | null)[] };

/** The text of a file's new side (unchanged and added lines) and of its old side (unchanged and removed lines), each hunk set apart by a blank line, and where each diff line sits in them. */
export function sidesOf(lines: readonly DiffLine[]): Sides {
  const now: string[] = [];
  const old: string[] = [];
  const where: Sides["where"] = [];
  let deleted = false;
  for (const l of lines) {
    if (l.kind === "hunk") {
      now.push("");
      old.push("");
      where.push(null);
    } else if (l.kind === "note") where.push(null);
    else if (l.kind === "del") {
      deleted = true;
      where.push([1, old.length]);
      old.push(l.text);
    } else {
      where.push([0, now.length]);
      now.push(l.text);
      if (l.kind === "ctx") old.push(l.text);
    }
  }
  return { now: now.join("\n"), old: deleted ? old.join("\n") : null, where };
}

/** The files of a pull request in the order asked: the most lines changed first, or by path. */
export function orderOf(files: readonly GitPullFile[], by: "size" | "path"): GitPullFile[] {
  const size = (f: GitPullFile) => (f.added ?? 0) + (f.removed ?? 0);
  return [...files].sort((a, b) => (by === "path" ? (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : size(b) - size(a) || (a.path < b.path ? -1 : 1)));
}
