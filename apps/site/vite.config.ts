import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const tree = readFileSync(new URL("./src/routeTree.gen.ts", import.meta.url), "utf8");
const routes = [...(/fullPaths:([\s\S]*?)\n\s+fileRoutesByTo/.exec(tree)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: { __ROUTES__: JSON.stringify(routes) },
  ssr: { external: ["satori", "@resvg/resvg-js", "pdfkit"], optimizeDeps: { exclude: ["satori", "@resvg/resvg-js", "pdfkit"] } },
  optimizeDeps: { exclude: ["satori", "@resvg/resvg-js"] },
  worker: { format: "es" },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    nitro({ traceDeps: ["satori*", "harfbuzzjs*", "@resvg/resvg-js*", "pdfkit*", "react", "react-dom"], compressPublicAssets: { gzip: true, brotli: true }, routeRules: { "/fonts/**": { headers: { "cache-control": "public, max-age=2592000" } } } }),
    react(),
    sentryTanstackStart({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});
