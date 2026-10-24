import "@tanstack/react-start/server-only";
import { and, eq, inArray } from "drizzle-orm";
import { CODE_LOG_PAGE, FILE_BIG, FILE_BINARY, FILE_BYTES_MAX, FILE_LINK, FILE_STORED, isBinaryPath, languageOf, pullOf, rawBase, type CodeCommit, type CodeHolder, type CodeLog, type CodeMoment, type CodePull, type CodeStory, type CodeYear, type PersonRef, type PullState } from "@commitscape/data";
import { authorOf, counts, DAY, filesUnder, isMerge, personOf, personRef, type IndexView } from "@commitscape/data/answers";
import { schema, subjectsOf } from "@commitscape/server";
import { inTurn, underOf, viewOf } from "./answers";
import { gitOf, NO_GIT } from "./git";
import { SiteError } from "./http";
import type { Deps, Viewer } from "./repos";

const { indexFilePaths, pullRequests, storedIndexes } = schema;

const FIXES = 1;
const UNCLASSIFIED = 10;
const HOLDERS = 5;
const YEAR_OWNERS = 3;
const MAINTAINER_DAYS = 90;
const MAINTAINER_COMMITS = 3;
const KEPT = 64;

const maintainersOf = new WeakMap<IndexView, Set<number>>();
const stories = new WeakMap<IndexView, Map<string, Omit<CodeStory, "head" | "raw" | "paths">>>();

/** The people who made at least three commits in the 90 days up to the view's anchor: its Maintainers. */
export function maintainers(v: IndexView): Set<number> {
  const held = maintainersOf.get(v);
  if (held) return held;
  const since = v.anchor - MAINTAINER_DAYS * DAY;
  const made = new Map<number, number>();
  for (let c = v.time.length - 1; c >= 0 && (v.time[c] ?? 0) > since; c--) {
    if (isMerge(v, c) || (v.time[c] ?? 0) > v.anchor) continue;
    const p = personOf(v, c);
    if (p !== null) made.set(p, (made.get(p) ?? 0) + 1);
  }
  const found = new Set([...made].filter(([, n]) => n >= MAINTAINER_COMMITS).map(([p]) => p));
  maintainersOf.set(v, found);
  return found;
}

const moment = (v: IndexView, c: number, subject = ""): CodeMoment => {
  const who = authorOf(v, c);
  return { at: v.time[c] ?? 0, sha: v.ids[c] ?? "", subject, person: who === null ? null : personRef(v, who) };
};

const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear();

function busFactorOf(owners: number[], total: number): number | null {
  if (total === 0) return null;
  let held = 0;
  let n = 0;
  for (const commits of owners) {
    held += commits;
    n++;
    if (held > 0.8 * total) break;
  }
  return n;
}

function kindOf(v: IndexView, path: string): { kind: CodeStory["kind"]; wanted: Set<number> } {
  if (path === "" || path.endsWith("/")) {
    const wanted = new Set(filesUnder(v, path));
    return { kind: wanted.size > 0 ? "folder" : "missing", wanted };
  }
  const f = v.byPath.get(path);
  return f !== undefined && v.headOf.has(f) ? { kind: "file", wanted: new Set([f]) } : { kind: "missing", wanted: new Set() };
}

