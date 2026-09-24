// Screenshots a local file (an SVG card or a one-file page) in Chromium.
//   node scripts/shot.mjs <file> <out.png> [width] [height]
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const [file, out, width = "1200", height = "630"] = process.argv.slice(2);
// As playwright.config.ts: CHROMIUM, this system's, or Playwright's own.
const system = "/run/current-system/sw/bin/chromium";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (existsSync(system) ? system : undefined),
});
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`file://${resolve(file)}`);
await page.waitForTimeout(400);
// An SVG document has no page to scroll: take the viewport.
await page.screenshot({ path: out, fullPage: !file.endsWith(".svg") });
await browser.close();
