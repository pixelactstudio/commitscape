import { expect, test } from "@playwright/test";
import { sql } from "./accounts";

test("people on the Leaderboards: this Season by merged pull requests and reviews, per repository, and hidden people absent", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gh/acme/ownership");
  await expect.poll(async () => (await sql("SELECT report_at FROM repositories WHERE id = 'acme/ownership'"))[0]?.report_at ?? null, { timeout: 30_000 }).not.toBeNull();
  await sql("UPDATE repositories SET seed = true WHERE id = 'acme/ownership'");
  await expect.poll(async () => Number((await sql("SELECT count(*)::int AS n FROM pull_requests WHERE repo_id = 'acme/ownership'"))[0]?.n), { timeout: 30_000 }).toBe(4);
  await page.goto("/leaderboards");
  const merged = page.getByRole("region", { name: "Most pull requests merged" });
  await expect(merged.getByRole("link").first()).toContainText("bob");
  await expect(merged.getByRole("link").first()).toContainText("2");
  await expect(page.getByRole("region", { name: "Most pull requests reviewed" }).getByRole("link")).toHaveCount(3);
  await page.goto("/leaderboards?repo=acme/ownership&window=all");
  await expect(merged.getByRole("link")).toHaveCount(3);
  await expect(merged.getByRole("link", { name: /bob/ })).toHaveAttribute("href", "/u/bob/acme/ownership");
  await sql("INSERT INTO people (login, hidden, name_private, updated_at) VALUES ('bob', true, false, 1) ON CONFLICT (login) DO UPDATE SET hidden = true");
  await page.reload();
  await expect(page.getByRole("main")).not.toContainText("bob");
  await sql("UPDATE people SET hidden = false WHERE login = 'bob'");
});
