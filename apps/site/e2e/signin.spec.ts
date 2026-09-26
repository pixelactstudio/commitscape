// Signing in with GitHub and Connected Repositories (ADR-0017), under
// `wrangler dev` with the stand-in GitHub (github.ts): Alice has
// commitscape's App on acme/private-thing (the `coupling` fixture's history)
// and may see it; Bob may not. Tests run in order.
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { join, resolve } from "node:path";
import { expect, test, type Page, type Browser } from "@playwright/test";
import { TEST_WEBHOOK_SECRET } from "./constants.ts";

const githubPort = Number(process.env.SITE_PORT ?? 8790) + 1;
const fakeGitHub = (path: string) => fetch(`http://127.0.0.1:${githubPort}${path}`);
const site = resolve(import.meta.dirname, "..");
function sql(command: string): string {
  const done = spawnSync(
    join(site, "node_modules/.bin/wrangler"),
    ["d1", "execute", "commitscape", "--local", "--persist-to", join(site, "../../target/site-e2e-state"), "-c", "wrangler.jsonc", "--json", "--command", command],
    { cwd: site, encoding: "utf8" },
  );
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout;
}
const tile = (page: Page, label: string) => page.locator(".tile", { has: page.getByText(label, { exact: true }) }).locator("strong");

async function signedIn(browser: Browser, person: "alice" | "bob"): Promise<Page> {
  await fakeGitHub(`/__as/${person}`);
  const page = await (await browser.newContext()).newPage();
  await page.goto("/api/auth/github");
  await expect(page).toHaveURL(/\/me$/);
  return page;
}

