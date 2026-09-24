import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` talks to a running `commitscape --web` for its API: set
// COMMITSCAPE_URL to the address it printed, token and all.
const target = process.env.COMMITSCAPE_URL?.replace(/\/\?token=.*/, "");

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: target ? { proxy: { "/api": { target, changeOrigin: true } } } : undefined,
});
