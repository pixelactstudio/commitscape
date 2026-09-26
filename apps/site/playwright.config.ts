import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// CHROMIUM, or this system's Chromium where there is one (NixOS), or
// Playwright's own, as apps/local's tests do.
const system = "/run/current-system/sw/bin/chromium";
const executablePath = process.env.CHROMIUM || (existsSync(system) ? system : undefined);
const port = Number(process.env.SITE_PORT ?? 8790);

// The Site end to end, under `wrangler dev` with local D1 and R2
// (e2e/start.ts). Build it first: `pnpm build`, and the binary and
// fixtures, which the stored Report is written with.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { executablePath },
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: "node e2e/start.ts",
    url: `http://127.0.0.1:${port}/privacy`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
