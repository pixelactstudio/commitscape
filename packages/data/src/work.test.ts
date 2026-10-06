import { expect, test } from "vitest";
import { groupWork, inFilter, kindOf, periodDates, periodWords, workMarkdown, workSummary, workTotals, type Work, type WorkItem } from "./work";

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

test("the kind of work, from conventional prefixes and else from the title's words", () => {
  expect(kindOf("feat(ui): a period picker")).toBe("feature");
  expect(kindOf("fix!: stop the crash")).toBe("fix");
  expect(kindOf("docs: explain the queue")).toBe("docs");
  expect(kindOf("chore(deps): bump vite")).toBe("chore");
  expect(kindOf("[perf] cache the graph")).toBe("perf");
  expect(kindOf("Add a period picker")).toBe("feature");
  expect(kindOf("Fix imported preview ports")).toBe("fix");
  expect(kindOf("Resolve the race in the queue")).toBe("fix");
  expect(kindOf("Update README with install steps")).toBe("docs");
  expect(kindOf("Add tests for the builder")).toBe("test");
  expect(kindOf("Rename Report to Build")).toBe("refactor");
  expect(kindOf("Bump react from 19.1 to 19.2")).toBe("chore");
  expect(kindOf("Merge branch 'main' into dev")).toBe("chore");
  expect(kindOf("✨ Introduce dark mode")).toBe("feature");
  expect(kindOf("Dev")).toBe("chore");
  expect(kindOf("AI builder: stop the loop failures")).toBe("fix");
  expect(kindOf("Write the setup guide in English")).toBe("docs");
  expect(kindOf("Checkpoint")).toBe("chore");
  expect(kindOf("Something else entirely")).toBe("other");
});

test("in brief: kinds in their fixed order, repositories busiest first, the biggest merged pull requests", () => {
  const items = [
    item("pr", "a/x", "2026-09-02", { title: "feat: one", additions: 500, deletions: 10 }),
    item("pr", "a/x", "2026-09-03", { title: "fix: two", additions: 5, deletions: 1 }),
    item("commit", "b/y", "2026-09-03", { title: "fix: three" }),
    item("commit", "a/x", "2026-09-04", { title: "Something" }),
  ];
  const s = workSummary(items);
  expect(s.kinds.map((k) => [k.kind, k.count])).toEqual([["feature", 1], ["fix", 2], ["other", 1]]);
  expect(s.repositories.map((r) => [r.repo, r.prs, r.commits, r.additions])).toEqual([["a/x", 2, 1, 505], ["b/y", 0, 1, 0]]);
  expect(s.highlights.map((i) => i.title)).toEqual(["feat: one", "fix: two"]);
  expect(s.activeDays).toBe(3);
  expect(inFilter(items[2] as WorkItem, "B")).toBe(true);
  expect(inFilter(items[2] as WorkItem, "a")).toBe(false);
  expect(inFilter(items[0] as WorkItem, "A/X")).toBe(true);
  expect(periodWords("2026-09-01", "2026-09-30")).toBe("1 September to 30 September 2026");
  expect(periodWords("2025-12-01", "2026-01-31")).toBe("1 December 2025 to 31 January 2026");
});

test("as Markdown: a summary, the notable work by kind, then everything by month, with links", () => {
  const work: Work = { login: "alice", name: "Alice", from: "2026-09-01", to: "2026-09-30", filter: "acme", items: [item("pr", "acme/rocket", "2026-09-02", { number: 7, title: "Add *thrust*" })], scope: "public", shared: null, capped: { prDays: [], repositoryDays: [] }, at: 0 };
  const md = workMarkdown(work, "https://commitscape.example");
  expect(md).toContain("# Proof of Work: Alice (@alice)");
  expect(md).toContain("**1 September to 30 September 2026** · Only in acme");
  expect(md).toContain("2026-09-01 to 2026-09-30, acme: 1 pull request merged (+10 −2 lines), 0 commits, in 1 repository.");
  expect(md).toContain("| Features and improvements | 1 | 100% |");
  expect(md).toContain("1. [#7 Add \\*thrust\\*](https://x/acme/rocket/2026-09-02) in acme/rocket, +10 −2, merged 2026-09-02");
  expect(md).toContain("### Features and improvements (1)");
  expect(md).toContain("## Appendix: everything, by month");
  expect(md).toContain("### September 2026");
  expect(md).toContain("- [#7 Add \\*thrust\\*](https://x/acme/rocket/2026-09-02), merged 2026-09-02, +10 −2");
  expect(md).toContain("https://commitscape.example/u/alice/work");
});
