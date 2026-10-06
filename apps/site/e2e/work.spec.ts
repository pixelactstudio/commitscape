import { expect, test } from "@playwright/test";

test("a Proof of Work for a period: merged pull requests and commits by repository, the kinds of work, public work only, as a link, Markdown and PDF", async ({ page, request }) => {
  await page.goto("/u/alice/work?from=2026-08-01&to=2026-08-31");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alice Example's Proof of Work");
  const work = page.getByRole("article", { name: "Alice Example's Proof of Work" });
  await expect(page.getByRole("button", { name: /^Period: .*1–31 Aug 2026$/ })).toBeVisible();
  await expect(work.getByRole("region", { name: "Kind of work" })).toBeVisible();
  await expect(work).toContainText("+120 / −20");
  await expect(work.getByRole("heading", { level: 3 })).toHaveText(["acme/ownership"]);
  await expect(page.getByRole("link", { name: "Change 3" })).toHaveAttribute("href", "https://github.com/acme/ownership/pull/3");
  await expect(page.locator("body")).not.toContainText("private-thing");
  await expect(page.locator("body")).not.toContainText("Quiet fix");
  const md = await request.get("/api/work/u/alice/proof.md?from=2026-08-01&to=2026-08-31");
  expect(md.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  const text = await md.text();
  expect(text).toContain("## Kind of work");
  expect(text).toContain("## Appendix: everything, by month");
  expect(text).toContain("### August 2026");
  expect(text).toContain("- [#3 Change 3](https://github.com/acme/ownership/pull/3), merged 2026-08-01, +120 −20");
  expect(text).not.toContain("private-thing");
  const pdf = await request.get("/api/work/u/alice/proof.pdf?from=2026-08-01&to=2026-08-31");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await request.get("/api/work/u/alice/proof.md?from=2026-08-31&to=2026-08-01")).status()).toBe(400);
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Markdown" })).toHaveAttribute("href", "/api/work/u/alice/proof.md?from=2026-08-01&to=2026-08-31");
});

test("one switcher chooses the period, and a dropdown of the repositories in the work narrows it", async ({ page }) => {
  await page.goto("/u/alice/work?from=2026-08-01&to=2026-08-31");
  await page.getByRole("button", { name: /^Period: / }).click();
  await page.getByRole("button", { name: /^This year/ }).click();
  await expect(page).toHaveURL(new RegExp(`from=${new Date().getUTCFullYear()}-01-01`));
  await expect(page.getByRole("link", { name: "Change 1" })).toBeVisible();
  await page.getByRole("button", { name: /^Period: / }).click();
  await page.getByRole("button", { name: /^Custom/ }).click();
  await expect(page.getByRole("button", { name: "Show these days" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("button", { hasText: "Every repository" }).click();
  await page.getByRole("option", { name: /acme\/ownership/ }).click();
  await expect(page).toHaveURL(/filter=acme%2Fownership/);
  const repositories = page.getByRole("article").getByRole("heading", { level: 3 });
  await expect(repositories.first()).toHaveText("acme/ownership");
  await expect(repositories.filter({ hasNotText: "acme/ownership" })).toHaveCount(0);
});
