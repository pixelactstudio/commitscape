import { expect, test } from "vitest";
import { groupWork, periodDates, workMarkdown, workTotals, type Work, type WorkItem } from "./work";

const item = (kind: "pr" | "commit", repo: string, at: string, extra: Partial<WorkItem> = {}): WorkItem => ({ kind, repo, private: false, title: `t ${at}`, url: `https://x/${repo}/${at}`, at, number: kind === "pr" ? 1 : null, sha: kind === "commit" ? "abcdef1234" : null, additions: kind === "pr" ? 10 : null, deletions: kind === "pr" ? 2 : null, ...extra });

test("named periods on UTC's calendar", () => {
  const today = new Date(Date.UTC(2026, 9, 4));
  expect(periodDates("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  expect(periodDates("this-month", today)).toEqual({ from: "2026-10-01", to: "2026-10-04" });
  expect(periodDates("last-3-months", today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  expect(periodDates("this-year", today)).toEqual({ from: "2026-01-01", to: "2026-10-04" });
  expect(periodDates("last-year", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  expect(periodDates("last-month", new Date(Date.UTC(2026, 0, 15)))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
});

test("grouped by month, newest first, then by repository, busiest first, pull requests before commits", () => {
  const items = [item("commit", "a/x", "2026-09-03"), item("pr", "a/x", "2026-09-02"), item("pr", "b/y", "2026-08-30"), item("commit", "c/z", "2026-09-10"), item("commit", "a/x", "2026-09-20")];
  const g = groupWork(items);
  expect(g.map((m) => m.month)).toEqual(["2026-09", "2026-08"]);
  expect(g[0]?.repositories.map((r) => r.repo)).toEqual(["a/x", "c/z"]);
  expect(g[0]?.repositories[0]?.items.map((i) => `${i.kind}:${i.at}`)).toEqual(["pr:2026-09-02", "commit:2026-09-20", "commit:2026-09-03"]);
  expect(workTotals(items)).toEqual({ prs: 2, commits: 3, additions: 20, deletions: 4, repositories: 3 });
});

test("as Markdown, with its links and what it covers", () => {
  const work: Work = { login: "alice", name: "Alice", from: "2026-09-01", to: "2026-09-30", filter: "acme", items: [item("pr", "acme/rocket", "2026-09-02", { number: 7, title: "Add *thrust*" })], scope: "public", shared: null, truncated: false, at: 0 };
  const md = workMarkdown(work, "https://commitscape.example");
  expect(md).toContain("# Proof of Work: Alice (@alice)");
  expect(md).toContain("2026-09-01 to 2026-09-30, acme: 1 pull request merged (+10 −2 lines), 0 commits, in 1 repository.");
  expect(md).toContain("## September 2026");
  expect(md).toContain("- [#7 Add \\*thrust\\*](https://x/acme/rocket/2026-09-02), merged 2026-09-02, +10 −2");
  expect(md).toContain("https://commitscape.example/u/alice/work");
});
