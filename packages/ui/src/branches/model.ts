import { branchStateOf, type BranchState, type GitBranch, type GitBranches } from "@commitscape/data";
import { binTimes, DAY, dayOf, type Span } from "./time";

export const GROUP_AT = 3;

export const SORTS = [
  { value: "new", label: "Newest commit" },
  { value: "ahead", label: "Most ahead" },
  { value: "behind", label: "Most behind" },
  { value: "old", label: "Oldest commit" },
] as const;

export type SortKey = (typeof SORTS)[number]["value"];

export const sortOf = (by: string | undefined): SortKey => SORTS.find((s) => s.value === by)?.value ?? "new";

export const STATE_IDS: readonly BranchState[] = ["flight", "waiting", "abandoned", "merged"];

export const stateOf = (value: string | undefined): BranchState | undefined => STATE_IDS.find((s) => s === value);

export type Row = { b: GitBranch; index: number; state: BranchState; who: string; prefix: string | null };

export type Filter = { q: string; state: BranchState | undefined; who: string | undefined; prefix: string | undefined; bots: boolean };

export const whoOf = (b: Pick<GitBranch, "login" | "author">): string => (b.login ?? b.author).toLowerCase();

/** The part of a branch's name up to and including its first slash, or null for a name with none. */
export function prefixOf(name: string): string | null {
  const cut = name.indexOf("/");
  return cut > 0 ? name.slice(0, cut + 1) : null;
}

/** Every branch but the default one, with the state it is in at the Build and its place in the list read. */
export function rowsOf(data: Pick<GitBranches, "branches" | "default" | "builtAt">): Row[] {
  const out: Row[] = [];
  data.branches.forEach((b, index) => {
    if (b.name === data.default) return;
    out.push({ b, index, state: branchStateOf(b, data.builtAt), who: whoOf(b), prefix: prefixOf(b.name) });
  });
  return out;
}

export function matches(r: Row, f: Filter, skip?: "state" | "bots" | "who" | "prefix"): boolean {
  if (skip !== "bots" && !f.bots && r.b.bot) return false;
  if (skip !== "state" && f.state && r.state !== f.state) return false;
  if (skip !== "who" && f.who && r.who !== f.who) return false;
  if (skip !== "prefix" && f.prefix && r.prefix !== f.prefix) return false;
  const q = f.q.trim().toLowerCase();
  if (q === "") return true;
  const { b } = r;
  return b.name.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || (b.login ?? "").toLowerCase().includes(q) || (b.pull ? `#${b.pull.number}`.includes(q) || b.pull.title.toLowerCase().includes(q) : false);
}

export type Facets = { states: Record<BranchState, number>; hiddenBots: number };

/** How many branches are in each state under the other filters, and how many bots' branches are hidden. */
export function facetsOf(rows: Row[], f: Filter): Facets {
  const states: Record<BranchState, number> = { flight: 0, waiting: 0, abandoned: 0, merged: 0 };
  let hiddenBots = 0;
  for (const r of rows) {
    if (matches(r, f, "state")) states[r.state] += 1;
    if (!f.bots && r.b.bot && matches(r, f, "bots")) hiddenBots += 1;
  }
  return { states, hiddenBots };
}

const byName = (a: Row, b: Row) => (a.b.name < b.b.name ? -1 : a.b.name > b.b.name ? 1 : 0);

export function sortRows(rows: Row[], by: SortKey): Row[] {
  const order: Record<SortKey, (a: Row, b: Row) => number> = {
    new: (a, b) => b.b.at - a.b.at || byName(a, b),
    old: (a, b) => a.b.at - b.b.at || byName(a, b),
    ahead: (a, b) => b.b.ahead - a.b.ahead || b.b.at - a.b.at || byName(a, b),
    behind: (a, b) => b.b.behind - a.b.behind || b.b.at - a.b.at || byName(a, b),
  };
  return [...rows].sort(order[by]);
}

export type Item = { kind: "row"; row: Row; indent: boolean } | { kind: "group"; prefix: string; rows: Row[]; open: boolean };

