import { expect, test } from "@playwright/test";
import { signInAs, sql } from "./accounts";

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
