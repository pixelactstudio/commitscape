// Times the Commits screen's search on a real repository, in headless
// Chromium: the Commit List's size, and each keystroke's time from the key
// to the results on screen (ADR-0019's budget is 16 ms at React's size).
//
//   node scripts/search-time.mjs <commitscape> <repository> [query]
//
// Pass the cache with COMMITSCAPE_CACHE_DIR, as for commitscape itself.
// Keys are typed 150 ms apart, so each is a first keystroke that searches at
// once rather than one folded into the next.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const [bin, repo, query = "fix the render"] = process.argv.slice(2);
const child = spawn(bin, ["--web", "--offline", "--port", "0", "--window", "all", repo], {
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
const token = url.replace(/.*token=/, "");
// As playwright.config.ts: CHROMIUM, this system's, or Playwright's own.
const system = "/run/current-system/sw/bin/chromium";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (existsSync(system) ? system : undefined),
});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
await page.goto(url);
// All of history first, and the lines where they can be counted.
for (let i = 0; i < 600; i++) {
  const meta = await page.evaluate(() => fetch("/api/meta").then((r) => r.json()));
  if (meta.history !== "loading" && meta.lines !== "counting") break;
  await page.waitForTimeout(1000);
}
const list = Buffer.from(await (await fetch(`${base}/api/commits?token=${token}`)).arrayBuffer());
const rows = JSON.parse(list.toString()).ids.length;
console.log(`commit list: ${rows} commits, ${list.length} bytes, ${gzipSync(list, { level: 9 }).length} gzipped`);

await page.goto(`${base}/#/commits`);
await page.locator(".commit-row").first().waitFor();
const input = page.getByRole("textbox", { name: "Search commits" });
await input.focus();
// From each key to the moment the count under the title changes.
await page.evaluate(() => {
  const w = window;
  w.__times = [];
  const note = () => document.querySelector(".figure .note")?.textContent ?? "";
  let watch = null;
  document.addEventListener(
    "keydown",
    () => {
      // A key that changes nothing (a space, say) is not timed: the next
      // key's change is not its answer.
      watch?.disconnect();
      const t0 = performance.now();
      const before = note();
      watch = new MutationObserver(() => {
        if (note() !== before) {
          w.__times.push(performance.now() - t0);
          watch.disconnect();
        }
      });
      watch.observe(document.body, { subtree: true, childList: true, characterData: true });
      setTimeout(() => watch.disconnect(), 2000);
    },
    true,
  );
});
for (const ch of query) {
  await page.keyboard.type(ch);
  await page.waitForTimeout(150);
}
const times = await page.evaluate(() => window.__times);
const sorted = [...times].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? NaN;
console.log(
  `search "${query}": ${times.length} keystrokes that changed the results; median ${median.toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`,
);
console.log(`each: ${times.map((t) => t.toFixed(1)).join(" ")}`);
const found = await page.evaluate(() => document.querySelector(".figure .note")?.textContent);
console.log(`at the end: ${found}`);
await browser.close();
child.kill();
