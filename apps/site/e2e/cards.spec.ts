import { expect, test } from "@playwright/test";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/gh/acme/ownership");
  await expect(page.locator(".contributors li")).toHaveCount(3, { timeout: 30_000 });
  await page.goto("/u/alice");
  await expect(page.locator(".tile", { has: page.getByText("lines added, merged", { exact: true }) }).locator("strong")).not.toHaveText("—", { timeout: 30_000 });
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

test("the gallery shows each Card in both themes with its README Markdown", async ({ page }) => {
  await page.goto("/u/alice/cards");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alice Example's Cards");
  await expect(page.locator(".card-box")).toHaveCount(8);
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals.locator("img")).toHaveCount(2);
  await expect(totals.locator(".card-markdown")).toContainText('<source media="(prefers-color-scheme: dark)" srcset="');
  await expect(totals.locator(".card-markdown")).toContainText("/api/cards/u/alice/totals.svg?theme=dark");
  await expect(totals.getByRole("link", { name: "Post on LinkedIn" })).toHaveAttribute("href", /linkedin\.com\/sharing\/share-offsite\/\?url=.*%2Fu%2Falice/);
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
