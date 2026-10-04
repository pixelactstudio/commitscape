import { expect, test } from "@playwright/test";

test("a Proof of Work for a period: merged pull requests and commits by repository, public work only, as a link, Markdown and PDF", async ({ page, request }) => {
  await page.goto("/u/alice/work?from=2026-08-01&to=2026-08-31");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alice Example's Proof of Work");
  await expect(page.getByText("1 pull request merged (+120 −20 lines), 1 commit, in 1 repository.")).toBeVisible();
  await expect(page.locator(".work-repo-name")).toHaveText(["acme/ownership"]);
  await expect(page.getByRole("link", { name: "Change 3" })).toHaveAttribute("href", "https://github.com/acme/ownership/pull/3");
  await expect(page.locator("body")).not.toContainText("private-thing");
  await expect(page.locator("body")).not.toContainText("Quiet fix");
  const md = await request.get("/api/work/u/alice/proof.md?from=2026-08-01&to=2026-08-31");
  expect(md.headers()["content-type"]).toBe("text/markdown; charset=utf-8");
  const text = await md.text();
  expect(text).toContain("## August 2026");
  expect(text).toContain("- [#3 Change 3](https://github.com/acme/ownership/pull/3), merged 2026-08-01, +120 −20");
  expect(text).not.toContain("private-thing");
  const pdf = await request.get("/api/work/u/alice/proof.pdf?from=2026-08-01&to=2026-08-31");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await request.get("/api/work/u/alice/proof.md?from=2026-08-31&to=2026-08-01")).status()).toBe(400);
  await page.getByRole("button", { name: "Copy the link" }).isVisible();
});

test("choosing a period goes to its dates", async ({ page }) => {
  await page.goto("/u/alice/work?from=2026-08-01&to=2026-08-31");
  await page.getByLabel("From", { exact: true }).fill("2026-03-01");
  await page.getByLabel("To", { exact: true }).fill("2026-03-31");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(/from=2026-03-01&to=2026-03-31/);
  await expect(page.getByRole("link", { name: "Change 1" })).toBeVisible();
});
