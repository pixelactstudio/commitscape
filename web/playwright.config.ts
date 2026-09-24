import { defineConfig } from "@playwright/test";

// End-to-end tests of the browser interface against a fixture repository,
// served by a real `commitscape --web` (see e2e/serve.ts). Build the
// fixtures first: `cargo xtask fixtures`.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    launchOptions: {
      executablePath: process.env.CHROMIUM ?? "/run/current-system/sw/bin/chromium",
    },
    viewport: { width: 1280, height: 900 },
  },
});
