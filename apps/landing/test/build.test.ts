import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { baseOf, DEFAULT_APP_URL, DEFAULT_LANDING_URL } from "../src/env";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const APP = baseOf(process.env.PUBLIC_APP_URL, DEFAULT_APP_URL);
const LANDING = baseOf(process.env.PUBLIC_LANDING_URL, DEFAULT_LANDING_URL);

let html = "";

beforeAll(() => {
  if (!existsSync(`${dist}index.html`) || readFileSync(`${dist}index.html`, "utf8").includes("<!--body-->")) {
    execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "build", "--logLevel", "error"], { cwd: root, stdio: "inherit" });
    execFileSync(process.execPath, ["scripts/prerender.ts"], { cwd: root, stdio: "inherit" });
  }
  html = readFileSync(`${dist}index.html`, "utf8");
});

const local = (doc: string) => [...doc.matchAll(/\s(?:href|src|srcset)="(\/[^"#?]*)/g)].map((m) => m[1] ?? "");

describe("the built landing page", () => {
  test("is the whole page as HTML, with its title, its description and no placeholder left", () => {
    expect(html).toContain("<title>commitscape: what you have built, in numbers worth sharing</title>");
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/);
    expect(html).toContain("What you’ve built,");
    expect(html).toContain("Everything you’ve built, on one page");
    expect(html).toContain("Any repository on your machine, one command");
    expect(html).not.toMatch(/<!--(head|body)-->/);
    expect(html).toContain('<html lang="en" data-astryx-theme="commitscape">');
  });

  test("sends people to sign in and to the app at its address", () => {
    expect(html).toContain(`href="${APP}/sign-in"`);
    expect(html).toContain(`href="${APP}/dashboard"`);
    expect(html).toContain(`href="${APP}/privacy"`);
    expect(html).toContain(`action="${APP}/sign-in"`);
    expect(html).toContain(`src="${APP}/api/cards/u/gaearon/totals.svg"`);
  });

  test("names only files it ships: its stylesheet, its script, its fonts and its images", () => {
    const paths = local(html);
    expect(paths.length).toBeGreaterThan(3);
    expect(paths.filter((p) => p.startsWith("/assets/") && p.endsWith(".css"))).toHaveLength(1);
    expect(paths.filter((p) => p.startsWith("/assets/") && p.endsWith(".js"))).toHaveLength(1);
    for (const p of paths.filter((p) => p !== "/")) expect(existsSync(`${dist}${p.slice(1)}`), p).toBe(true);
    expect(html).not.toContain("/src/");
    const css = readFileSync(`${dist}${paths.find((p) => p.endsWith(".css"))?.slice(1)}`, "utf8");
    for (const [, url] of css.matchAll(/url\((?:"|')?(\/[^)"']+)/g)) expect(existsSync(`${dist}${url?.slice(1)}`), url).toBe(true);
  });

  test("tells crawlers and link previews where it lives", () => {
    expect(html).toContain(`<link rel="canonical" href="${LANDING}/">`);
    expect(html).toContain(`<meta property="og:image" content="${LANDING}/og.png">`);
    expect(existsSync(`${dist}og.png`)).toBe(true);
    expect(readFileSync(`${dist}robots.txt`, "utf8")).toContain(`Sitemap: ${LANDING}/sitemap.xml`);
    expect(readFileSync(`${dist}sitemap.xml`, "utf8")).toContain(`<loc>${LANDING}/</loc>`);
    expect(readFileSync(`${dist}_headers`, "utf8")).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
  });

  test("stays within Cloudflare Workers' free plan for static assets: few files, none over 25 MiB", () => {
    const files = execFileSync("find", [dist, "-type", "f", "-size", "+25M"], { encoding: "utf8" }).trim();
    expect(files).toBe("");
    const count = execFileSync("find", [dist, "-type", "f"], { encoding: "utf8" }).trim().split("\n").length;
    expect(count).toBeLessThan(200);
  });
});
