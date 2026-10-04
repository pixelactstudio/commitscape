import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

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

test("a Profile draws GitHub's facts, streams its numbers in, and never names private work to someone else", async ({ page }) => {
  const after: string[] = [];
  let loaded = false;
  page.on("request", (r) => {
    if (loaded && r.url().includes("/_serverFn/")) after.push(r.url());
  });
  await page.goto("/u/alice");
  loaded = true;
  await expect(page.getByRole("heading", { level: 1, name: "Alice Example" })).toBeVisible();
  const tile = (label: string) => page.locator(".tile", { has: page.getByText(label, { exact: true }) }).locator("strong");
  await expect(tile("pull requests merged")).toHaveText("3");
  await expect(tile("reviews given")).toHaveText("5");
  await expect(tile("commits")).toHaveText("30");
  await expect(tile("lines added, merged")).toHaveText("+210");
  await expect(tile("to merge, typically")).toHaveText("3 h");
  await expect(page.locator(".repo-list:not(.engine-list) .repo-row-name")).toHaveText(["acme/ownership", "alice/dots"]);
  await expect(page.getByText("Also 7 private contributions, counted in the totals and never named.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("private-thing");
  await expect(page.locator(".partners li").first()).toContainText("bob");
  await page.waitForLoadState("networkidle");
  const shift = await layoutShift(page);
  test.info().annotations.push({ type: "cls", description: `/u/alice ${shift.toFixed(4)}` });
  expect(shift).toBeLessThan(0.05);
  expect(after).toEqual([]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(shots, `phase33-profile-alice-${scheme}.png`), fullPage: true });
  }
});

test("a link preview gets the whole Profile in the page, with its title", async ({ request }) => {
  const html = await (await request.get("/u/alice", { headers: { "user-agent": "Twitterbot/1.0" } })).text();
  expect(html).toContain('<meta property="og:title" content="Alice Example (@alice) on commitscape"/>');
  expect(html).toContain("pull requests merged");
});

test("an unknown name, an organization, and a name that cannot be a login each say so", async ({ page }) => {
  await page.goto("/u/nobody-at-all");
  await expect(page.getByText("GitHub has no person by that name.")).toBeVisible();
  await page.goto("/u/acme");
  await expect(page.getByText("This is an organization, not a person.")).toBeVisible();
  await page.goto("/u/-bad-");
  await expect(page.getByText("That is not a GitHub username.")).toBeVisible();
});

test("the landing page's box takes a person or a repository", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What you've built, in numbers worth sharing.");
  const box = page.getByRole("textbox", { name: "A GitHub username or repository" });
  await box.fill("@alice");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/u\/alice$/);
  await page.goto("/");
  await box.fill("https://github.com/acme/ownership");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/gh\/acme\/ownership$/);
  await page.goto("/");
  await box.fill("not a thing at all");
  await box.press("Enter");
  await expect(page.getByText("Type a GitHub username, like gaearon").first()).toBeVisible();
});

test("the engine's numbers stream into the Profile once the repository is read: Lines Changed, and Surviving Lines counted on request", async ({ page }) => {
  await page.goto("/gh/acme/ownership");
  await expect(page.locator(".contributors li")).toHaveCount(3, { timeout: 30_000 });
  await page.goto("/u/alice");
  const row = page.locator(".engine-row", { has: page.getByRole("link", { name: "acme/ownership" }) });
  await expect(row).toBeVisible();
  await expect(row.locator(".num").nth(0)).toHaveText("10");
  await expect(page.locator(".tile", { has: page.getByText("lines that still run", { exact: true }) }).locator("strong")).not.toHaveText("counting…", { timeout: 30_000 });
  await expect(row.locator(".num").nth(2)).toHaveText(/^\d+$/);
});

test("you in this repository: your numbers, your place in each view, and everyone's Standings", async ({ page }) => {
  await page.goto("/u/alice/acme/ownership");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alice Example in acme/ownership");
  const tile = (label: string) => page.locator(".tile", { has: page.getByText(label, { exact: true }) });
  await expect(tile("commits").locator("strong")).toHaveText("10");
  await expect(tile("commits")).toContainText("1st of 3");
  await expect(page.locator(".standings tbody tr")).toHaveCount(3);
  await expect(page.locator(".standings .standing-you")).toContainText("Alice Example");
  await page.getByRole("button", { name: "Commits", exact: true }).click();
  await expect(page.locator(".standings tbody tr").first()).toContainText("Alice Example");
  await page.goto("/u/alice/acme/never-read");
  await expect(page.getByText("No Standings here")).toBeVisible();
});

test("a Profile shows its Archetype with the rule behind it, and every Achievement with what reaches it", async ({ page, request }) => {
  await page.goto("/u/alice");
  const archetype = page.getByRole("region", { name: "Archetype" }).or(page.locator(".figure", { has: page.getByRole("heading", { name: "Archetype" }) }));
  await expect(archetype.locator(".archetype-title")).toBeVisible();
  await archetype.getByText("Every rule, in the order they are tried").click();
  await expect(archetype.locator(".rules dt")).toHaveText(["Reviewer", "Janitor", "Firefighter", "Night Owl", "Polyglot", "Weekend Warrior", "Marathoner", "Builder"]);
  await expect(page.locator(".achievement")).toHaveCount(10);
  await expect(page.getByText("A pull request of theirs merged into a repository with 10,000 stars or more, as it has now.")).toBeVisible();
  const card = await request.get("/api/cards/u/alice/archetype.svg");
  expect(card.status()).toBe(200);
  expect((await request.get("/api/cards/u/alice/achievement-star-10k.svg")).status()).toBe(404);
});
