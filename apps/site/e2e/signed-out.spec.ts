import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs, sql } from "./accounts";

const root = resolve(import.meta.dirname, "../../..");
const site = `http://127.0.0.1:${process.env.SITE_PORT ?? 8790}`;
const shots = resolve(import.meta.dirname, "../../../target/preview/site");

test.use({ storageState: { cookies: [], origins: [] } });

test("a page sends someone signed out to sign in, keeping where they were going, and back there once signed in", async ({ page, context }) => {
  await page.goto("/u/alice?day=2026-08-01");
  await expect(page).toHaveURL(`${site}/sign-in?next=%2Fu%2Falice%3Fday%3D2026-08-01`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to commitscape");
  await expect(page.getByText("Sign in with GitHub to open the page you asked for.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search people or repos" })).toHaveCount(0);
  for (const path of ["/dashboard", "/gh/acme/ownership", "/vs/alice/bob", "/me"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/sign-in(\?next=.*)?$/);
  }
  await page.goto("/");
  await expect(page).toHaveURL(`${site}/sign-in`);
  await page.goto("/sign-in?error=access_denied");
  await expect(page.getByText("You cancelled signing in on GitHub")).toBeVisible();
  await signInAs(context, "dana");
  await page.goto("/sign-in?next=%2Fu%2Falice%3Fday%3D2026-08-01");
  await expect(page).toHaveURL(`${site}/u/alice?day=2026-08-01`);
  await page.goto("/");
  await expect(page).toHaveURL(`${site}/dashboard`);
});

test("the API and server functions answer 401 to someone signed out; health and webhooks stay open", async ({ request }) => {
  const api = await request.get("/api/reports/acme/ownership/commits");
  expect(api.status()).toBe(401);
  expect(await api.json()).toEqual({ error: "Sign in with GitHub to use commitscape." });
  expect((await request.get("/api/work/u/alice/proof.md?from=2026-08-01&to=2026-08-31")).status()).toBe(401);
  expect((await request.post("/_serverFn/anything", { data: {} })).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(200);
  expect(await (await request.post("/api/github/webhooks", { data: {} })).json()).toEqual({ error: "Not signed by GitHub." });
});

test("Cards still load for anyone, and one of someone not read yet reads nothing from GitHub", async ({ request }) => {
  const totals = await request.get("/api/cards/u/alice/totals.svg");
  expect(totals.status()).toBe(200);
  expect(totals.headers()["content-type"]).toBe("image/svg+xml");
  expect((await request.get("/api/cards/gh/acme/ownership/hall-of-fame.png")).headers()["content-type"]).toBe("image/png");
  expect((await request.get("/api/cards/u/alice/acme/ownership/standing.png")).status()).toBe(200);
  const pending = await request.get("/api/cards/u/erin/totals.svg");
  expect(pending.status()).toBe(200);
  expect(pending.headers()["cache-control"]).toBe("public, max-age=60");
  expect((await request.get("/api/cards/vs/alice/erin/versus.svg")).headers()["cache-control"]).toBe("public, max-age=60");
  expect((await request.get("/api/cards/gh/acme/r7/hall-of-fame.png")).status()).toBe(404);
  await new Promise((done) => setTimeout(done, 1000));
  expect(await sql("SELECT login FROM profiles WHERE login = 'erin'")).toEqual([]);
  expect(await sql("SELECT id FROM repositories WHERE id = 'acme/r7'")).toEqual([]);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /api/cards/");
});

test("a Shared Report opens for someone signed out", async ({ page }) => {
  const done = spawnSync(join(root, "target/release/commitscape"), ["share", "--yes", "--cache-dir", join(root, "target/site-e2e-share-cache"), join(root, "fixtures/ownership")], {
    encoding: "utf8",
    env: { ...process.env, COMMITSCAPE_SITE: site, COMMITSCAPE_TELEMETRY: "0" },
  });
  expect(done.status).toBe(0);
  const link = done.stdout.trim().split("\n").find((l) => l.startsWith("http")) ?? "";
  await page.goto(link);
  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{22}$/);
  await expect(page.locator('[data-stat="commits"] [data-value]')).toHaveText("21");
});

test("a shared Proof of Work opens for someone signed out, its files too", async ({ browser, page, request }) => {
  const alice = await browser.newContext();
  await signInAs(alice, "alice");
  const mine = await alice.newPage();
  await mine.goto("/u/alice/work?from=2026-08-01&to=2026-08-31");
  await mine.getByRole("button", { name: "Share", exact: true }).click();
  await mine.getByRole("button", { name: /^Create (the|a) link/ }).click();
  const link = await mine.getByRole("textbox", { name: "Link" }).inputValue();
  await alice.close();
  expect(link).toMatch(/\/u\/alice\/work\/[A-Za-z0-9_-]+$/);
  await page.goto(link);
  await expect(page).toHaveURL(link);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alice Example’s Proof of Work");
  const id = link.split("/").at(-1) ?? "";
  const md = await request.get(`/api/work/s/${id}/proof.md`);
  expect(md.status()).toBe(200);
  expect(await md.text()).toContain("Change 3");
});

test("the sign-in page has no serious accessibility problems", async ({ page }) => {
  await page.goto("/sign-in?next=%2Fu%2Falice");
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(serious).toEqual([]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: join(shots, `sign-in-${scheme}.png`), fullPage: true });
  }
});
