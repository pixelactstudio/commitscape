// The Site under `wrangler dev` with the real Builder (e2e/start.ts):
// GitHub's answers come from github.ts, and `acme/ownership`'s remote is
// the `ownership` fixture (21 commits by Alice, Bob and Carol,
// docs/fixtures.md). Tests run in order: the first builds the Report the
// others read.
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { SIGNATURE, sign } from "@commitscape/data";
import { TEST_SECRET } from "./constants.ts";

const commits = (page: import("@playwright/test").Page) => page.locator(".tile", { has: page.getByText("commits", { exact: true }) }).locator("strong");

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

test("the stored Report has every screen, and no email address", async ({ page }) => {
  await page.goto("/gh/acme/ownership");
  await expect(commits(page)).toHaveText("21");
  await page.keyboard.press("3");
  await expect(page.locator(".people-table tbody tr")).toHaveCount(3);
  await page.locator(".people-table").getByRole("button", { name: "Alice Example" }).click();
  await expect(page.getByRole("heading", { name: "Alice Example" })).toBeVisible();
  await expect(page.getByText("alice@example.com")).toHaveCount(0);
  await expect(page.getByText("alice@work.example.org")).toHaveCount(0);
  await page.keyboard.press("6");
  await page.keyboard.press("/");
  await page.keyboard.type("carol");
  await expect(page.locator(".commit-row")).toHaveCount(5);
  // Searching by an address finds nothing on the Site: it keeps none.
  await page.getByRole("textbox", { name: "Search commits" }).fill("alice@work");
  await expect(page.locator(".commit-row")).toHaveCount(0);
});

test("the repository's page carries its social preview, and the card is served", async ({ request }) => {
  const html = await (await request.get("/gh/acme/ownership")).text();
  expect(html).toContain('<meta property="og:title" content="acme/ownership on commitscape">');
  expect(html).toContain("Three people and two folders");
  expect(html).toMatch(/<meta property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/api\/cards\/acme\/ownership">/);
  const card = await request.get("/api/cards/acme/ownership");
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toMatch(/^image\/(png|svg\+xml)$/);
});

test("each way a lookup can fail says so plainly", async ({ page }) => {
  await page.goto("/gh/nobody/nothing");
  await expect(page.getByText("GitHub has no public repository of that name.")).toBeVisible();
  // Signed out, a private repository is not even said to exist
  // (signin.spec.ts has the plain "private" message, for someone who may see it).
  await page.goto("/gh/acme/secret");
  await expect(page.getByText("GitHub has no public repository of that name.")).toBeVisible();
  await page.goto("/gh/acme/huge");
  await expect(page.getByText("This repository is too big for the Site to read.")).toBeVisible({ timeout: 20_000 });
  // The Builder's time limit is 4 s here, and acme/slow never finishes.
  await page.goto("/gh/acme/slow");
  await expect(page.getByText("Reading its history")).toBeVisible();
  await expect(page.getByText("took longer than the Site allows")).toBeVisible({ timeout: 20_000 });
});

test("a Report more than a day old shows while a newer one is built", async ({ page }) => {
  const site = resolve(import.meta.dirname, "..");
  const aged = spawnSync(
    join(site, "node_modules", ".bin", "wrangler"),
    ["d1", "execute", "commitscape", "--local", "--persist-to", join(site, "../../target/site-e2e-state"), "-c", "wrangler.jsonc", "--command", "UPDATE repositories SET report_at = report_at - 2 * 86400 WHERE id = 'acme/ownership'"],
    { cwd: site, encoding: "utf8" },
  );
  expect(aged.status, aged.stderr).toBe(0);
  await page.goto("/gh/acme/ownership");
  await expect(commits(page)).toHaveText("21");
  await expect(page.getByText("updating…")).toBeVisible();
  await expect(page.getByText(/^built /)).toBeVisible({ timeout: 20_000 });
});

test("an address may start 20 Builds an hour", async ({ request }) => {
  // Up to 25 lookups and Builds, each quick, but a busy machine is slower.
  test.setTimeout(120_000);
  const statuses: number[] = [];
  for (let i = 1; i <= 25; i++) {
    const r = await request.post("/api/builds", { data: { owner: "acme", name: `r${i}` } });
    statuses.push(r.status());
    if (r.status() === 429) {
      expect((await r.json()).error).toContain("many Builds this hour");
      break;
    }
  }
  expect(statuses.at(-1)).toBe(429);
  expect(statuses.filter((s) => s === 202).length).toBeLessThanOrEqual(20);
});

test("the API answers in plain words, and only under /api", async ({ request }) => {
  const missing = await request.get("/api/nope");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "No such API." });
  expect((await request.get("/api/repos/a%20b/c")).status()).toBe(400);
  expect((await request.get("/api/reports/nobody/nothing")).status()).toBe(404);
  // Callbacks only from the Builder.
  const forged = await request.post("/api/builds/aaaaaaaaaaaa/done", { data: { ok: true } });
  expect(forged.status()).toBe(401);
  const report = await request.get("/api/reports/acme/ownership");
  expect(report.headers()["content-type"]).toBe("application/gzip");
  const page = await request.get("/some/page");
  expect(page.headers()["content-type"]).toContain("text/html");
});

test("/privacy says what is kept", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What commitscape keeps, and who can read it");
});

// Sharing, from the command to the browser (ADR-0016).
const root = resolve(import.meta.dirname, "../../..");
const site = `http://127.0.0.1:${process.env.SITE_PORT ?? 8790}`;
function share(...args: string[]) {
  const done = spawnSync(join(root, "target/release/commitscape"), ["share", "--cache-dir", join(root, "target/site-e2e-share-cache"), ...args], {
    encoding: "utf8",
    env: { ...process.env, COMMITSCAPE_SITE: site },
  });
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout.trim();
}
function sql(command: string) {
  const s = resolve(import.meta.dirname, "..");
  const done = spawnSync(join(s, "node_modules/.bin/wrangler"), ["d1", "execute", "commitscape", "--local", "--persist-to", join(root, "target/site-e2e-state"), "-c", "wrangler.jsonc", "--json", "--command", command], { cwd: s, encoding: "utf8" });
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout;
}

