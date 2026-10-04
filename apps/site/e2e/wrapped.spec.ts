import { expect, test } from "@playwright/test";

test("a person's year: its numbers, its calendar, and its Cards", async ({ page, request }) => {
  await page.goto("/u/alice/wrapped/2026");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alice Example's year on GitHub");
  const tile = (label: string) => page.locator(".tile", { has: page.getByText(label, { exact: true }) }).locator("strong");
  await expect(tile("pull requests merged")).toHaveText("3");
  await expect(tile("reviews given")).toHaveText("5");
  await expect(tile("commits")).toHaveText("21");
  await expect(tile("lines added, merged")).toHaveText("+210");
  await expect(page.locator(".months li")).toHaveCount(12);
  for (const card of ["wrapped", "wrapped-calendar"]) {
    const answer = await request.get(`/api/cards/u/alice/wrapped/2026/${card}.png`);
    expect(answer.headers()["content-type"]).toBe("image/png");
  }
  expect((await request.get("/api/cards/u/alice/wrapped/1999/wrapped.png")).status()).toBe(404);
  await page.goto("/u/alice/wrapped/1999");
  await expect(page.getByText("Wrapped covers 2008 to")).toBeVisible();
});
