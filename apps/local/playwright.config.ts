import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// CHROMIUM, or this system's Chromium where there is one (NixOS), or
// Playwright's own, installed with `npx playwright install chromium`.
const system = "/run/current-system/sw/bin/chromium";
const executablePath = process.env.CHROMIUM || (existsSync(system) ? system : undefined);

// End-to-end tests of the browser interface against a fixture repository,
// served by a real `commitscape --web` (see e2e/serve.ts). Build the
// fixtures first: `cargo xtask fixtures`.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    launchOptions: { executablePath },
    viewport: { width: 1280, height: 900 },
  },
});
