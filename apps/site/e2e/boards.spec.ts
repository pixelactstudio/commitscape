import { expect, test } from "@playwright/test";
import { sql } from "./accounts";

test("people on the Leaderboards: this Season by merged pull requests and reviews, per repository, and hidden people absent", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gh/acme/ownership");
  await expect(page.locator(".contributors li")).toHaveCount(3, { timeout: 30_000 });
  await sql("UPDATE repositories SET seed = true WHERE id = 'acme/ownership'");
  await expect.poll(async () => Number((await sql("SELECT count(*)::int AS n FROM pull_requests WHERE repo_id = 'acme/ownership'"))[0]?.n), { timeout: 30_000 }).toBe(4);
  await page.goto("/leaderboards");
  const merged = page.locator("#merged");
  await expect(merged.locator("li").first()).toContainText("bob");
  await expect(merged.locator("li").first()).toContainText("2 merged");
  await expect(merged.locator("li .num").first()).toHaveAttribute("title", "2 pull requests merged");
  await expect(page.locator("#reviews li")).toHaveCount(3);
  await page.goto("/leaderboards?repo=acme/ownership&window=all");
  await expect(page.locator("#merged li")).toHaveCount(3);
  await expect(page.locator("#merged").getByRole("link", { name: "bob" })).toHaveAttribute("href", "/u/bob/acme/ownership");
  await sql("INSERT INTO people (login, hidden, name_private, updated_at) VALUES ('bob', true, false, 1) ON CONFLICT (login) DO UPDATE SET hidden = true");
  await page.reload();
  await expect(page.locator(".boards")).not.toContainText("bob");
  await sql("UPDATE people SET hidden = false WHERE login = 'bob'");
});
