import { defineConfig } from "vitest/config";

// Unit tests only; the pages and the API end to end are Playwright's (e2e/).
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
