// A tour of the browser interface, as frames for the README's GIF: each
// screen, a tooltip, a profile, the Map opened to a file and its coupling.
//
//   node scripts/demo.mjs <commitscape> <repository> <out dir>
//
// Writes <out>/frame-NN.png and <out>/frames.txt, ffmpeg's concat list with
// how long each frame shows.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const [bin, repo, outArg] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const child = spawn(bin, ["--web", "--offline", "--port", "0", "--window", "all", repo], {
  stdio: ["ignore", "pipe", "inherit"],
});
const url = await new Promise((ok, fail) => {
  let text = "";
  child.stdout.on("data", (d) => {
    text += d;
    const m = text.match(/(http:\/\/\S+)\n/);
    if (m) ok(m[1]);
  });
  child.on("exit", () => fail(new Error(text)));
});
const base = url.replace(/\/\?token=.*/, "");
// As playwright.config.ts: CHROMIUM, this system's, or Playwright's own.
const system = "/run/current-system/sw/bin/chromium";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || (existsSync(system) ? system : undefined),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto(url);
await page.evaluate(() => localStorage.setItem("commitscape-theme", "dark"));
// The lines, and the rest of history, first.
for (let i = 0; i < 300; i++) {
  const meta = await page.evaluate(() => fetch("/api/meta").then((r) => r.json()));
  if (meta.lines !== "counting" && meta.history !== "loading") break;
  await page.waitForTimeout(1000);
}

const frames = [];
let n = 0;
async function shot(seconds) {
  await page.waitForTimeout(350);
  const file = `${out}/frame-${String(n++).padStart(2, "0")}.png`;
  await page.screenshot({ path: file });
  frames.push([file, seconds]);
}
async function go(hash) {
  await page.goto(`${base}/${hash}`);
  await page.reload();
  await page.locator("main").first().waitFor();
  await page.waitForFunction(() => !document.querySelector(".waiting") && !document.querySelector("main.stale"));
}

await go("#/overview");
await shot(2.2);
await page.mouse.wheel(0, 520);
await shot(2.0);
await go("#/activity");
const column = page.locator("svg.columns g").nth(40);
const box = await column.boundingBox();
if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
await shot(2.0);
await go("#/people");
await shot(1.8);
const first = page.locator(".people-table tbody tr").first().getByRole("button").first();
await first.click();
await page.waitForFunction(() => !document.querySelector(".waiting"));
await shot(2.0);
await go("#/map");
await shot(1.6);
const risk = await page.evaluate(() => fetch("/api/risk?window=all").then((r) => r.json()));
const hot = risk.hotspots[0]?.path;
if (hot) {
  const folder = hot.includes("/") ? hot.slice(0, hot.lastIndexOf("/") + 1) : "";
  await go(`#/map?path=${encodeURIComponent(folder)}&file=${encodeURIComponent(hot)}`);
  await page.locator(".file-panel h3").waitFor();
  await shot(2.6);
}
await go("#/risk");
await shot(2.0);
await go("#/overview");
await page.keyboard.press("?");
await shot(2.0);

// ffmpeg's concat list: the last frame is named twice, or its time is lost.
const list = frames.map(([f, s]) => `file '${f}'\nduration ${s}`).join("\n") + `\nfile '${frames.at(-1)[0]}'\n`;
writeFileSync(`${out}/frames.txt`, list);
console.log(`${frames.length} frames in ${out}`);
await browser.close();
child.kill();
