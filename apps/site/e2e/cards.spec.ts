import { expect, test } from "@playwright/test";
import { sql } from "./accounts";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/gh/acme/ownership");
  await expect.poll(async () => (await sql("SELECT report_at FROM repositories WHERE id = 'acme/ownership'"))[0]?.report_at ?? null, { timeout: 30_000 }).not.toBeNull();
  await page.goto("/u/alice");
  await expect(page.getByRole("group", { name: "Lines merged", exact: true })).not.toContainText("—", { timeout: 30_000 });
  await page.close();
});

test("a person's Cards are served as animated SVG and still PNG, light and dark, from a stored copy", async ({ request }) => {
  const svg = await request.get("/api/cards/u/alice/totals.svg");
  expect(svg.status()).toBe(200);
  expect(svg.headers()["content-type"]).toBe("image/svg+xml");
  expect(svg.headers()["cache-control"]).toBe("public, max-age=21600");
  const body = await svg.text();
  expect(body).toContain("@keyframes");
  expect(body).not.toContain("<script");
  const again = await request.get("/api/cards/u/alice/totals.svg");
  expect(again.headers()["x-render-ms"]).toBeUndefined();
  const png = await request.get("/api/cards/u/alice/survival.png?theme=dark");
  expect(png.headers()["content-type"]).toBe("image/png");
  expect([...(await png.body()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect((await request.get("/api/cards/u/alice/nothing.svg")).status()).toBe(404);
  expect((await request.get("/api/cards/u/alice/acme/ownership/standing.png")).status()).toBe(200);
  expect((await request.get("/api/cards/gh/acme/ownership/hall-of-fame.svg")).status()).toBe(200);
  expect((await request.get("/api/cards/site/preview.png")).headers()["content-type"]).toBe("image/png");
});

test("the Card studio picks a Card, dresses it, and gives its README Markdown with the style in every address", async ({ page, request }) => {
  await page.goto("/u/alice/cards");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alice Example's Cards");
  await expect(page.getByRole("button", { name: /Totals/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Grape", exact: true }).click();
  await page.getByRole("button", { name: "Accent #f97316" }).click();
  await page.getByRole("button", { name: "Dots", exact: true }).click();
  await page.getByRole("button", { name: /Calendar/ }).click();
  await expect(page).toHaveURL(/card=calendar/);
  await expect(page).toHaveURL(/preset=grape/);
  await expect(page).toHaveURL(/accent=f97316/);
  await expect(page).toHaveURL(/bg=dots/);
  await expect(page.locator("code, pre").filter({ hasText: "prefers-color-scheme: dark" }).first()).toContainText("/api/cards/u/alice/calendar.svg?theme=dark&preset=grape&accent=f97316&bg=dots");
  await page.getByRole("tab", { name: "Post it" }).click();
  await expect(page.getByRole("link", { name: "Share on LinkedIn" })).toHaveAttribute("href", /linkedin\.com\/sharing\/share-offsite\/\?url=.*%2Fu%2Falice/);
  const styled = await request.get("/api/cards/u/alice/totals.svg?preset=grape&accent=f97316&bg=dots");
  expect(styled.status()).toBe(200);
  expect(await styled.text()).toContain("#f97316");
  await page.reload();
  await expect(page.getByRole("button", { name: "Grape", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page).not.toHaveURL(/preset=/);
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Surprise me" }).click();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/(preset|accent|bg|corner)=/);
  await page.getByRole("group", { name: "Preview in" }).getByRole("button", { name: "Light" }).click();
  await expect(page).toHaveURL(/mode=light/);
});

test("Share opens the Card on a stage with the ways to take it out", async ({ page }) => {
  await page.goto("/gh/acme/ownership");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Share", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("hall of fame");
  await expect(dialog.getByRole("img", { name: /The people who built acme\/ownership/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Surprise me" }).click();
  await expect(dialog.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "PNG, dark" })).toHaveAttribute("href", /\/api\/cards\/gh\/acme\/ownership\/hall-of-fame\.png\?theme=dark&/);
  await dialog.getByText("See the Markdown").click();
  await expect(dialog.locator("code, pre").filter({ hasText: "prefers-color-scheme: dark" }).first()).toContainText("/api/cards/gh/acme/ownership/hall-of-fame.svg?theme=dark&");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("every page carries a preview image", async ({ request }) => {
  const bot = { "user-agent": "Twitterbot/1.0" };
  const image = async (path: string) => /<meta property="og:image" content="([^"]+)"/.exec(await (await request.get(path, { headers: bot })).text())?.[1];
  expect(await image("/")).toMatch(/\/api\/cards\/site\/preview\.png$/);
  expect(await image("/u/alice")).toMatch(/\/api\/cards\/u\/alice\/preview\.png$/);
  expect(await image("/u/alice/acme/ownership")).toMatch(/\/api\/cards\/u\/alice\/acme\/ownership\/standing\.png$/);
  expect(await image("/gh/acme/ownership")).toMatch(/\/api\/cards\/gh\/acme\/ownership\/hall-of-fame\.png$/);
  expect(await image("/privacy")).toMatch(/\/api\/cards\/site\/preview\.png$/);
});
