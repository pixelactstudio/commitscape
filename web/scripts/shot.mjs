// Screenshots a local file (an SVG card or a one-file page) in Chromium.
//   node scripts/shot.mjs <file> <out.png> [width] [height]
import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const [file, out, width = "1200", height = "630"] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/run/current-system/sw/bin/chromium",
});
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`file://${resolve(file)}`);
await page.waitForTimeout(400);
// An SVG document has no page to scroll: take the viewport.
await page.screenshot({ path: out, fullPage: !file.endsWith(".svg") });
await browser.close();
