import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const shots = resolve(import.meta.dirname, "../../../target/preview/site");
mkdirSync(shots, { recursive: true });

const PAGES: [string, string][] = [
  ["landing", "/"],
  ["leaderboards", "/leaderboards"],
  ["privacy", "/privacy"],
  ["settings", "/me"],
  ["profile", "/u/alice"],
  ["standing", "/u/alice/acme/ownership"],
  ["cards", "/u/alice/cards"],
  ["work", "/u/alice/work?from=2026-08-01&to=2026-08-31"],
  ["versus", "/vs/alice/bob"],
  ["repository", "/gh/acme/ownership"],
  ["repository-people", "/gh/acme/ownership?screen=people"],
  ["repository-activity", "/gh/acme/ownership?screen=activity"],
  ["repository-map", "/gh/acme/ownership?screen=map"],
  ["repository-commits", "/gh/acme/ownership?screen=commits"],
  ["not-found", "/gh/nobody/nothing"],
];

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

test.beforeAll(async ({ browser, request }) => {
  const page = await browser.newPage();
  await page.goto("/gh/acme/ownership");
  await expect.poll(async () => (await request.get("/gh/acme/ownership")).text(), { timeout: 30_000 }).toContain("Alice Example");
  await page.goto("/u/alice");
  await expect(page.locator(".engine-row:not(.repo-head-row)")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText("counting…")).toHaveCount(0, { timeout: 30_000 });
  await page.close();
});

for (const [name, path] of PAGES) {
  test(`${path} draws on the server, moves less than 0.05, and asks nothing again after hydration`, async ({ page }) => {
    const after: string[] = [];
    let loaded = false;
    page.on("request", (r) => {
      if (loaded && r.url().includes("/_serverFn/")) after.push(r.url());
    });
    await page.goto(path, { waitUntil: "load" });
    loaded = true;
    await page.waitForLoadState("networkidle");
    const shift = await layoutShift(page);
    test.info().annotations.push({ type: "cls", description: `${path} ${shift.toFixed(4)}` });
    expect(shift).toBeLessThan(0.05);
    expect(after).toEqual([]);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
    await expect(page.locator("header svg.logo, nav svg.logo").first()).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: join(shots, `phase32-${name}-${scheme}.png`), fullPage: true });
    }
  });
}

test("the theme chosen is drawn by the server, so the page never flashes the other one", async ({ page, request }) => {
  const html = await (await request.get("/privacy", { headers: { cookie: "commitscape-theme=dark" } })).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  expect(html).toContain("@layer astryx-theme");
  await page.context().addCookies([{ name: "commitscape-theme", value: "dark", url: `http://127.0.0.1:${process.env.SITE_PORT ?? 8790}/` }]);
  const styles: string[] = [];
  page.on("console", (m) => styles.push(m.text()));
  await page.goto("/privacy");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator("style[data-astryx-theme]").count()).toBe(0);
  expect(styles.join("\n")).not.toContain("runtime style injection");
});

test("the repository page has avatars, one chart, and none of the panels the Site dropped", async ({ page }) => {
  await page.goto("/gh/acme/ownership");
  for (const gone of ["The story so far", "Did you know?", "Worth a look", "Risk"]) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  await expect(page.locator(".cols")).toHaveCount(1);
  await expect(page.locator(".contributors li")).toHaveCount(3);
  await expect(page.locator(".contributors .astryx-avatar, .contributors [class*=avatar]").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Carol");
  await expect(page.getByRole("option", { name: "Carol", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /Commits that mention/ })).toBeVisible();
});