/** A file's or folder's story from a Stored Index: what it is at HEAD, its commits and people, when it was born and last changed, who holds it and whether they are still a Maintainer, its share of fixes and its years. */
export function storyOf(v: IndexView, path: string): Omit<CodeStory, "head" | "raw" | "paths"> {
  let kept = stories.get(v);
  if (!kept) {
    kept = new Map();
    stories.set(v, kept);
  }
  const hit = kept.get(path);
  if (hit) return hit;
  const { kind, wanted } = kindOf(v, path);
  const commits = kind === "missing" ? [] : underOf(v, path);
  let bytes = 0;
  let lines = 0;
  for (const f of wanted) {
    const h = v.headOf.get(f);
    bytes += h?.bytes ?? 0;
    lines += h?.class === "binary" ? 0 : (h?.loc ?? 0);
  }
  const head = kind === "file" ? v.headOf.get([...wanted][0] ?? -1) : undefined;
  const file: CodeStory["file"] = head
    ? (() => {
        const binary = head.class === "binary" || isBinaryPath(path);
        const flags = (head.class === "symlink" ? FILE_LINK : 0) | (binary ? FILE_BINARY : head.bytes > FILE_BYTES_MAX ? FILE_BIG : FILE_STORED);
        return { sha: head.blob, bytes: head.bytes, lines: binary ? 0 : head.loc, class: head.class, lang: languageOf(path), flags };
      })()
    : null;
  const people = new Set<number>();
  const owners = new Map<number, number>();
  const years = new Map<number, { commits: number; added: number; removed: number; owners: Map<number, number>; counted: number }>();
  let counted = 0;
  let fixes = 0;
  let classified = 0;
  for (const c of commits) {
    const p = personOf(v, c);
    if (p !== null) people.add(p);
    const year = yearOf(v.time[c] ?? 0);
    let y = years.get(year);
    if (!y) {
      y = { commits: 0, added: 0, removed: 0, owners: new Map(), counted: 0 };
      years.set(year, y);
    }
    y.commits++;
    for (let i = v.start[c] ?? 0; i < (v.start[c + 1] ?? 0); i++) {
      if (!wanted.has(v.file[i] ?? -1)) continue;
      y.added += Math.max(0, v.added[i] ?? 0);
      y.removed += Math.max(0, v.removed[i] ?? 0);
    }
    if (!counts(v, c)) continue;
    counted++;
    y.counted++;
    const kind = v.kind[c] ?? UNCLASSIFIED;
    if (kind !== UNCLASSIFIED) classified++;
    if (kind === FIXES) fixes++;
    if (p === null) continue;
    const who = p;
    owners.set(who, (owners.get(who) ?? 0) + 1);
    y.owners.set(who, (y.owners.get(who) ?? 0) + 1);
  }
  const ranked = [...owners].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const lead = maintainers(v);
  const holders: CodeHolder[] = ranked.slice(0, HOLDERS).map(([who, n]) => ({ person: personRef(v, who), commits: n, share: counted > 0 ? n / counted : 0, maintainer: lead.has(who) }));
  const yearList: CodeYear[] = [...years]
    .sort((a, b) => a[0] - b[0])
    .map(([year, y]) => {
      const top = [...y.owners].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, YEAR_OWNERS);
      const shown = top.reduce((n, [, k]) => n + k, 0);
      return {
        year,
        commits: y.commits,
        added: v.lines ? y.added : null,
        removed: v.lines ? y.removed : null,
        owners: top.map(([who, k]) => ({ person: personRef(v, who), commits: k })),
        others: y.counted - shown,
      };
    });
  const newest = commits[0];
  const oldest = commits[commits.length - 1];
  const story = {
    path,
    kind,
    anchor: v.anchor,
    file,
    files: wanted.size,
    bytes,
    lines,
    commits: commits.length,
    counted,
    people: people.size,
    born: oldest === undefined ? null : moment(v, oldest),
    last: newest === undefined ? null : moment(v, newest),
    holders,
    busFactor: kind === "folder" ? busFactorOf(ranked.map(([, n]) => n), counted) : null,
    fixes,
    classified,
    years: yearList,
  };
  kept.set(path, story);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  return story;
}

const checked = (path: string) => {
  if (path.length > 1000 || path.includes("\0")) throw new SiteError(400, "That is not a path.");
  return path === "/" ? "" : path;
};

async function viewFor(deps: Deps, viewer: Viewer, owner: string, name: string) {
  const { row, git } = await gitOf(deps, viewer, owner, name);
  if (row.indexId === null) throw new SiteError(404, NO_GIT);
  const view = await viewOf(deps.db, row.indexId);
  if (!view) throw new SiteError(404, NO_GIT);
  return { row, git, view, si: row.indexId };
}

