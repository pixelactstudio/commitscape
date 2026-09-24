// The browser interface on the `ownership` fixture (docs/fixtures.md):
// 21 commits over all of history, by Alice (10, under three addresses the
// mailmap and case join), Bob (6) and Carol (5); `alpha/` has 10 commits.
import { expect, test, type Page } from "@playwright/test";
import { fixture, report, serve, type Served } from "./serve.ts";

let served: Served;
test.beforeAll(async () => {
  served = await serve(fixture("ownership"), "--window", "all");
});
test.afterAll(() => served.stop());

async function open(page: Page, hash = "#/overview") {
  await page.goto(served.url);
  await page.goto(`${served.base}/${hash}`);
  await expect(page.locator(".waiting")).toHaveCount(0);
}

const tile = (page: Page, label: string) => page.locator(".tile", { has: page.getByText(label, { exact: true }) });

test("the overview counts the commits and people, most commits first", async ({ page }) => {
  await open(page);
  await expect(tile(page, "commits").locator("strong")).toHaveText("21");
  await expect(tile(page, "people").locator("strong")).toHaveText("3");
  const who = page.locator(".figure", { has: page.getByRole("heading", { name: "Who writes the code" }) });
  await expect(who.locator(".bars li")).toHaveText([/Alice Example.*10 · 48%/, /Bob Example.*6 · 29%/, /Carol.*5 · 24%/]);
});

test("filtering by a person or a folder narrows every number", async ({ page }) => {
  await open(page);
  // The lists load when the pointer reaches the filters, as a person's would.
  await page.locator(".filters").hover();
  await page.getByLabel("Person").selectOption({ label: "Bob Example" });
  await expect(page.locator(".figure").filter({ hasText: "Commits over time" }).locator(".note").first()).toHaveText(
    "6 commits in all time",
  );
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Folder").fill("alpha/");
  await page.getByLabel("Folder").press("Enter");
  await expect(page.locator(".figure").filter({ hasText: "Commits over time" }).locator(".note").first()).toHaveText(
    "10 commits in all time",
  );
});

test("a person's profile shows the addresses joined into them", async ({ page }) => {
  await open(page, "#/people");
  await page.locator(".people-table").getByRole("button", { name: "Alice Example" }).click();
  await expect(page.getByRole("heading", { name: "Alice Example" })).toBeVisible();
  await expect(page.getByText("alice@work.example.org", { exact: true })).toBeVisible();
});

test("the map opens a folder when it is clicked", async ({ page }) => {
  await open(page, "#/map");
  // A folder's own name strip, above what is drawn inside it.
  await page.locator(".block", { hasText: "alpha/" }).first().click({ position: { x: 8, y: 6 } });
  await expect(page.locator(".crumbs strong")).toHaveText("alpha");
});

test("? shows what each number means, and hides it again", async ({ page }) => {
  await open(page);
  await expect(page.locator(".explain")).toHaveCount(0);
  await page.keyboard.press("?");
  await expect(page.locator(".explain").first()).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.locator(".explain")).toHaveCount(0);
});

test("a theme chosen is kept for next time", async ({ page }) => {
  await open(page);
  await page.getByLabel("Theme").selectOption("midnight");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
});

test("a report opens from a file, with no server, on every screen", async ({ page }) => {
  const path = report(fixture("ownership"), "--window", "all");
  await page.goto(`file://${path}`);
  await expect(tile(page, "commits").locator("strong")).toHaveText("21");
  await page.getByRole("link", { name: /People/ }).click();
  await expect(page.locator(".people-table tbody tr")).toHaveCount(3);
  await page.getByRole("link", { name: /Risk/ }).click();
  await expect(page.getByRole("heading", { name: "Hotspots" })).toBeVisible();
});

test("the card is saved as a PNG", async ({ page }) => {
  await open(page);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save the card" }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("ownership-card-all.png");
  const png = await (await download.createReadStream()).toArray();
  const bytes = Buffer.concat(png);
  // PNG's signature, then its width and height: twice the card's 1,080 by 684.
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([2160, 1368]);
});
