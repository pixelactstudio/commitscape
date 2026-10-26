import type { PersonRef } from "./types";

export const GIT_FORMAT = 1;

export type GitPerson = { name: string; login: string | null };

export const FILE_BINARY = 1;
export const FILE_STORED = 2;
export const FILE_BIG = 4;
export const FILE_LINK = 8;

export const FILE_BYTES_MAX = 256 * 1024;

export type GitDir = {
  path: string;
  files: number;
  size: number;
  commits: number;
  last: number;
  owners: number[];
};

export type GitTree = {
  v: typeof GIT_FORMAT;
  builtAt: number;
  head: string;
  branch: string;
  logged: number;
  complete: boolean;
  people: GitPerson[];
  langs: string[];
  paths: string[];
  size: number[];
  sha: string[];
  lang: number[];
  flags: number[];
  lines: (number | null)[];
  churn: number[];
  first: number[];
  last: number[];
  owners: number[][];
  dirs: GitDir[];
  stored: number;
  skipped: number;
  raw?: string | null;
};

export type GitCoupling = { v: typeof GIT_FORMAT; of: Record<string, number[]> };

export type GitLogPerson = { id: number; name: string; login: string | null; colour: number | null; bot: boolean };

export type GitLog = {
  v: typeof GIT_FORMAT;
  anchor: number;
  people: GitLogPerson[];
  folders: string[];
  folder: number[];
  names: string[];
  lines: number[];
  alive: number[];
  gaps: number[];
  who: number[];
  kept: number[];
  sizes: number[];
  files: number[];
};

export type GitBranch = {
  name: string;
  sha: string;
  at: number;
  author: string;
  login: string | null;
  subject: string;
  ahead: number;
  behind: number;
  base: string;
  baseAt: number;
  merged: boolean;
  squashed: boolean;
  parent: string | null;
  shared: number;
  bot?: boolean;
  pull?: GitBranchPull | null;
  ticks?: number[];
};

export type GitBranchPull = { number: number; state: string; title: string; mergedAt: number | null; draft?: boolean | null };

export type GitTag = { name: string; sha: string; at: number; since?: number | null };

export type GitBranchCommit = { sha: string; subject: string; author: string; at: number };

export type GitBranchFile = { path: string; added: number | null; removed: number | null };

export type GitBranchDetail = {
  v: typeof GIT_FORMAT;
  name: string;
  against: string;
  commits: GitBranchCommit[];
  commitsTotal: number;
  files: GitBranchFile[];
  filesTotal: number;
  added: number;
  removed: number;
};

export type GitBranches = {
  v: typeof GIT_FORMAT;
  builtAt: number;
  default: string;
  head: string;
  total: number;
  inferred: boolean;
  branches: GitBranch[];
  tags: GitTag[];
  tagsTotal: number;
};

export type GitHolder = { name: string; login: string | null; files: number; commits: number; last: number; maintainer: boolean };

export type GitConflict = { path: string; commits: number; last: number; name: string | null; login: string | null };

export type GitBranchInsight = {
  v: typeof GIT_FORMAT;
  name: string;
  forkedAt: number;
  touched: number;
  known: number;
  atHead: string[];
  landed: number;
  holders: GitHolder[];
  conflicts: GitConflict[];
  conflictCommits: number;
};

export type BranchState = "flight" | "waiting" | "abandoned" | "merged";

export const BRANCH_QUIET_DAYS = 30;

export const BRANCH_STALE_DAYS = 90;

/** Which question a branch answers: done with (merged), in flight (an open pull request or a commit within 30 days of `anchor`), waiting (up to 90 days) or abandoned. */
export function branchStateOf(b: Pick<GitBranch, "merged" | "at" | "pull">, anchor: number): BranchState {
  if (b.merged) return "merged";
  if (b.pull?.state === "OPEN") return "flight";
  const days = (anchor - b.at) / 86_400;
  if (days <= BRANCH_QUIET_DAYS) return "flight";
  return days <= BRANCH_STALE_DAYS ? "waiting" : "abandoned";
}

/** How many branches other than the default one are open: not merged, and not a bot's. */
export function openBranchesOf(data: Pick<GitBranches, "branches" | "default">): number {
  return data.branches.filter((b) => b.name !== data.default && !b.merged && !b.bot).length;
}

