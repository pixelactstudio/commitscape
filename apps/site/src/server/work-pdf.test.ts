import { expect, test } from "vitest";
import type { Work, WorkItem } from "@commitscape/data";
import { workPdf } from "./work-pdf";

const item = (n: number, title: string): WorkItem => ({ kind: n % 3 === 0 ? "commit" : "pr", repo: `acme/repo-${n % 4}`, private: false, title, url: `https://github.com/acme/repo-${n % 4}/pull/${n}`, at: `2026-09-${String((n % 28) + 1).padStart(2, "0")}T10:00:00Z`, number: n, sha: "abcdef1234", additions: n * 10, deletions: n });
const work = (items: WorkItem[]): Work => ({ login: "alice", name: "Alice", from: "2026-09-01", to: "2026-09-30", filter: null, items, scope: "public", shared: null, capped: { prDays: [], repositoryDays: [] }, at: 1_790_000_000 });
const pages = (pdf: Uint8Array) => (Buffer.from(pdf).toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

test("a summary page, the work by kind, then the appendix, numbered", async () => {
  const titles = ["feat: thrust", "fix: fins", "docs: manual", "refactor: engine", "chore: bump", "Something"];
  const pdf = await workPdf(work(Array.from({ length: 120 }, (_, i) => item(i + 1, `${titles[i % titles.length]} ${i}`))), "https://commitscape.example");
  expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  expect(pages(pdf)).toBeGreaterThanOrEqual(4);
});

test("an empty period is one page that says so", async () => {
  expect(pages(await workPdf(work([]), "https://commitscape.example"))).toBe(1);
});
