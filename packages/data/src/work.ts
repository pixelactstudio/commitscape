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

/** A Proof of Work as Markdown, for a client or a self-review. */
export function workMarkdown(work: Work, site: string): string {
  const lines = [
    `# Proof of Work: ${work.name ?? work.login} (@${work.login})`,
    "",
    `${work.from} to ${work.to}${work.filter ? `, ${work.filter}` : ""}: ${workSentence(work.items)}`,
    "",
  ];
  for (const m of groupWork(work.items)) {
    lines.push(`## ${monthName(m.month)}`, "");
    for (const r of m.repositories) {
      lines.push(`### ${r.repo}${r.private ? " (private)" : ""}`, "");
      for (const i of r.items) {
        lines.push(
          i.kind === "pr"
            ? `- [#${i.number} ${escapeMd(i.title)}](${i.url}), merged ${i.at.slice(0, 10)}, +${i.additions ?? 0} −${i.deletions ?? 0}`
            : `- [\`${(i.sha ?? "").slice(0, 7)}\`](${i.url}) ${escapeMd(i.title)}, ${i.at.slice(0, 10)}`,
        );
      }
      lines.push("");
    }
  }
  lines.push(`Made with commitscape: ${site}/u/${work.login}/work${work.truncated ? ". GitHub returned at most 1,000 commits and 1,000 pull requests for this period; narrow it to see everything." : ""}`, "");
  return lines.join("\n");
}

/** A Proof of Work's numbers in one sentence. */
export function workSentence(items: WorkItem[]): string {
  const t = workTotals(items);
  const n = (count: number, one: string, more: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : more}`;
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
