import { expect, test } from "@playwright/test";
import { SIGNED_IN, signInAs, sql } from "./accounts";

test("every test browses signed in, as dana unless it signs in someone else", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await signInAs(context, "dana");
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await context.storageState({ path: SIGNED_IN });
  await context.close();
});

test("the fixture repository and its owner are read for someone signed in", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  await signInAs(context, "alice");
  const page = await context.newPage();
  await page.goto("/gh/acme/ownership");
  await expect.poll(async () => (await sql("SELECT report_at FROM repositories WHERE id = 'acme/ownership'"))[0]?.report_at ?? null, { timeout: 60_000 }).not.toBeNull();
  await page.goto("/u/alice");
  await expect(page.getByRole("group", { name: "Lines that still run", exact: true })).not.toContainText("Counting", { timeout: 60_000 });
  await context.close();
});
