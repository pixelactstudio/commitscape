import { readFile } from "node:fs/promises";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { fillTemplate } from "./scripts/template.ts";

function drawnInDev(): Plugin {
  return {
    name: "commitscape-landing-dev",
    apply: "serve",
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/" && req.url !== "/index.html") return next();
          try {
            const template = await server.transformIndexHtml(req.url, await readFile(new URL("./index.html", import.meta.url), "utf8"));
            const { render } = (await server.ssrLoadModule("/src/render.tsx")) as typeof import("./src/render");
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(fillTemplate(template, render()));
          } catch (e) {
            server.ssrFixStacktrace(e as Error);
            next(e);
          }
        });
      };
    },
  };
}

export default defineConfig({
  envPrefix: "PUBLIC_",
  plugins: [tailwindcss(), react(), drawnInDev()],
  build: { target: "es2022", assetsInlineLimit: 0 },
});
