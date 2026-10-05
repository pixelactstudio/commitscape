import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { sql } from "./accounts";

const shots = resolve(import.meta.dirname, "../../../target/preview/site");

async function layoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((done) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) total += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => done(total), 500);
      }),
  );
}

async function built(page: Page, repo: string) {
  await page.goto(`/gh/${repo}`);
  await expect.poll(async () => (await sql("SELECT report_at FROM repositories WHERE id = $1", [repo]))[0]?.report_at ?? null, { timeout: 30_000 }).not.toBeNull();
}

const stat = (page: Page, label: string) => page.getByRole("group", { name: label, exact: true });

test("a Profile draws GitHub's facts, streams its numbers in, and never names private work to someone else", async ({ page }) => {
  const after: string[] = [];
  let loaded = false;
  page.on("request", (r) => {
    if (loaded && r.url().includes("/_serverFn/")) after.push(r.url());
  });
  await page.goto("/u/alice");
  loaded = true;
  await expect(page.getByRole("heading", { level: 1, name: "Alice Example" })).toBeVisible();
  await expect(stat(page, "Pull requests merged")).toContainText("3");
  await expect(stat(page, "Reviews given")).toContainText("5");
  await expect(stat(page, "Commits")).toContainText("30");
  await expect(stat(page, "Lines merged")).toContainText("+210");
  await expect(stat(page, "Time to merge")).toContainText("3 h");
  const work = page.getByRole("region", { name: "Where their work is" });
  await expect(work.getByRole("table").getByRole("link")).toHaveText([/acme\/ownership/, /alice\/dots/]);
  await expect(page.getByText("7 private contributions counted in the totals, never named")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("private-thing");
  await expect(page.getByRole("region", { name: "The people they work with most" })).toContainText("bob");
  await page.waitForLoadState("networkidle");
  const shift = await layoutShift(page);
  test.info().annotations.push({ type: "cls", description: `/u/alice ${shift.toFixed(4)}` });
  expect(shift).toBeLessThan(0.05);
  expect(after).toEqual([]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(shots, `profile-alice-${scheme}.png`), fullPage: true });
  }
});

test("a link preview gets the whole Profile in the page, with its title", async ({ request }) => {
  const html = await (await request.get("/u/alice", { headers: { "user-agent": "Twitterbot/1.0" } })).text();
  expect(html).toContain('<meta property="og:title" content="Alice Example (@alice) on commitscape"/>');
  expect(html).toContain("pull requests merged");
});

test("an unknown name, an organization, and a name that cannot be a login each say so", async ({ page }) => {
  await page.goto("/u/nobody-at-all");
  await expect(page.getByText("GitHub has no person by that name. Check its spelling, or search for them.")).toBeVisible();
  await page.goto("/u/acme");
  await expect(page.getByText("This is an organization, not a person.")).toBeVisible();
  await page.goto("/u/-bad-");
  await expect(page.getByText("That is not a GitHub username.")).toBeVisible();
});

test("the landing page's box takes a person or a repository", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What you've built, in numbers worth sharing.");
  const box = page.getByRole("combobox", { name: "A GitHub username or repository" }).first();
  await box.fill("@alice");
  await page.getByRole("button", { name: "Show me", exact: true }).click();
  await expect(page).toHaveURL(/\/u\/alice$/);
  await page.goto("/");
  await box.fill("https://github.com/acme/ownership");
  await page.getByRole("button", { name: "Show me", exact: true }).click();
  await expect(page).toHaveURL(/\/gh\/acme\/ownership$/);
  await page.goto("/");
  await box.fill("not a thing at all");
  await page.getByRole("button", { name: "Show me", exact: true }).click();
  await expect(page.getByText("Type a GitHub username, like gaearon").first()).toBeVisible();
});

test("the engine's numbers stream into the Profile once the repository is read: Lines Changed, and Surviving Lines counted on request", async ({ page }) => {
  await built(page, "acme/ownership");
  await page.goto("/u/alice");
  await expect(page.getByRole("region", { name: "Where their work is" }).getByRole("row", { name: /acme\/ownership/ })).toBeVisible();
  const survived = page.getByRole("region", { name: "Code that survived" });
  await expect(survived).toContainText("acme/ownership");
  await expect(survived).toContainText("10 commits");
  await expect(stat(page, "Lines that still run")).not.toContainText("Counting", { timeout: 30_000 });
});

test("you in this repository: your place in each view, who is next, and everyone's Standings", async ({ page }) => {
  await page.goto("/u/alice/acme/ownership");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("acme/ownership");
  await expect(page.getByText("Alice Example", { exact: true }).first()).toBeVisible();
  const board = page.getByRole("region", { name: "Leaderboard" });
  await page.getByRole("radio", { name: "Commits", exact: true }).click();
  await expect(board.getByRole("listitem")).toHaveCount(3);
  await expect(board.getByRole("listitem").first()).toContainText("Alice Example");
  await expect(board.getByRole("listitem").first()).toHaveAttribute("aria-current", "true");
  await page.goto("/u/alice/acme/never-read");
  await expect(page.getByText("GitHub shows no repository called acme/never-read")).toBeVisible();
  await expect(page.getByRole("link", { name: "Alice Example's profile" })).toHaveAttribute("href", "/u/alice");
});

test("a Profile shows its Archetype with the rule behind it, and every Achievement with what reaches it", async ({ page, request }) => {
  await page.goto("/u/alice");
  const archetype = page.getByRole("region", { name: "Archetype" });
  await archetype.getByRole("button", { name: "Every Archetype rule" }).click();
  const rules = page.getByRole("dialog");
  await expect(rules.locator("dt")).toHaveText([/Reviewer/, /Janitor/, /Firefighter/, /Night Owl/, /Polyglot/, /Weekend Warrior/, /Marathoner/, /Builder/]);
  await expect(rules).toContainText("reviews given");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Achievements" }).getByRole("listitem")).toHaveCount(10);
  await expect(page.getByText("A pull request of theirs merged into a repository with 10,000 stars or more, as it has now.")).toBeVisible();
  const card = await request.get("/api/cards/u/alice/archetype.svg");
  expect(card.status()).toBe(200);
  expect((await request.get("/api/cards/u/alice/achievement-star-10k.svg")).status()).toBe(404);
});