test("a Shared Report opens from the link commitscape share printed, and its key never leaves the browser", async ({ page }) => {
  const link = share("--yes", "--expires", "2", join(root, "fixtures/ownership"));
  expect(link).toMatch(new RegExp(`^${site}/s/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$`));
  const key = link.split("#")[1] ?? "";
  const seen: string[] = [];
  page.on("request", (r) => seen.push([r.url(), JSON.stringify(r.headers()), r.postData() ?? ""].join("\n")));
  await page.goto(link);
  await expect(commits(page)).toHaveText("21");
  await expect(page.getByText(/shared · expires in (1 h 5\d|2 h 0) min/)).toBeVisible();
  // The key left the address bar before anything was drawn.
  expect(page.url()).not.toContain("#");
  expect(seen.length).toBeGreaterThan(3);
  for (const request of seen) expect(request).not.toContain(key);
  // Nor is it in what the Site stores.
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
  expect(share("--list")).toContain(other);
  expect(share("--delete", other)).toContain("Deleted");
  expect(share("--list")).not.toContain(other);
  expect((await request.get(other.split("#")[0]?.replace("/s/", "/api/shares/") ?? "")).status()).toBe(404);
});

test("an expired Shared Report answers 410, and the Cron Trigger removes it", async ({ page, request }) => {
  const link = share("--yes", "--expires", "1", join(root, "fixtures/ownership"));
  const id = link.split("/s/")[1]?.split("#")[0] ?? "";
  sql(`UPDATE shares SET expires_at = 1 WHERE id = '${id}'`);
  expect((await request.get(`/api/shares/${id}`)).status()).toBe(410);
  await page.goto(link);
  await expect(page.getByText("This Shared Report has expired.")).toBeVisible();
  // Wrangler's local trigger for the Worker's scheduled handler.
  const ran = await request.get("/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*");
  expect(ran.ok()).toBe(true);
  await expect.poll(async () => (await request.get(`/api/shares/${id}`)).status()).toBe(404);
});

test("the local page's Share button uploads, and its link opens here", async ({ page, context }) => {
  const { spawn } = await import("node:child_process");
  const local = spawn(
    join(root, "target/release/commitscape"),
    ["--web", "--port", "0", "--no-cache", "--window", "all", join(root, "fixtures/ownership")],
    { env: { ...process.env, COMMITSCAPE_SITE: site, BROWSER: "" }, stdio: ["ignore", "pipe", "inherit"] },
  );
  try {
    const url = await new Promise<string>((ok, fail) => {
      let text = "";
      local.stdout?.on("data", (d) => {
        text += d;
        const m = text.match(/(http:\/\/\S+)\n/);
        if (m?.[1]) ok(m[1]);
      });
      local.on("exit", () => fail(new Error(text)));
    });
    await page.goto(url);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByText("No email addresses. The Site cannot read it.")).toBeVisible();
    await page.getByRole("button", { name: "Upload" }).click();
    const link = (await page.locator(".share-link").textContent({ timeout: 20_000 })) ?? "";
    expect(link).toMatch(new RegExp(`^${site}/s/`));
    const other = await context.newPage();
    await other.goto(link);
    await expect(commits(other)).toHaveText("21");
  } finally {
    local.kill();
  }
});

test("the Leaderboards: seeds only from the Builder, then boards of repositories from their Builds", async ({ page, request }) => {
  test.setTimeout(90_000);
  // Only the Builder may send seeds or have the boards written.
  expect((await request.post("/api/seeds", { data: { repos: [], budget: 5 } })).status()).toBe(401);
  expect((await request.post("/api/leaderboards/write")).status()).toBe(401);
  // Built an age ago, so tonight's seeds build it again.
  sql("UPDATE repositories SET report_at = 1 WHERE id = 'acme/ownership'");
  const builderPort = Number(process.env.SITE_PORT ?? 8790) + 2;
  const asked = await fetch(`http://127.0.0.1:${builderPort}/seed`, { method: "POST", headers: { [SIGNATURE]: await sign(TEST_SECRET, "POST", "/seed", "") } });
  expect(asked.status).toBe(202);
  await expect
    .poll(async () => ((await (await request.get("/api/leaderboards")).json()) as { from: number }).from, { timeout: 60_000 })
    .toBe(1);
  const row = JSON.parse(sql("SELECT seed, language, stars, bus_factor, maintainers, answered, answer_hours FROM repositories WHERE id = 'acme/ownership'"))[0].results[0];
  // The fixture's commits are years old: no Bus Factor for the last year, no maintainers.
  expect(row).toMatchObject({ seed: 1, language: "Shell", stars: 42, bus_factor: null, maintainers: 0, answered: 12, answer_hours: 3.5 });

  await page.goto("/leaderboards");
  await expect(page.getByRole("heading", { name: "Leaderboards", level: 1 })).toBeVisible();
  await expect(page.getByText(/from 1 of the most starred repositories/)).toBeVisible();
  const answers = page.locator("#answers");
  await expect(answers.getByRole("link", { name: "acme/ownership" })).toHaveAttribute("href", "/gh/acme/ownership");
  await expect(answers.getByText("4 h")).toBeVisible();
  // Repositories only: no board names a person.
  for (const person of ["Alice", "Bob", "Carol"]) await expect(page.locator(".boards").getByText(person)).toHaveCount(0);
});
