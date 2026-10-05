export type WorkItem = {
  kind: "pr" | "commit";
  repo: string;
  private: boolean;
  title: string;
  url: string;
  at: string;
  number: number | null;
  sha: string | null;
  additions: number | null;
  deletions: number | null;
};

export type Work = {
  login: string;
  name: string | null;
  from: string;
  to: string;
  filter: string | null;
  items: WorkItem[];
  scope: "public" | "self";
  shared: string | null;
  truncated: boolean;
  at: number;
};

export type WorkMonth = { month: string; repositories: { repo: string; private: boolean; items: WorkItem[] }[] };

/** A Proof of Work's items by month, newest first, and within a month by repository, busiest first. */
export function groupWork(items: WorkItem[]): WorkMonth[] {
  const months = new Map<string, Map<string, WorkItem[]>>();
  for (const item of items) {
    const month = item.at.slice(0, 7);
    const repos = months.get(month) ?? new Map<string, WorkItem[]>();
    repos.set(item.repo, [...(repos.get(item.repo) ?? []), item]);
    months.set(month, repos);
  }
  return [...months.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, repos]) => ({
      month,
      repositories: [...repos.entries()]
        .map(([repo, list]) => ({ repo, private: list.some((i) => i.private), items: list.sort((a, b) => (a.kind === b.kind ? (a.at < b.at ? 1 : -1) : a.kind === "pr" ? -1 : 1)) }))
        .sort((a, b) => b.items.length - a.items.length || (a.repo < b.repo ? -1 : 1)),
    }));
}

/** A Proof of Work's numbers: merged pull requests, commits, lines in the pull requests, repositories. */
export function workTotals(items: WorkItem[]) {
  const prs = items.filter((i) => i.kind === "pr");
  return {
    prs: prs.length,
    commits: items.filter((i) => i.kind === "commit").length,
    additions: prs.reduce((n, i) => n + (i.additions ?? 0), 0),
    deletions: prs.reduce((n, i) => n + (i.deletions ?? 0), 0),
    repositories: new Set(items.map((i) => i.repo)).size,
  };
}

export type WorkKind = "feature" | "fix" | "docs" | "refactor" | "test" | "perf" | "chore" | "other";

export const WORK_KINDS: { kind: WorkKind; label: string; short: string }[] = [
  { kind: "feature", label: "Features and improvements", short: "Features" },
  { kind: "fix", label: "Fixes", short: "Fixes" },
  { kind: "refactor", label: "Refactors", short: "Refactors" },
  { kind: "docs", label: "Docs", short: "Docs" },
  { kind: "test", label: "Tests", short: "Tests" },
  { kind: "perf", label: "Performance", short: "Performance" },
  { kind: "chore", label: "Chores", short: "Chores" },
  { kind: "other", label: "Other", short: "Other" },
];

const CONVENTIONAL: Record<string, WorkKind> = {
  feat: "feature",
  feature: "feature",
  fix: "fix",
  bugfix: "fix",
  hotfix: "fix",
  docs: "docs",
  doc: "docs",
  refactor: "refactor",
  style: "refactor",
  test: "test",
  tests: "test",
  perf: "perf",
  chore: "chore",
  build: "chore",
  ci: "chore",
  deps: "chore",
  release: "chore",
  revert: "fix",
};

