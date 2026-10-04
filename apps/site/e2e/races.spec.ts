import { expect, test } from "@playwright/test";
import { signInAs, sql } from "./accounts";

test.describe.configure({ mode: "serial" });

test("three people: a Race only with those who accept, live Standings, and its Card", async ({ browser }) => {
  const alice = await browser.newContext();
  await signInAs(alice, "alice");
  const a = await alice.newPage();
  await a.goto("/races");
  await expect(a.getByRole("heading", { name: "Start a Race" })).toBeVisible();
  await a.getByLabel("Name", { exact: true }).fill("The e2e sprint");
  await a.getByLabel("Invite, by GitHub username").fill("bob, @carol");
  await a.getByRole("button", { name: "Start the Race" }).click();
  await expect(a).toHaveURL(/\/races\/[A-Za-z0-9_-]+$/);
  const url = a.url();
  await expect(a.getByRole("heading", { level: 1 })).toHaveText("The e2e sprint");
  await expect(a.locator(".members li")).toHaveCount(3);
  await expect(a.locator(".members")).toContainText("invited by @alice");
  await expect(a.locator(".standings tbody tr")).toHaveCount(1);

  const bob = await browser.newContext();
  await signInAs(bob, "bob");
  const b = await bob.newPage();
  await b.goto("/races");
  await expect(b.getByText("@alice invited you to")).toBeVisible();
  await b.goto(url);
  await b.getByRole("button", { name: "Accept" }).click();
  await expect(b.locator(".standings tbody tr")).toHaveCount(2);

  const carol = await browser.newContext();
  await signInAs(carol, "carol");
  const c = await carol.newPage();
  await c.goto(url);
  await c.getByRole("button", { name: "Decline" }).click();
  await expect(c.locator(".invitation")).toHaveCount(0);

  const anyone = await browser.newPage();
  await anyone.goto(url);
  await expect(anyone.locator(".members li")).toHaveCount(2);
  await expect(anyone.locator(".standings tbody tr")).toHaveCount(2);
  const merged = anyone.locator(".standings tbody tr", { hasText: "bob" }).locator("td").nth(1);
  await expect(merged).toHaveText("5");
  await expect(merged).toHaveClass(/versus-win/);
  await expect(anyone.locator("body")).not.toContainText("carol");
  const card = await anyone.request.get(`${url.replace("/races/", "/api/cards/races/")}/race.png`);
  expect(card.headers()["content-type"]).toBe("image/png");
});

test("a Crew: everyone accepts, then someone leaves and is gone from it at once; a hidden person is never in it", async ({ browser }) => {
  const contexts = await Promise.all(["alice", "bob", "carol"].map(async (login) => {
    const ctx = await browser.newContext();
    await signInAs(ctx, login);
    return ctx;
  }));
  const [a, b, c] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
  if (!a || !b || !c) throw new Error("pages");
  await a.goto("/crews");
  await a.getByLabel("Name", { exact: true }).fill("The night shift");
  await a.getByLabel("Invite, by GitHub username").fill("bob carol");
  await a.getByRole("button", { name: "Start the Crew" }).click();
  await expect(a).toHaveURL(/\/crews\/[A-Za-z0-9_-]+$/);
  const url = a.url();
  for (const p of [b, c]) {
    await p.goto(url);
    await p.getByRole("button", { name: "Accept" }).click();
    await expect(p.getByRole("button", { name: "Leave this Crew" })).toBeVisible();
  }
  await a.goto(url);
  await expect(a.locator(".standings").first().locator("tbody tr")).toHaveCount(3);
  await c.getByRole("button", { name: "Leave this Crew" }).click();
  await expect(c.getByRole("button", { name: "Leave this Crew" })).toHaveCount(0);
  await a.reload();
  await expect(a.locator(".standings").first().locator("tbody tr")).toHaveCount(2);
  await expect(a.locator(".members")).not.toContainText("carol");
  expect((await sql(`SELECT count(*)::int AS n FROM crew_members WHERE login = 'carol'`))[0]?.n).toBe(0);

  await b.goto("/me");
  await b.getByRole("switch", { name: "Stay out of comparisons" }).click();
  await expect(b.getByRole("switch", { name: "Stay out of comparisons" })).toBeChecked();
  await a.reload();
  await expect(a.locator(".standings").first().locator("tbody tr")).toHaveCount(1);
  await expect(a.locator(".members")).not.toContainText("bob");
  await a.getByLabel("Invite people by GitHub username").fill("bob");
  await a.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(a.getByText("@bob has chosen to stay out of comparisons, so they cannot be invited.")).toBeVisible();
  await b.getByRole("switch", { name: "Stay out of comparisons" }).click();
  await expect(b.getByRole("switch", { name: "Stay out of comparisons" })).not.toBeChecked();
});
