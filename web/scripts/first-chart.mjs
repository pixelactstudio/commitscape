// Times `commitscape --web <repo>` from the command to its first chart on
// screen, in headless Chromium: the browser interface's budget is one
// second on a warm cache (ADR-0010).
//
//   node scripts/first-chart.mjs <commitscape binary> <repository> [runs]
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const [bin, repo, runs = "5"] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/run/current-system/sw/bin/chromium",
});
const times = [];
for (let i = 0; i < Number(runs); i++) {
  const started = performance.now();
  const child = spawn(bin, ["--web", "--offline", "--port", "0", repo], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      // The whole link: a chunk can end in the middle of the token.
      const m = out.match(/(http:\/\/\S+)\n/);
      if (m) resolve(m[1]);
    });
    child.on("exit", () => reject(new Error(out)));
  });
  const page = await browser.newPage();
  await page.goto(url);
  await page.getByRole("heading", { name: "Commits over time" }).waitFor();
  await page.locator("svg.columns").waitFor();
  times.push(performance.now() - started);
  await page.close();
  child.kill();
}
await browser.close();
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(`first chart: median ${median.toFixed(0)} ms, min ${times[0].toFixed(0)}, max ${times.at(-1).toFixed(0)}, n=${times.length}`);