const WORDS: [WorkKind, RegExp][] = [
  ["chore", /^(dev|develop|development|main|master|staging|stage|prod|production|release|next|beta)$|^(sync|merge) .*\b(into|to|with) (main|master|dev|develop|staging|production)\b/],
  ["test", /^(tests?|testing|specs?)\b|\b(add|adds|added|more|write|improve)\s+(unit |e2e |integration |end-to-end )?tests?\b|\btests? for\b|\bin (the )?.*tests$/],
  ["docs", /^(docs?|documentation|readme|document)\b|\b(readme|documentation|docs|guide|changelog)\b/],
  ["chore", /^(bump|upgrade|chore|release|merge|lint|format|deps|dependencies|checkpoint|wip|v?\d+\.\d+)\b|\bdependenc(y|ies)\b|\b(flake|lockfile|lock file) update\b|^update (deps|lockfile|lock file|the lockfile|flake)\b|\bci\b/],
  ["perf", /^(perf|speed up|optimi[sz]e)|\b(performance|faster|speed up)\b/],
  ["fix", /^(fix|fixes|fixed|fixing|bugfix|hotfix|resolve[sd]?|correct|repair|patch|prevent|handle|avoid|stop|restore|revert|harden|guard|stabili[sz]e|retry|recover)\b|\bbugs?\b|\bcrash|\bbroken\b/],
  ["refactor", /^(refactor|rename|move|moved|clean|cleanup|simplify|extract|reorgani[sz]e|restructure|reshape|split|consolidate|unify|remove|delete|drop|replace|migrate|convert|tidy|rework|rewrite|reduce|isolate)\b/],
  [
    "feature",
    /^(add|adds|added|adding|implement|introduce|support|create|new|enable|allow|build|show|let|expose|improve|enhance|display|initial|init|redesign|use|make|give|keep|run|route|integrate|serve|load|read|resume|sync|default|filter|stage|cap|limit|restrict|authenticate|reason|stagger|set|switch|wire|connect|ship|launch|track|render|generate|publish|deploy|upload|accept|require|prefer|open|start|store|save|send|return|provide|update|polish|teach|turn|count|draw|list|link|search|share|ask|warn|explain|plan)\b|\bupdate$/,
  ],
];

/** What kind of work a pull request or commit is, from its conventional prefix ("feat:", "fix(ui):") or else the words of its title. */
export function kindOf(title: string): WorkKind {
  let clean = title.replace(/^[^A-Za-z0-9[(]+/, "").replace(/^\[([^\]]+)\]\s*/, "$1: ").trim();
  const head = /^([A-Za-z]+)(\([^)]*\))?!?:\s/.exec(clean);
  const prefix = head?.[1]?.toLowerCase();
  if (prefix && CONVENTIONAL[prefix]) return CONVENTIONAL[prefix];
  const scoped = /^[\w ./-]{1,32}:\s+(.+)$/.exec(clean);
  if (scoped?.[1]) clean = scoped[1];
  const text = clean.toLowerCase();
  return WORDS.find(([, re]) => re.test(text))?.[0] ?? "other";
}

export type WorkRepository = { repo: string; private: boolean; prs: number; commits: number; additions: number; deletions: number; items: number };

export type WorkSummary = {
  totals: ReturnType<typeof workTotals>;
  activeDays: number;
  kinds: { kind: WorkKind; label: string; short: string; count: number; share: number }[];
  repositories: WorkRepository[];
  highlights: WorkItem[];
};

const LOW = new Set<WorkKind>(["chore", "other"]);
const size = (i: WorkItem) => (i.additions ?? 0) + (i.deletions ?? 0);

/** A Proof of Work in brief: its numbers, how its items split by kind of work (in the fixed order of WORK_KINDS), its repositories busiest first, and its biggest merged pull requests. */
export function workSummary(items: WorkItem[]): WorkSummary {
  const counts = new Map<WorkKind, number>();
  const repos = new Map<string, WorkRepository>();
  for (const i of items) {
    const k = kindOf(i.title);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    const r = repos.get(i.repo) ?? { repo: i.repo, private: false, prs: 0, commits: 0, additions: 0, deletions: 0, items: 0 };
    r.private ||= i.private;
    r.items++;
    if (i.kind === "pr") {
      r.prs++;
      r.additions += i.additions ?? 0;
      r.deletions += i.deletions ?? 0;
    } else r.commits++;
    repos.set(i.repo, r);
  }
  const total = Math.max(1, items.length);
  return {
    totals: workTotals(items),
    activeDays: new Set(items.map((i) => i.at.slice(0, 10))).size,
    kinds: WORK_KINDS.map(({ kind, label, short }) => ({ kind, label, short, count: counts.get(kind) ?? 0, share: (counts.get(kind) ?? 0) / total }))
      .filter((k) => k.count > 0),
    repositories: [...repos.values()].sort((a, b) => b.items - a.items || (a.repo < b.repo ? -1 : 1)),
    highlights: items
      .filter((i) => i.kind === "pr" && !LOW.has(kindOf(i.title)))
      .sort((a, b) => size(b) - size(a))
      .slice(0, 5),
  };
}

