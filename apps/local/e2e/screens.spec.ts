// The browser interface on the `ownership` fixture (docs/fixtures.md):
// 21 commits over all of history, by Alice (10, under three addresses the
// mailmap and case join), Bob (6) and Carol (5); `alpha/` has 10 commits.
import { expect, test, type Page } from "@playwright/test";
import { fixture, report, serve, wrappedPage, type Served } from "./serve.ts";

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
  await page.getByRole("button", { name: "Person" }).click();
  await page.getByRole("option", { name: "Bob Example" }).click();
  await expect(page.locator(".figure").filter({ hasText: "Commits over time" }).locator(".note").first()).toHaveText(
    "6 commits in all time",
  );
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("textbox", { name: "Folder" }).fill("alpha/");
  await page.getByRole("textbox", { name: "Folder" }).press("Enter");
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
  await page.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a report opens from a file, with no server, on every screen", async ({ page }) => {
  const path = report(fixture("ownership"), "--window", "all");
  await page.goto(`file://${path}`);
  await expect(tile(page, "commits").locator("strong")).toHaveText("21");
  await page.getByRole("button", { name: /^People/ }).click();
  await expect(page.locator(".people-table tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: /^Risk/ }).click();
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

test("wrapped is one person's year, from a file", async ({ page }) => {
  // Alice's 2024 in the ownership fixture: 9 commits to alpha/ and the one
  // adding .mailmap, on 10 days in a row from 1 January (a new day each).
  const path = wrappedPage(fixture("ownership"), "--email", "alice@example.com", "--year", "2024");
  await page.goto(`file://${path}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/2024 in code/);
  await expect(tile(page, "commits").locator("strong")).toHaveText("10");
  await expect(tile(page, "days with a commit").locator("strong")).toHaveText("10");
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save the card" }).click();
  expect((await saved).suggestedFilename()).toBe("wrapped-2024.png");
});

test("every screen can be walked with the keyboard alone", async ({ page }) => {
  await open(page);
  const shown = (name: string) => expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
  await page.keyboard.press("2");
  await shown("Commits over time, by person");
  await page.keyboard.press("3");
  await shown("People");
  // Tab to the first name in the table and open it.
  const alice = page.locator(".people-table").getByRole("button", { name: "Alice Example" });
  for (let i = 0; i < 60 && !(await alice.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await shown("Alice Example");
  await page.keyboard.press("4");
  const folder = page.locator(".block", { hasText: "alpha/" }).first();
  for (let i = 0; i < 60 && !(await folder.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(page.locator(".crumbs strong")).toHaveText("alpha");
  await page.keyboard.press("5");
  await shown("Hotspots");
  await page.keyboard.press("6");
  await shown("Commits");
  await page.keyboard.press("1");
  await shown("The story so far");
  // w steps the Window; it started on all time, so the next is 30 days.
  await page.keyboard.press("w");
  await expect(page).toHaveURL(/window=30d/);
});

test("⌘K jumps to a person, and typing in a field is left alone", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Jump to" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("bob");
  await expect(palette.getByRole("option", { name: "Bob Example" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Bob Example" })).toBeVisible();
  // A digit typed in the folder field is text, not a screen.
  await page.getByRole("textbox", { name: "Folder" }).fill("");
  await page.getByRole("textbox", { name: "Folder" }).press("2");
  await expect(page.getByRole("textbox", { name: "Folder" })).toHaveValue("2");
  await expect(page).toHaveURL(/#\/people/);
});

test("? lists every key and marks each on screen", async ({ page }) => {
  await open(page);
  await page.keyboard.press("?");
  const help = page.getByRole("region", { name: "Help" });
  await expect(help).toContainText("Choose a screen");
  await expect(page.locator(".app.keys-on")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("with --offline no avatar is asked for", async ({ page }) => {
  // The server here runs with --offline: every person is a colour swatch.
  const asked: string[] = [];
  page.on("request", (r) => asked.push(r.url()));
  await open(page, "#/people");
  await expect(page.locator(".people-table .swatch")).toHaveCount(3);
  expect(asked.filter((u) => !u.startsWith(served.base))).toEqual([]);
});

test("Commits finds every commit by its message or its author, as you type", async ({ page }) => {
  // The ownership fixture's 21 commits: Carol made 5 ("beta carol …"), Bob
  // 6 (five "beta bob" and one "alpha bob").
  await open(page);
  await page.keyboard.press("6");
  const note = page.locator(".figure", { has: page.getByRole("heading", { name: "Commits", exact: true }) }).locator(".note").first();
  await expect(note).toHaveText("21 of 21 commits, over all time. Newest first.");
  await expect(page.locator(".commit-row").first()).toContainText("beta bob");
  await page.keyboard.press("/");
  await page.keyboard.type("carol");
  await expect(note).toHaveText("5 of 21 commits, over all time. Newest first.");
  await page.getByRole("textbox", { name: "Search commits" }).fill("BOB beta");
  await expect(note).toHaveText("5 of 21 commits, over all time. Newest first.");
  // Locally, an address finds its person's commits too.
  await page.getByRole("textbox", { name: "Search commits" }).fill("alice@work.example.org");
  await expect(note).toHaveText("10 of 21 commits, over all time. Newest first.");
  await expect(page).toHaveURL(/#\/commits\?.*q=alice/);
});

test("a report searches its commits with no server", async ({ page }) => {
  const path = report(fixture("ownership"), "--window", "all");
  await page.goto(`file://${path}#/commits?q=mailmap`);
  await expect(page.locator(".commit-row")).toHaveCount(1);
  await expect(page.locator(".commit-row")).toContainText("add mailmap");
});

test("with --offline there is no Share button", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Save the card" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
});