const TAG_SEPARATORS = "-_/@.";

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

export const OTHER_TAGS = "\u0000other";

/** The family a tag belongs to: the name before its version (`ignore-0.4.33` is of `ignore`, `v19.1.0` of the empty family, `status` of `OTHER_TAGS`), and the separator that followed it. */
export function tagFamilyOf(name: string): { key: string; sep: string } {
  const n = name.length;
  const runEnd = new Int32Array(n + 1);
  runEnd[n] = n;
  for (let i = n - 1; i >= 0; i--) runEnd[i] = isDigit(name[i]) ? (runEnd[i + 1] as number) : i;
  const versionAt = (i: number) => {
    const j = name[i] === "v" ? i + 1 : i;
    if (!isDigit(name[j])) return false;
    const end = runEnd[j] as number;
    return name[end] === "." && isDigit(name[end + 1]);
  };
  for (let k = 0; k < n; k++) {
    if (TAG_SEPARATORS.includes(name[k] as string) && versionAt(k + 1)) return { key: name.slice(0, k), sep: name[k] as string };
    if (versionAt(k)) return { key: name.slice(0, k), sep: "" };
  }
  return { key: OTHER_TAGS, sep: "" };
}

export type GitPullHead = { head: string; stored: boolean; bytes: number; onto?: string };

export type GitPullIndex = { v: typeof GIT_FORMAT; builtAt: number; pulls: Record<string, GitPullHead> };

export type GitPullCommit = { sha: string; subject: string; author: string; at: number };

export type GitPullFile = {
  path: string;
  old: string | null;
  status: string;
  added: number | null;
  removed: number | null;
  binary: boolean;
  patch: string | null;
  omitted: "large" | "cap" | null;
};

export type GitPull = {
  v: typeof GIT_FORMAT;
  number: number;
  head: string;
  base: string | null;
  basis: "fork" | "merge" | "none";
  onto?: string;
  commits: GitPullCommit[];
  commitsTotal: number;
  files: GitPullFile[];
  filesTotal: number;
  added: number;
  removed: number;
};

export type GitStatus = {
  builtAt: number;
  head: string;
  branch: string;
  branches: number;
  branchesTotal: number;
  openBranches: number;
  openPulls: number;
  pullsTotal: number;
  tags: number;
  tagsTotal: number;
  files: number;
  stored: number;
  pulls: number;
  bytes: number;
  logged: number;
  complete: boolean;
};

const LANGUAGES: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "jsonc", json5: "json5", md: "markdown", mdx: "mdx", rs: "rust", py: "python", pyi: "python", go: "go", java: "java", kt: "kotlin", kts: "kotlin",
  swift: "swift", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", cs: "csharp", rb: "ruby", php: "php", sh: "bash", bash: "bash", zsh: "bash",
  fish: "fish", ps1: "powershell", css: "css", scss: "scss", sass: "sass", less: "less", html: "html", htm: "html", vue: "vue", svelte: "svelte", astro: "astro",
  yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", svg: "xml", sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto", dockerfile: "docker",
  lua: "lua", pl: "perl", r: "r", scala: "scala", dart: "dart", ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", clj: "clojure", ml: "ocaml", nix: "nix",
  zig: "zig", tf: "hcl", hcl: "hcl", cmake: "cmake", make: "make", mk: "make", ini: "ini", cfg: "ini", conf: "ini", diff: "diff", patch: "diff", tex: "latex",
  vim: "viml", el: "emacs-lisp", lisp: "lisp", jl: "julia", m: "objective-c", mm: "objective-cpp", sol: "solidity", wasm: "wasm", txt: "text", csv: "csv", lock: "text",
};

const NAMES: Record<string, string> = {
  dockerfile: "docker", makefile: "make", gnumakefile: "make", cmakelists: "cmake", gemfile: "ruby", rakefile: "ruby", justfile: "make", ".gitignore": "ini", ".env": "ini",
  ".editorconfig": "ini", ".npmrc": "ini", ".gitattributes": "ini", "cargo.lock": "toml", "go.mod": "go", "go.sum": "text", license: "text", readme: "markdown", codeowners: "text",
};