/** The rows in order, each prefix shared by several under one header that holds its members while open. */
export function itemsOf(rows: Row[], isOpen: (prefix: string) => boolean, grouping = true): Item[] {
  const by = new Map<string, Row[]>();
  if (grouping) for (const r of rows) if (r.prefix) by.set(r.prefix, [...(by.get(r.prefix) ?? []), r]);
  const out: Item[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    const members = r.prefix ? (by.get(r.prefix) ?? []) : [];
    if (!r.prefix || members.length < GROUP_AT) {
      out.push({ kind: "row", row: r, indent: false });
      continue;
    }
    if (done.has(r.prefix)) continue;
    done.add(r.prefix);
    const open = isOpen(r.prefix);
    out.push({ kind: "group", prefix: r.prefix, rows: members, open });
    if (open) for (const m of members) out.push({ kind: "row", row: m, indent: true });
  }
  return out;
}

export type Author = { key: string; name: string; login: string | null; count: number };

/** Who made the tips of these branches, most branches first. */
export function authorsOf(rows: Row[]): Author[] {
  const by = new Map<string, Author>();
  for (const r of rows) {
    const had = by.get(r.who);
    if (had) had.count += 1;
    else by.set(r.who, { key: r.who, name: r.b.author, login: r.b.login, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

/** The prefixes at least two of these branches share, most branches first. */
export function prefixesOf(rows: Row[]): { prefix: string; count: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) if (r.prefix) by.set(r.prefix, (by.get(r.prefix) ?? 0) + 1);
  return [...by].filter(([, n]) => n >= 2).map(([prefix, count]) => ({ prefix, count })).sort((a, b) => b.count - a.count || (a.prefix < b.prefix ? -1 : 1));
}

const startOf = (b: GitBranch) => dayOf(b.baseAt > 0 ? b.baseAt : b.at);

/** The days a strip over these branches covers: those on view and a stretch before them; older branches are counted. */
export function extentOf(rows: Row[], fit: Span, anchor: number): { span: Span; older: number } {
  const end = Math.max(dayOf(anchor) + 1, fit.to);
  const oldest = rows.length > 0 ? Math.min(...rows.map((r) => dayOf(r.b.at))) - 3 : fit.from;
  const from = Math.max(Math.min(oldest, fit.from), fit.from - Math.ceil((fit.to - fit.from) * 0.6));
  return { span: { from, to: end }, older: rows.filter((r) => dayOf(r.b.at) < from).length };
}

const MIN_SPAN = 14;

/** The days that show where most open branches began, to the Build. */
export function fitOf(rows: Row[], anchor: number): Span {
  const end = dayOf(anchor) + 1;
  const open = rows.filter((r) => r.state !== "merged");
  const base = open.length > 0 ? open : rows;
  if (base.length === 0) return { from: end - 90, to: end };
  const forks = base.map((r) => startOf(r.b)).sort((a, b) => a - b);
  const from = (forks[Math.floor((forks.length - 1) * 0.15)] ?? end - 90) - 2;
  return { from: Math.min(from, end - MIN_SPAN), to: end };
}

/** How many branches had their last commit in each of `n` equal slices of a span. */
export const binsOf = (rows: Row[], span: Span, n: number): number[] => binTimes(rows.map((r) => r.b.at), span, n);

/** A branch name as a shell takes it: quoted only when it has characters the shell would read. */
export const shellQuote = (name: string): string => (/^[A-Za-z0-9_./@%+=:,-]+$/.test(name) && !name.startsWith("-") ? name : `'${name.replace(/'/g, `'\\''`)}'`);

/** The commands that delete branches on the remote, up to `per` names each, one command to a line. */
export function deleteCommands(names: string[], remote = "origin", per = 20): string {
  const lines: string[] = [];
  for (let i = 0; i < names.length; i += per) lines.push(`git push ${remote} --delete ${names.slice(i, i + per).map(shellQuote).join(" ")}`);
  return lines.join("\n");
}

/** How long before the Build a time was: "3 days ago", "today" within a day of it, or a dash for none. */
export const agoOf = (anchor: number, at: number, words: (days: number) => string): string => {
  if (at <= 0) return "—";
  const days = Math.max(0, (anchor - at) / DAY);
  return days < 1 ? "today" : `${words(days)} ago`;
};