/** The story of a file or folder at HEAD for the Code window's header, with where its text can be read and the other paths a file had. */
export async function codeStory(deps: Deps, viewer: Viewer, owner: string, name: string, asked: string): Promise<CodeStory> {
  const path = checked(asked);
  const { row, git, view, si } = await viewFor(deps, viewer, owner, name);
  const [story, [index]] = await Promise.all([inTurn(() => storyOf(view, path)), deps.db.select({ head: storedIndexes.head }).from(storedIndexes).where(eq(storedIndexes.id, si))]);
  const head = index?.head ?? git.head;
  const f = story.kind === "file" ? view.byPath.get(path) : undefined;
  const paths =
    f === undefined
      ? []
      : (await deps.db.select({ path: indexFilePaths.path }).from(indexFilePaths).where(and(eq(indexFilePaths.si, si), eq(indexFilePaths.file, f))))
          .map((r) => r.path)
          .filter((p) => p !== path)
          .sort();
  return { ...story, head, raw: row.isPrivate ? null : rawBase(row.owner, row.name, head), paths };
}

const STATES: Record<string, PullState> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };

/** One page of every commit that touched a file or folder at HEAD, newest first, merges left out: its lines there, its kind, and the pull request its subject names. */
export async function codeLog(deps: Deps, viewer: Viewer, owner: string, name: string, asked: string, page: number): Promise<CodeLog> {
  const path = checked(asked);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new SiteError(400, "That is not a page.");
  const { row, view, si } = await viewFor(deps, viewer, owner, name);
  const { kind, wanted } = kindOf(view, path);
  const all = kind === "missing" ? [] : underOf(view, path);
  const pages = Math.max(1, Math.ceil(all.length / CODE_LOG_PAGE));
  const shown = all.slice((page - 1) * CODE_LOG_PAGE, page * CODE_LOG_PAGE);
  const subjects = await subjectsOf(deps.db, si, shown.map((c) => view.ids[c] ?? ""));
  const numbers = new Map<number, number>();
  for (const c of shown) {
    const n = pullOf(subjects.get(view.ids[c] ?? "") ?? "");
    if (n !== null) numbers.set(c, n);
  }
  const wantedPulls = [...new Set(numbers.values())];
  const pulls = new Map<number, CodePull>();
  if (wantedPulls.length > 0) {
    const rows = await deps.db.select({ number: pullRequests.number, title: pullRequests.title, state: pullRequests.state }).from(pullRequests).where(and(eq(pullRequests.repoId, row.id), inArray(pullRequests.number, wantedPulls)));
    for (const r of rows) pulls.set(r.number, { number: r.number, title: r.title, state: STATES[r.state] ?? null });
  }
  const commits: CodeCommit[] = shown.map((c) => {
    let added = 0;
    let removed = 0;
    for (let i = view.start[c] ?? 0; i < (view.start[c + 1] ?? 0); i++) {
      if (!wanted.has(view.file[i] ?? -1)) continue;
      added += Math.max(0, view.added[i] ?? 0);
      removed += Math.max(0, view.removed[i] ?? 0);
    }
    const who = authorOf(view, c);
    const sha = view.ids[c] ?? "";
    const n = numbers.get(c);
    const person: PersonRef | null = who === null ? null : personRef(view, who);
    return {
      sha,
      at: view.time[c] ?? 0,
      offset: view.offset[c] ?? 0,
      subject: subjects.get(sha) ?? "",
      person,
      added: view.lines ? added : null,
      removed: view.lines ? removed : null,
      kind: view.kind[c] ?? 10,
      bulk: !counts(view, c),
      pull: n === undefined ? null : (pulls.get(n) ?? { number: n, title: null, state: null }),
    };
  });
  return { path, total: all.length, page, pages, commits };
}
