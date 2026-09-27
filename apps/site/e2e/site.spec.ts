import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const root = resolve(import.meta.dirname, "../../..");
const site = `http://127.0.0.1:${process.env.SITE_PORT ?? 8790}`;
const setup = JSON.parse(readFileSync(join(root, "target", "site-e2e-env.json"), "utf8")) as {
  builderScript: string;
  builderEnv: Record<string, string>;
  databaseUrl: string;
};

async function press(page: Page, key: string, url: RegExp) {
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(page).toHaveURL(url, { timeout: 500 });
  }).toPass();
}

const commits = (page: Page) => page.locator(".tile", { has: page.getByText("commits", { exact: true }) }).locator("strong");

async function sql(text: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client(setup.databaseUrl);
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
}

function builder(command: string): string {
  const done = spawnSync(process.execPath, [setup.builderScript, command], { encoding: "utf8", env: { ...process.env, ...setup.builderEnv } });
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout;
}

function share(...args: string[]) {
  const done = spawnSync(join(root, "target/release/commitscape"), ["share", "--cache-dir", join(root, "target/site-e2e-share-cache"), ...args], {
    encoding: "utf8",
    env: { ...process.env, COMMITSCAPE_SITE: site },
  });
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout.trim().split("\n").find((l) => l.startsWith("http")) ?? done.stdout.trim();
}

test("a pasted link shows GitHub's facts at once, then the Report once it is built", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Any repository's story, in a second.");
  const box = page.getByRole("textbox", { name: "A GitHub repository" });
  await box.fill("not a link");
  await box.press("Enter");
  await expect(page.getByText("Paste a GitHub link, or owner/name, like BurntSushi/ripgrep.").first()).toBeVisible();
  await box.fill("https://github.com/acme/ownership/tree/main");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/gh\/acme\/ownership$/);
  await expect(page.getByText("Three people and two folders")).toBeVisible();
  await expect(commits(page)).toHaveText("21", { timeout: 20_000 });
  await expect(page.getByText(/^built /)).toBeVisible();
});

test("each screen is drawn on the server from its address, with no email address", async ({ page, request }) => {
  const html = await (await request.get("/gh/acme/ownership?screen=people")).text();
  expect(html).toContain("Alice Example");
  expect(html).not.toContain("alice@example.com");
  await page.goto("/gh/acme/ownership");
  await expect(commits(page)).toHaveText("21");
  await press(page, "3", /screen=people/);
  await expect(page.locator(".people-table tbody tr")).toHaveCount(3);
  await page.locator(".people-table").getByRole("button", { name: "Alice Example" }).click();
  await expect(page.getByRole("heading", { name: "Alice Example" })).toBeVisible();
  await expect(page.getByText("alice@example.com")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Alice Example" })).toBeVisible();
  await press(page, "6", /screen=commits/);
  await expect(page.getByRole("textbox", { name: "Search commits" })).toBeVisible();
  await page.keyboard.press("/");
  await page.keyboard.type("carol");
  await expect(page.locator(".commit-row")).toHaveCount(5);
  await page.getByRole("textbox", { name: "Search commits" }).fill("alice@work");
  await expect(page.locator(".commit-row")).toHaveCount(0);
});

test("the repository's page carries its social preview, and the card is served", async ({ request }) => {
  const html = await (await request.get("/gh/acme/ownership")).text();
  expect(html).toContain('<meta property="og:title" content="acme/ownership on commitscape"/>');
  expect(html).toContain("Three people and two folders");
  expect(html).toMatch(/<meta property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/api\/cards\/acme\/ownership"\/>/);
  const card = await request.get("/api/cards/acme/ownership");
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toMatch(/^image\/(png|svg\+xml)$/);
});

test("each way a lookup can fail says so plainly", async ({ page }) => {
  await page.goto("/gh/nobody/nothing");
  await expect(page.getByText("GitHub has no public repository of that name.")).toBeVisible();
  await page.goto("/gh/acme/secret");
  await expect(page.getByText("GitHub has no public repository of that name.")).toBeVisible();
  await page.goto("/gh/acme/huge");
  await expect(page.getByText("This repository is too big for the Site to read.")).toBeVisible({ timeout: 20_000 });
  await page.goto("/gh/acme/slow");
  await expect(page.getByText("Reading its history")).toBeVisible();
  await expect(page.getByText("took longer than the Site allows")).toBeVisible({ timeout: 20_000 });
});

test("a Report more than a day old shows while a newer one is built", async ({ page }) => {
  await sql("UPDATE repositories SET report_at = report_at - 2 * 86400 WHERE id = 'acme/ownership'");
  await page.goto("/gh/acme/ownership");
  await expect(commits(page)).toHaveText("21");
  await expect(page.getByText("updating…")).toBeVisible();
  await expect(page.getByText(/^built /)).toBeVisible({ timeout: 20_000 });
});

test("the API answers in plain words", async ({ request }) => {
  const missing = await request.get("/api/nope");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "No such API." });
  expect((await request.get("/api/reports/nobody/nothing/commits")).status()).toBe(404);
  const list = await request.get("/api/reports/acme/ownership/commits");
  expect(list.status()).toBe(200);
  expect((await list.json()).subjects).toHaveLength(21);
  expect((await request.get("/api/health")).status()).toBe(200);
});

test("/privacy says what is kept", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What commitscape keeps, and who can read it");
});