/** The most telling items of one kind of work: merged pull requests, biggest first, then commits, newest first. */
export function notable(items: WorkItem[], kind: WorkKind, count: number): { shown: WorkItem[]; total: number } {
  const all = items.filter((i) => kindOf(i.title) === kind);
  const prs = all.filter((i) => i.kind === "pr").sort((a, b) => size(b) - size(a));
  const commits = all.filter((i) => i.kind === "commit").sort((a, b) => (a.at < b.at ? 1 : -1));
  return { shown: [...prs, ...commits].slice(0, count), total: all.length };
}

/** Whether an item is in an organisation ("acme") or a repository ("acme/rocket"). */
export function inFilter(item: WorkItem, filter: string | null): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase();
  const repo = item.repo.toLowerCase();
  return f.includes("/") ? repo === f : repo.startsWith(`${f}/`);
}

/** A period as words: "1 September to 30 September 2026". */
export function periodWords(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const long = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const first = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(a);
  return `${first} to ${long.format(b)}`;
}

/** The kinds of work that lead, in words: "mostly features (45%) and fixes (20%)". */
export function leadingKinds(summary: WorkSummary): string | null {
  const top = summary.kinds
    .filter((k) => !LOW.has(k.kind) && k.share >= 0.15)
    .sort((a, b) => b.share - a.share)
    .slice(0, 2);
  if (top.length === 0) return null;
  return `mostly ${top.map((k) => `${k.short.toLowerCase()} (${Math.round(k.share * 100)}%)`).join(" and ")}`;
}

/** A share as a whole percentage, and "<1%" for a share too small to round to one. */
export const percent = (share: number) => (share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);

