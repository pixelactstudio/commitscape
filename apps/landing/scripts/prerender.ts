import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { fillTemplate } from "./template.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = new URL("../dist/", import.meta.url);

const server = await createServer({ root, logLevel: "error", server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { render } = (await server.ssrLoadModule("/src/render.tsx")) as typeof import("../src/render");
  const { sitemap, robots } = (await server.ssrLoadModule("/src/files.ts")) as typeof import("../src/files");
  const template = await readFile(new URL("index.html", dist), "utf8");
  await writeFile(new URL("index.html", dist), fillTemplate(template, render()));
  await writeFile(new URL("sitemap.xml", dist), sitemap());
  await writeFile(new URL("robots.txt", dist), robots());
  await rm(new URL(".vite/", dist), { recursive: true, force: true });
} finally {
  await server.close();
}