const BINARY = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tif", "tiff", "psd", "heic", "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war", "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "avi", "mkv", "webm", "wav", "ogg", "flac", "m4a", "exe", "dll", "so", "dylib", "a", "o", "obj", "class", "pyc", "wasm", "bin", "dat", "db", "sqlite", "pack", "idx", "node", "iso", "dmg",
]);

export const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

const own = (table: Record<string, string>, key: string): string | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The language a file is highlighted as, by its name or extension; "text" when none is known. */
export function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = own(NAMES, name) ?? own(NAMES, name.replace(/\.[^.]+$/, ""));
  if (byName) return byName;
  return own(LANGUAGES, extensionOf(path)) ?? "text";
}

/** Where raw.githubusercontent.com serves a public repository's files at one commit; a file's address is this followed by `rawPath` of its path. */
export const rawBase = (owner: string, repo: string, commit: string): string => `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commit}/`;

/** A path as raw.githubusercontent.com takes it: each part encoded on its own. */
export const rawPath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** Whether a file's extension says it is not text. */
export const isBinaryPath = (path: string): boolean => BINARY.has(extensionOf(path));

const SQUASH = /\(#(\d{1,7})\)\s*$/;
const MERGE = /^Merge pull request #(\d{1,7})\b/;
const TRAILING = /\(#(\d{1,7})\)/g;

/** The pull request a commit's subject names: "(#123)" or "Merge pull request #123", else null. */
export function pullOf(subject: string): number | null {
  const merge = MERGE.exec(subject);
  if (merge?.[1]) return Number(merge[1]);
  const squash = SQUASH.exec(subject);
  if (squash?.[1]) return Number(squash[1]);
  const any = [...subject.matchAll(TRAILING)].at(-1);
  return any?.[1] ? Number(any[1]) : null;
}

/** The index of the first path at or after `prefix`, and one past the last under it, in a list of paths sorted by code unit. */
export function rangeOf(paths: readonly string[], prefix: string): [number, number] {
  const first = (key: string) => {
    let lo = 0;
    let hi = paths.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((paths[mid] ?? "") < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return [first(prefix), first(`${prefix}\uffff`)];
}

export type PathCommit = { sha: string; at: number; offset: number; subject: string; merge: boolean; person: PersonRef | null };

export type PathHistory = { path: string; total: number; commits: PathCommit[]; logged: number; complete: boolean; times?: number[]; months?: { from: number; step: number; counts: number[] } | null };

export type FolderEntryLast = { name: string; dir: boolean; sha: string; subject: string; at: number; person: PersonRef | null };

export type FolderLast = { path: string; entries: FolderEntryLast[] };

export type PullState = "open" | "merged" | "closed";

export type PullLabel = { name: string; colour: string };

export type PullDecision = "approved" | "changes_requested" | "review_required";

export type PullReviewState = "approved" | "changes_requested" | "commented" | "dismissed";

export type PullRow = {
  number: number;
  title: string;
  state: PullState;
  author: string | null;
  createdAt: number;
  mergedAt: number | null;
  closedAt: number | null;
  updatedAt: number;
  additions: number;
  deletions: number;
  changedFiles: number | null;
  commits: number | null;
  comments: number | null;
  draft: boolean | null;
  head: string | null;
  headOwner: string | null;
  fork: boolean | null;
  base: string | null;
  labels: PullLabel[];
  decision: PullDecision | null;
  mergedBy: string | null;
  mergeCommit: string | null;
  reviewers: string[];
  reviewStates?: (PullReviewState | null)[];
  firstReviewAt: number | null;
};

export type PullSort = "created" | "updated" | "merged" | "closed" | "size" | "oldest" | "comments";

export type PullSize = "xs" | "s" | "m" | "l" | "xl";

export const PULL_SIZES: readonly { id: PullSize; label: string; under: number | null }[] = [
  { id: "xs", label: "XS", under: 10 },
  { id: "s", label: "S", under: 50 },
  { id: "m", label: "M", under: 250 },
  { id: "l", label: "L", under: 1000 },
  { id: "xl", label: "XL", under: null },
];

/** The size bucket of a pull request by the lines it added and removed together: under 10, 50, 250 and 1,000 lines, then larger. */
export const pullSizeOf = (lines: number): PullSize => PULL_SIZES.find((s) => s.under === null || lines < s.under)?.id ?? "xl";

export const PULL_STALE_DAYS = 90;

export type PullReviewFilter = "none" | "reviewed" | "approved" | "changes";

export type PullWindow = "30d" | "90d" | "1y" | "all";

export type PullAsk = {
  state?: PullState | "all";
  author?: string;
  q?: string;
  page?: number;
  label?: string;
  base?: string;
  draft?: boolean;
  sort?: PullSort;
  size?: PullSize;
  review?: PullReviewFilter;
  stale?: boolean;
  window?: PullWindow;
  from?: number;
  to?: number;
};

export type PullSpan = { since: number | null; until: number };

export type PullList = {
  total: number;
  counts: Record<PullState, number>;
  authors?: { login: string; pulls: number }[];
  labels?: (PullLabel & { pulls: number })[];
  span?: PullSpan;
  page: number;
  pages: number;
  rows: PullRow[];
  read: boolean;
};

export type PullStatsAsk = { window?: PullWindow; from?: number; to?: number };

export type PullReviewerLoad = { login: string; pulls: number; reviews: number; median: number | null };

export type PullStats = {
  span: PullSpan;
  total: number;
  unread: number;
  opened: number;
  merged: number;
  closed: number;
  open: number;
  idle: number;
  mergeTime: { n: number; median: number | null; p90: number | null; bands: number[] };
  firstReview: { n: number; of: number; median: number | null };
  unreviewed: { n: number; of: number };
  months: { unit: "week" | "month"; from: number; opened: number[]; merged: number[]; closed: number[] } | null;
  sizes: { size: PullSize; opened: number; merged: number; closed: number }[];
  reviewers: PullReviewerLoad[];
};

export type PullAuthor = { login: string; pulls: number };

export type PullHolder = { person: PersonRef; files: number; commits: number; last: number; maintainer: boolean };

export type PullPartner = { path: string; together: number; commits: number };

export type PullLanded = { sha: string; at: number; subject: string; person: PersonRef | null; added: number | null; removed: number | null; files: number };

export type PullFileChange = { path: string; added: number | null; removed: number | null; head: boolean };

export type PullInsight = {
  number: number;
  source: "kept" | "commit" | "none";
  touched: number;
  known: number;
  together: number;
  holders: PullHolder[];
  partners: PullPartner[];
  landed: PullLanded[];
  files: PullFileChange[];
  filesTotal: number;
};

export type PullReview = { login: string; reviews: number; firstAt: number; lastAt: number | null; state: PullReviewState | null; approvedAt: number | null };

export type PullHeader = PullRow & { reviews: PullReview[]; git: boolean };

export type PullComment = { id: number; login: string | null; at: string; body: string; url: string };

export type PullConversation = {
  state: string;
  draft: boolean;
  merged: boolean;
  body: string;
  login: string | null;
  at: string;
  head: string;
  base: string;
  labels: { name: string; colour: string }[];
  comments: PullComment[];
  reviews: { id: number; login: string | null; state: string; at: string | null; body: string; url: string }[];
  url: string;
};

export type CodeHolder = { person: PersonRef; commits: number; share: number; maintainer: boolean };

export type CodeYear = { year: number; commits: number; added: number | null; removed: number | null; owners: { person: PersonRef; commits: number }[]; others: number };

export type CodeMoment = { at: number; sha: string; subject: string; person: PersonRef | null };

export type CodeStory = {
  path: string;
  kind: "file" | "folder" | "missing";
  head: string;
  raw: string | null;
  anchor: number;
  file: { sha: string; bytes: number; lines: number; class: string; lang: string; flags: number } | null;
  files: number;
  bytes: number;
  lines: number;
  commits: number;
  counted: number;
  people: number;
  born: CodeMoment | null;
  last: CodeMoment | null;
  holders: CodeHolder[];
  busFactor: number | null;
  fixes: number;
  classified: number;
  years: CodeYear[];
  paths: string[];
};

export type CodePull = { number: number; title: string | null; state: PullState | null };

export type CodeCommit = { sha: string; at: number; offset: number; subject: string; person: PersonRef | null; added: number | null; removed: number | null; kind: number; bulk: boolean; pull: CodePull | null };

export type CodeLog = { path: string; total: number; page: number; pages: number; commits: CodeCommit[] };

export const CODE_LOG_PAGE = 50;
