// Screenshots of every screen of `commitscape --web <repo>`, in the light
// and dark themes, once its background work is done: the Phase 19 gate.
//
//   node scripts/screens.mjs <commitscape binary> <repository> <out dir>
//
// Pass the cache with COMMITSCAPE_CACHE_DIR, as for commitscape itself.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const [bin, repo, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const child = spawn(bin, ["--web", "--port", "0", "--window", "1y", repo], {
  stdio: ["ignore", "pipe", "inherit"],
});
const url = await new Promise((resolve, reject) => {
  let text = "";
  child.stdout.on("data", (d) => {
    text += d;
    const m = text.match(/(http:\/\/\S+)\n/);
    if (m) resolve(m[1]);
  });
  child.on("exit", () => reject(new Error(text)));
});
const base = url.replace(/\/\?token=.*/, "");
// As playwright.config.ts: CHROMIUM, this system's, or Playwright's own.
const system = "/run/current-system/sw/bin/chromium";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (existsSync(system) ? system : undefined),
});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(url);

// Wait for the background work: history, lines, GitHub.
const deadline = Date.now() + 15 * 60_000;
for (;;) {
  const meta = await page.evaluate(() => fetch("/api/meta").then((r) => r.json()));
  const busy = meta.history === "loading" || meta.lines === "counting" || meta.github === "asking" || meta.github_history.startsWith("reading") || meta.github_history === "waiting";
  if (!busy || Date.now() > deadline) {
    console.log(`state: history ${meta.history}, lines ${meta.lines}, github ${meta.github}, history ${meta.github_history}`);
    break;
  }
  await page.waitForTimeout(2000);
}

const people = await page.evaluate(() => fetch("/api/people?window=1y").then((r) => r.json()));
const top = people.people[0]?.person.id;
const risk = await page.evaluate(() => fetch("/api/risk?window=1y").then((r) => r.json()));
const hot = risk.hotspots[0]?.path;
const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

const shots = [
  ["overview", "#/overview"],
  ["activity", "#/activity"],
  ["people", "#/people"],
  ["person", top === undefined ? null : `#/people?id=${top}`],
  ["map", "#/map"],
  ["map-file", hot ? `#/map?path=${encodeURIComponent(folderOf(hot))}&file=${encodeURIComponent(hot)}` : null],
  ["risk", "#/risk"],
];
for (const theme of ["dark", "light"]) {
  await page.evaluate((t) => localStorage.setItem("commitscape-theme", t), theme);
  for (const [name, hash] of shots) {
    if (!hash) continue;
    await page.goto(`${base}/${hash}`);
    await page.reload();
    await page.locator(".screen").first().waitFor();
    await page.waitForFunction(() => !document.querySelector(".waiting") && !document.querySelector(".screen.stale"));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-${theme}.png`, fullPage: true });
  }
}
// The explanations under `?`, once.
await page.goto(`${base}/#/overview`);
await page.reload();
await page.locator(".screen").first().waitFor();
await page.keyboard.press("?");
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/overview-help-light.png`, fullPage: true });
console.log(`wrote ${out}`);
await browser.close();
child.kill();