async function webhook(page: Page, event: string, body: unknown, secret = TEST_WEBHOOK_SECRET) {
  const text = JSON.stringify(body);
  return page.request.post("/api/github/webhooks", {
    data: text,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`,
    },
  });
}

test("signed out, a private repository is as if it did not exist", async ({ page, request }) => {
  await page.goto("/gh/acme/private-thing");
  await expect(page.getByText("GitHub has no public repository of that name.")).toBeVisible();
  await expect(page.getByRole("link", { name: "sign in with GitHub", exact: true })).toBeVisible();
  expect((await request.get("/api/reports/acme/private-thing")).status()).toBe(404);
  expect((await request.get("/api/me")).status()).toBe(401);
});

test("Alice signs in, sees her repositories, and opens her private one's Report", async ({ browser }) => {
  const page = await signedIn(browser, "alice");
  await expect(page.getByText("Signed in as")).toContainText("alice");
  await expect(page.getByRole("link", { name: "Add repositories" })).toHaveAttribute("href", "https://github.com/apps/commitscape-test/installations/new");
  await page.getByRole("link", { name: "acme/private-thing" }).click();
  await expect(page.getByText("Something only Alice may see.")).toBeVisible();
  // Built with the installation token, then shown: the coupling fixture's commits.
  await expect(tile(page, "commits")).toHaveText(/^\d+$/, { timeout: 30_000 });
  const report = await page.request.get("/api/reports/acme/private-thing");
  expect(report.status()).toBe(200);
  expect(report.headers()["cache-control"]).toBe("private, no-store");
  // Nothing public of it: no card, no page with a preview.
  expect((await page.request.get("/api/cards/acme/private-thing")).status()).toBe(404);
  expect(await (await page.request.get("/gh/acme/private-thing")).text()).not.toContain("og:title");
  const stored = sql("SELECT private, installation_id, connected_by FROM repositories WHERE id = 'acme/private-thing'");
  expect(stored).toContain('"installation_id": 42');
  expect(stored).toContain('"connected_by": "1001"');
  // The user token is kept locked, never as GitHub gave it.
  expect(sql("SELECT github_token FROM sessions")).not.toContain("ghu_alice");
});

test("Bob, signed in, cannot see it; access is asked of GitHub, and remembered five minutes", async ({ browser }) => {
  const bob = await signedIn(browser, "bob");
  await bob.goto("/gh/acme/private-thing");
  await expect(bob.getByText("GitHub has no public repository of that name.")).toBeVisible();
  expect((await bob.request.get("/api/reports/acme/private-thing")).status()).toBe(404);
  expect((await bob.request.post("/api/builds", { data: { owner: "acme", name: "private-thing" } })).status()).toBe(404);

  const alice = await signedIn(browser, "alice");
  expect((await alice.request.get("/api/reports/acme/private-thing")).status()).toBe(200);
  // GitHub stops showing it to Alice: the answer kept for five minutes stands…
  await fakeGitHub("/__alice_sees?v=0");
  expect((await alice.request.get("/api/reports/acme/private-thing")).status()).toBe(200);
  // …and once it is older, GitHub is asked again.
  sql("UPDATE access SET until = 0");
  expect((await alice.request.get("/api/reports/acme/private-thing")).status()).toBe(404);
  await fakeGitHub("/__alice_sees?v=1");
  sql("UPDATE access SET until = 0");
});

test("a private repository of one's own, without the App on it, says so and how to add it", async ({ browser }) => {
  const bob = await signedIn(browser, "bob");
  await bob.goto("/gh/bob/diary");
  await expect(bob.getByText("This repository is private.")).toBeVisible();
  await expect(bob.getByRole("link", { name: "add it through commitscape's GitHub App" })).toHaveAttribute("href", "/me");
  expect((await bob.request.post("/api/builds", { data: { owner: "bob", name: "diary" } })).status()).toBe(403);
});

test("a Connected Repository unseen for thirty days loses its Report", async ({ browser }) => {
  const alice = await signedIn(browser, "alice");
  sql("UPDATE repositories SET viewed_at = 1, report_at = 1 WHERE id = 'acme/private-thing'");
  expect((await alice.request.get("/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*")).ok()).toBe(true);
  await expect.poll(() => sql("SELECT count(*) AS n FROM repositories WHERE id = 'acme/private-thing'")).toContain('"n": 0');
  // Opened again, it is built again.
  await alice.goto("/gh/acme/private-thing");
  await expect(tile(alice, "commits")).toHaveText(/^\d+$/, { timeout: 30_000 });
});

test("GitHub's webhooks are believed only when signed, and removing the App deletes the Report", async ({ browser }) => {
  const alice = await signedIn(browser, "alice");
  const removed = { action: "removed", installation: { id: 42 }, repositories_removed: [{ full_name: "acme/private-thing" }] };
  expect((await webhook(alice, "installation_repositories", removed, "wrong-secret")).status()).toBe(401);
  expect((await alice.request.get("/api/reports/acme/private-thing")).status()).toBe(200);
  const answer = await webhook(alice, "installation_repositories", removed);
  expect(await answer.json()).toEqual({ ok: true, removed: 1 });
  expect((await alice.request.get("/api/reports/acme/private-thing")).status()).toBe(404);
  // And the whole installation, once built again.
  await alice.goto("/gh/acme/private-thing");
  await expect(tile(alice, "commits")).toHaveText(/^\d+$/, { timeout: 30_000 });
  expect(await (await webhook(alice, "installation", { action: "deleted", installation: { id: 42 } })).json()).toEqual({ ok: true, removed: 1 });
});

test("Delete my data removes the account, its sessions and its Reports", async ({ browser }) => {
  const alice = await signedIn(browser, "alice");
  await alice.goto("/gh/acme/private-thing");
  await expect(tile(alice, "commits")).toHaveText(/^\d+$/, { timeout: 30_000 });
  await alice.goto("/me");
  alice.once("dialog", (d) => void d.accept());
  await alice.getByRole("button", { name: "Delete my data" }).click();
  await expect(alice.getByText("Your data is deleted.")).toBeVisible();
  expect((await alice.request.get("/api/me")).status()).toBe(401);
  expect(sql("SELECT count(*) AS n FROM users WHERE id = '1001'")).toContain('"n": 0');
  expect(sql("SELECT count(*) AS n FROM sessions WHERE user_id = '1001'")).toContain('"n": 0');
  expect(sql("SELECT count(*) AS n FROM repositories WHERE id = 'acme/private-thing'")).toContain('"n": 0');
});

test("a sign-in that did not start here is refused", async ({ request }) => {
  const forged = await request.get("/api/auth/callback?code=code-alice&state=made-up", { maxRedirects: 0 });
  expect(forged.status()).toBe(400);
});