test("an AI agent reads a Report through MCP", async ({ request }) => {
  const call = (id: number, method: string, params: unknown) =>
    request.post("/mcp", { data: { jsonrpc: "2.0", id, method, params }, headers: { accept: "application/json, text/event-stream" } });
  const hello = await (await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } })).json();
  expect(hello.result.serverInfo.name).toBe("commitscape");
  const answer = await (await call(2, "tools/call", { name: "read_report", arguments: { owner: "acme", repo: "ownership", screen: "overview", window: "all" } })).json();
  expect(JSON.parse(answer.result.content[0].text).totals.commits).toBe(21);
});

test("a Shared Report opens from the link commitscape share printed, and its key never leaves the browser", async ({ page }) => {
  const link = share("--yes", "--expires", "2", join(root, "fixtures/ownership"));
  expect(link).toMatch(new RegExp(`^${site}/s/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$`));
  const key = link.split("#")[1] ?? "";
  const seen: string[] = [];
  page.on("request", (r) => seen.push([r.url(), JSON.stringify(r.headers()), r.postData() ?? ""].join("\n")));
  await page.goto(link);
  await expect(commits(page)).toHaveText("21");
  await expect(page.getByText(/shared · expires in (1 h 5\d|2 h 0) min/)).toBeVisible();
  expect(page.url()).not.toContain("#");
  expect(seen.length).toBeGreaterThan(3);
  for (const request of seen) expect(request).not.toContain(key);
  const stored = await page.request.get(link.split("#")[0]?.replace("/s/", "/api/shares/") ?? "");
  expect(Buffer.from(await stored.body()).toString("latin1")).not.toContain(key);
});

test("a changed byte, a wrong key or a cut link does not open", async ({ page }) => {
  const link = share("--yes", join(root, "fixtures/ownership"));
  const [base] = link.split("#");
  await page.route("**/api/shares/*", async (route) => {
    const answer = await route.fetch();
    const body = Buffer.from(await answer.body());
    body[40] = (body[40] ?? 0) ^ 1;
    await route.fulfill({ response: answer, body });
  });
  await page.goto(link);
  await expect(page.getByText("could not be unlocked")).toBeVisible();
  await page.unroute("**/api/shares/*");
  await page.goto("about:blank");
  await page.goto(`${base}#${"A".repeat(43)}`);
  await expect(page.getByText("could not be unlocked")).toBeVisible();
  await page.goto("about:blank");
  await page.goto(`${base}#short`);
  await expect(page.getByText("This link has lost its key")).toBeVisible();
});

test("the page's Delete button, and share --delete, take a Shared Report down", async ({ page, request }) => {
  const link = share("--yes", join(root, "fixtures/ownership"));
  await page.goto(link);
  await expect(commits(page)).toHaveText("21");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted: this link no longer opens anything.")).toBeVisible();
  expect((await request.get(link.split("#")[0]?.replace("/s/", "/api/shares/") ?? "")).status()).toBe(404);

  const other = share("--yes", join(root, "fixtures/ownership"));
  expect(share("--list")).toContain(other.split("#")[0]);
  expect(share("--delete", other)).toContain("Deleted");
  expect((await request.get(other.split("#")[0]?.replace("/s/", "/api/shares/") ?? "")).status()).toBe(404);
});

test("an expired Shared Report answers 410, and the cleanup removes it", async ({ page, request }) => {
  const link = share("--yes", "--expires", "1", join(root, "fixtures/ownership"));
  const id = link.split("/s/")[1]?.split("#")[0] ?? "";
  await sql(`UPDATE shares SET expires_at = 1 WHERE id = '${id}'`);
  expect((await request.get(`/api/shares/${id}`)).status()).toBe(410);
  await page.goto(link);
  await expect(page.getByText("This Shared Report has expired.")).toBeVisible();
  expect(builder("cleanup")).toContain('"shared":1');
  expect((await request.get(`/api/shares/${id}`)).status()).toBe(404);
});

test("the Leaderboards rank repositories from the night's seed Builds", async ({ page }) => {
  test.setTimeout(90_000);
  await sql("UPDATE repositories SET report_at = 1 WHERE id = 'acme/ownership'");
  expect(builder("seed")).toContain("1 queued");
  await expect
    .poll(async () => (await sql("SELECT seed, answered, report_at FROM repositories WHERE id = 'acme/ownership'"))[0], { timeout: 60_000 })
    .toMatchObject({ seed: true, answered: 12 });
  await page.goto("/leaderboards");
  await expect(page.getByRole("heading", { name: "Leaderboards", level: 1 })).toBeVisible();
  await expect(page.getByText(/from 1 of the most starred repositories/)).toBeVisible();
  const answers = page.locator("#answers");
  await expect(answers.getByRole("link", { name: "acme/ownership" })).toHaveAttribute("href", "/gh/acme/ownership");
  await expect(answers.getByText("4 h")).toBeVisible();
  for (const person of ["Alice", "Bob", "Carol"]) await expect(page.locator(".boards").getByText(person)).toHaveCount(0);
});

const PAGES = ["/", "/leaderboards", "/privacy", "/me", "/gh/acme/ownership", "/gh/acme/ownership?screen=people", "/gh/acme/ownership?screen=risk", "/gh/nobody/nothing"];

for (const path of PAGES) {
  test(`${path} has no serious accessibility problems`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(" ")}`);
    expect(serious).toEqual([]);
  });
}
