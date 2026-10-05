import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";

const root = resolve(import.meta.dirname, "../../..");
const setup = JSON.parse(readFileSync(join(root, "target", "site-e2e-env.json"), "utf8")) as { databaseUrl: string };

async function sql(text: string) {
  const client = new pg.Client(setup.databaseUrl);
  await client.connect();
  try {
    await client.query(text);
  } finally {
    await client.end();
  }
}

test("two people side by side, a winner for each view, and their Card", async ({ page, request }) => {
  await page.goto("/vs/alice/bob");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("alice versus bob");
  await expect(page.getByRole("heading", { name: "View by view" })).toBeVisible();
  const row = (label: string) => page.getByRole("listitem").filter({ hasText: label });
  await expect(row("Commits")).toContainText("30");
  await expect(row("Commits")).toContainText("40");
  await expect(row("Commits").getByLabel("leads this view")).toHaveCount(1);
  await expect(row("Reviews given")).toContainText("5");
  await expect(page.locator("body")).not.toContainText(/wins \d|\d+ views? won|overall winner:|leads \d+ views?/i);
  await page.getByRole("radio", { name: "Full" }).click();
  await expect(page).toHaveURL(/view=full/);
  await expect(page.getByRole("region", { name: "The last year" })).toBeAttached();
  await expect(page.getByRole("region", { name: "Where both work" })).toBeAttached();
  const card = await request.get("/api/cards/vs/alice/bob/versus.png");
  expect(card.headers()["content-type"]).toBe("image/png");
  await page.goto("/vs/alice/nobody-here");
  await expect(page.getByText("GitHub has no person called @nobody-here.")).toBeVisible();
  await page.goto("/vs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Versus");
});

test("a hidden Profile is refused, its Card too", async ({ page, request }) => {
  await sql("INSERT INTO people (login, hidden, name_private, updated_at) VALUES ('bob', true, false, 1) ON CONFLICT (login) DO UPDATE SET hidden = true");
  await page.goto("/vs/alice/bob");
  await expect(page.getByText("@bob has chosen to stay out of comparisons.")).toBeVisible();
  expect((await request.get("/api/cards/vs/alice/bob/versus.svg")).status()).toBe(404);
  await page.goto("/u/bob");
  await expect(page.getByText("This person has chosen to stay out of comparisons, so their Profile shows nothing.")).toBeVisible();
  await sql("UPDATE people SET hidden = false WHERE login = 'bob'");
});
