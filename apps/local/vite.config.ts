import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `pnpm dev` talks to a running `commitscape --web` for its API: set
// COMMITSCAPE_URL to the address it printed, token and all.
const target = process.env.COMMITSCAPE_URL?.replace(/\/\?token=.*/, "");

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // One script: `commitscape report` writes the page into one file, which
    // cannot load chunks beside it.
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 2000,
  },
  server: target ? { proxy: { "/api": { target, changeOrigin: true } } } : undefined,
});
