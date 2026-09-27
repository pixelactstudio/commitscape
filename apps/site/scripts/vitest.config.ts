import { defineConfig } from "vitest/config";

// The CPU measurement (cpu.test.ts), run on its own: not part of `pnpm test`.
export default defineConfig({ test: { include: ["scripts/*.test.ts"], testTimeout: 120_000 } });
