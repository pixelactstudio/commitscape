import { expect, test } from "@playwright/test";

test("a person's year: its numbers, its calendar, and its Cards", async ({ page, request }) => {
  await page.goto("/u/alice/wrapped/2026");
  await expect(page.getByText("@alice's year on GitHub")).toBeVisible();
  const stat = (label: string) => page.getByRole("group", { name: label, exact: true });
  await expect(stat("Pull requests merged")).toContainText("3");
  await expect(stat("Reviews given")).toContainText("5");
  await expect(stat("Commits")).toContainText("21");
  await expect(stat("Lines added, merged")).toContainText("+210");
  await expect(page.getByRole("region", { name: "The year, a square a day" })).toBeVisible();
  for (const card of ["wrapped", "wrapped-calendar"]) {
    const answer = await request.get(`/api/cards/u/alice/wrapped/2026/${card}.png`);
    expect(answer.headers()["content-type"]).toBe("image/png");
  }
  expect((await request.get("/api/cards/u/alice/wrapped/1999/wrapped.png")).status()).toBe(404);
  await page.goto("/u/alice/wrapped/1999");
  await expect(page.getByText("Wrapped covers the years from 2008 to")).toBeVisible();
});
