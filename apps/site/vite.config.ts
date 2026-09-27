import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Every page is a static asset (ADR-0014): the app is a single-page app
// whose one shell, `index.html`, is served for every path without a file of
// its own, and only `/api/*` reaches the Worker (wrangler.jsonc's
// `run_worker_first`).
export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: "/index" } },
      sitemap: { enabled: false },
    }),
    react(),
  ],
  // The screens are one script, shared with the local page.
  build: { chunkSizeWarningLimit: 2000 },
});
