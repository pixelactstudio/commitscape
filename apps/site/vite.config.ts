import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: { external: ["satori", "@resvg/resvg-js", "pdfkit"], optimizeDeps: { exclude: ["satori", "@resvg/resvg-js", "pdfkit"] } },
  optimizeDeps: { exclude: ["satori", "@resvg/resvg-js"] },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    nitro({ traceDeps: ["satori*", "harfbuzzjs*", "@resvg/resvg-js*", "pdfkit*"] }),
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