const n = (count: number, one: string, more: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : more}`;
const signed = (a: number, d: number) => `+${a.toLocaleString("en-US")} −${d.toLocaleString("en-US")}`;
const NOTABLE = 8;

/** A Proof of Work as Markdown, for a client or a self-review: a summary first, then the notable work by kind, then every item by month. */
export function workMarkdown(work: Work, site: string): string {
  const s = workSummary(work.items);
  const t = s.totals;
  const lead = leadingKinds(s);
  const where = work.filter ? `Only in ${work.filter}` : "Everywhere on GitHub";
  const lines = [`# Proof of Work: ${work.name ?? work.login} (@${work.login})`, "", `**${periodWords(work.from, work.to)}** · ${where}${work.scope === "self" ? " · includes private work" : ""}`, ""];
  if (work.items.length === 0) {
    lines.push("Nothing merged or committed in this period.", "", `Made with commitscape: ${site}/u/${work.login}/work`, "");
    return lines.join("\n");
  }
  lines.push(
    `${work.from} to ${work.to}${work.filter ? `, ${work.filter}` : ""}: ${workSentence(work.items)}${lead ? ` The work is ${lead}.` : ""}`,
    "",
    "| Pull requests merged | Commits | Lines merged | Repositories | Active days |",
    "|---:|---:|---:|---:|---:|",
    `| ${t.prs.toLocaleString("en-US")} | ${t.commits.toLocaleString("en-US")} | ${signed(t.additions, t.deletions)} | ${t.repositories} | ${s.activeDays} |`,
    "",
    "## Kind of work",
    "",
    "| Kind | Items | Share |",
    "|---|---:|---:|",
    ...s.kinds.map((k) => `| ${k.label} | ${k.count.toLocaleString("en-US")} | ${percent(k.share)} |`),
    "",
    "## Top repositories",
    "",
    "| Repository | Pull requests | Commits | Lines merged |",
    "|---|---:|---:|---:|",
    ...s.repositories.slice(0, 8).map((r) => `| ${r.repo}${r.private ? " (private)" : ""} | ${r.prs} | ${r.commits} | ${r.prs ? signed(r.additions, r.deletions) : "—"} |`),
    "",
  );
  if (s.highlights.length > 0) {
    lines.push("## Biggest contributions", "");
    s.highlights.forEach((i, at) => lines.push(`${at + 1}. [#${i.number} ${escapeMd(i.title)}](${i.url}) in ${i.repo}, ${signed(i.additions ?? 0, i.deletions ?? 0)}, merged ${i.at.slice(0, 10)}`));
    lines.push("");
  }
  lines.push("## By kind of work", "");
  for (const k of s.kinds) {
    const { shown, total } = notable(work.items, k.kind, LOW.has(k.kind) ? 3 : NOTABLE);
    lines.push(`### ${k.label} (${total.toLocaleString("en-US")})`, "", ...shown.map((i) => `- ${itemLine(i)} · ${i.repo}`));
    if (total > shown.length) lines.push(`- …and ${n(total - shown.length, "more", "more")}, in the appendix`);
    lines.push("");
  }
  lines.push("## Appendix: everything, by month", "");
  for (const m of groupWork(work.items)) {
    lines.push(`### ${monthName(m.month)}`, "");
    for (const r of m.repositories) {
      lines.push(`#### ${r.repo}${r.private ? " (private)" : ""}`, "", ...r.items.map((i) => `- ${itemLine(i)}`), "");
    }
  }
  lines.push(`Made with commitscape: ${site}/u/${work.login}/work${work.truncated ? ". GitHub returned at most 1,000 commits and 1,000 pull requests for this period; narrow it to see everything." : ""}`, "");
  return lines.join("\n");
}

function itemLine(i: WorkItem): string {
  return i.kind === "pr" ? `[#${i.number} ${escapeMd(i.title)}](${i.url}), merged ${i.at.slice(0, 10)}, ${signed(i.additions ?? 0, i.deletions ?? 0)}` : `[\`${(i.sha ?? "").slice(0, 7)}\`](${i.url}) ${escapeMd(i.title)}, ${i.at.slice(0, 10)}`;
}

/** A Proof of Work's numbers in one sentence. */
export function workSentence(items: WorkItem[]): string {
  const t = workTotals(items);
  return `${n(t.prs, "pull request", "pull requests")} merged (+${t.additions.toLocaleString("en-US")} −${t.deletions.toLocaleString("en-US")} lines), ${n(t.commits, "commit", "commits")}, in ${n(t.repositories, "repository", "repositories")}.`;
}

export function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function escapeMd(text: string): string {
  return text.replace(/([[\]\\*_`])/g, "\\$1");
}

export const PERIODS = [
  ["last-month", "Last month"],
  ["this-month", "This month"],
  ["last-3-months", "The last three months"],
  ["this-year", "This year"],
  ["last-year", "Last year"],
] as const;
export type Period = (typeof PERIODS)[number][0];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A named period's first and last day, on UTC's calendar, from today. */
export function periodDates(period: Period, today: Date = new Date()): { from: string; to: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const day = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  switch (period) {
    case "this-month":
      return { from: iso(day(y, m, 1)), to: iso(today) };
    case "last-3-months":
      return { from: iso(day(y, m - 3, 1)), to: iso(day(y, m, 0)) };
    case "this-year":
      return { from: iso(day(y, 0, 1)), to: iso(today) };
    case "last-year":
      return { from: iso(day(y - 1, 0, 1)), to: iso(day(y - 1, 11, 31)) };
    default:
      return { from: iso(day(y, m - 1, 1)), to: iso(day(y, m, 0)) };
  }
}
