import { describe, expect, test } from "vitest";
import { isOpenPage, returnTo, signInFor } from "#/lib/access";
import { accessOf, gate, SIGN_IN_WORDS, type GateOptions } from "./gate";

const FN = "/_serverFn/";
const OPEN_FN = `${FN}open-viewer`;

function options(signedIn: boolean, over: Partial<GateOptions> = {}) {
  const asked = { n: 0 };
  const o: GateOptions = {
    fnBase: FN,
    openFns: new Set([OPEN_FN]),
    signedIn: async () => {
      asked.n++;
      return signedIn;
    },
    ...over,
  };
  return { o, asked };
}

const at = (path: string) => new URL(`https://commitscape.example${path}`);

const OPEN = [
  ["GET", "/api/cards/u/alice/totals.svg"],
  ["GET", "/api/cards/u/alice/acme/ownership/standing.png?theme=dark"],
  ["GET", "/api/cards/u/alice/wrapped/2026/wrapped.png"],
  ["GET", "/api/cards/gh/acme/ownership/hall-of-fame.svg"],
  ["GET", "/api/cards/vs/alice/bob/versus.png"],
  ["GET", "/api/cards/site/preview.png"],
  ["POST", "/api/shares"],
  ["GET", "/api/shares/AbCdEfGhIjKlMnOpQrStUv"],
  ["PUT", "/api/shares/AbCdEfGhIjKlMnOpQrStUv"],
  ["DELETE", "/api/shares/AbCdEfGhIjKlMnOpQrStUv"],
  ["GET", "/api/work/s/abc/proof.md"],
  ["GET", "/api/auth/get-session"],
  ["GET", "/api/auth/callback/github?code=x&state=y"],
  ["POST", "/api/auth/sign-in/social"],
  ["GET", "/api/health"],
  ["POST", "/api/github/webhooks"],
  ["POST", "/mcp"],
  ["GET", "/s/AbCdEfGhIjKlMnOpQrStUv"],
  ["GET", "/u/alice/work/abc123"],
  ["GET", "/privacy"],
  ["GET", "/robots.txt"],
  ["GET", "/favicon.svg"],
  ["GET", "/fonts/InterVariable.woff2"],
  ["GET", "/assets/main-abc123.js"],
  ["POST", "/ingest/e/?compression=gzip-js"],
  ["GET", "/ingest/static/array.js"],
  ["POST", OPEN_FN],
  ["GET", `${OPEN_FN}?payload=x`],
] as const;

const PAGES = ["/dashboard", "/me", "/u/alice", "/u/alice/cards", "/u/alice/work?from=2026-08-01&to=2026-08-31", "/u/alice/wrapped/2026", "/u/alice/acme/ownership", "/vs", "/vs/alice/bob", "/gh/acme/ownership?screen=people", "/gh/vercel/next.js", "/you", "/design", "/leaderboards", "/races"];

const API = ["/api/reports/acme/ownership/answer?key=x", "/api/reports/acme/ownership/commits", "/api/reports/acme/ownership/git/tree.json", "/api/reports/acme/ownership/atlas", "/api/work/u/alice/proof.md", "/api/nope", "/api/cards"];

describe("the gate", () => {
  test("Cards, Shared Reports, shared Proof of Work, signing in, health, webhooks, MCP, files and PostHog's counting stay open, without reading a session", async () => {
    for (const [method, path] of OPEN) {
      const { o, asked } = options(false);
      expect(await accessOf(at(path), method, o), `${method} ${path}`).toEqual({ kind: "open" });
      expect(asked.n, `${method} ${path}`).toBe(0);
    }
    expect(await accessOf(at("/sign-in?next=%2Fu%2Falice"), "GET", options(false).o)).toEqual({ kind: "open" });
  });

  test("every other page sends someone signed out to sign in, keeping where they were going", async () => {
    for (const path of PAGES) {
      const access = await accessOf(at(path), "GET", options(false).o);
      expect(access, path).toEqual({ kind: "redirect", to: signInFor(path) });
    }
    expect(await accessOf(at("/u/alice?day=2026-08-01"), "GET", options(false).o)).toEqual({ kind: "redirect", to: "/sign-in?next=%2Fu%2Falice%3Fday%3D2026-08-01" });
    expect(await accessOf(at("/dashboard"), "HEAD", options(false).o)).toEqual({ kind: "redirect", to: "/sign-in" });
    expect(await accessOf(at("/u/alice"), "POST", options(false).o)).toEqual({ kind: "refuse", as: "json" });
  });

  test("the API answers 401 and server functions 401 in plain text to someone signed out", async () => {
    for (const path of API) expect(await accessOf(at(path), "GET", options(false).o), path).toEqual({ kind: "refuse", as: "json" });
    expect(await accessOf(at(`${FN}abc123?payload=x`), "GET", options(false).o)).toEqual({ kind: "refuse", as: "text" });
    expect(await accessOf(at(`${FN}abc123`), "POST", options(false).o)).toEqual({ kind: "refuse", as: "text" });
  });

  test("someone signed in goes anywhere", async () => {
    for (const path of [...PAGES, ...API, `${FN}abc123`]) expect(await accessOf(at(path), "GET", options(true).o), path).toEqual({ kind: "open" });
  });

  test("the Site's front door sends people signed in to their dashboard, and everyone else to sign in or the landing page", async () => {
    expect(await accessOf(at("/"), "GET", options(true).o)).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(await accessOf(at("/"), "GET", options(false).o)).toEqual({ kind: "redirect", to: "/sign-in" });
    expect(await accessOf(at("/"), "GET", options(false, { landing: "https://commitscape.dev/" }).o)).toEqual({ kind: "redirect", to: "https://commitscape.dev/" });
  });

  test("the sign-in page sends someone already signed in on to where they were going, never off the Site", async () => {
    const next = (n: string) => accessOf(at(`/sign-in?next=${encodeURIComponent(n)}`), "GET", options(true).o);
    expect(await next("/u/alice?day=2026-08-01")).toEqual({ kind: "redirect", to: "/u/alice?day=2026-08-01" });
    for (const away of ["//evil.example/x", "https://evil.example", "/\\evil.example", "/sign-in", "/api/reports/a/b/commits", "dashboard"]) expect(await next(away), away).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(await accessOf(at("/sign-in"), "GET", options(true).o)).toEqual({ kind: "redirect", to: "/dashboard" });
  });

  test("what it answers: a redirect nobody keeps, a JSON 401 for the API and a plain one for server functions", async () => {
    const page = await gate(new Request("https://commitscape.example/u/alice"), options(false).o);
    expect(page?.status).toBe(302);
    expect(page?.headers.get("location")).toBe("/sign-in?next=%2Fu%2Falice");
    expect(page?.headers.get("cache-control")).toBe("no-store");
    const api = await gate(new Request("https://commitscape.example/api/reports/acme/ownership/commits"), options(false).o);
    expect(api?.status).toBe(401);
    expect(api?.headers.get("content-type")).toBe("application/json");
    expect(await api?.json()).toEqual({ error: SIGN_IN_WORDS });
    const fn = await gate(new Request(`https://commitscape.example${FN}abc123`, { method: "POST" }), options(false).o);
    expect(fn?.status).toBe(401);
    expect(fn?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await fn?.text()).toBe(SIGN_IN_WORDS);
    expect(await gate(new Request("https://commitscape.example/api/cards/u/alice/totals.svg"), options(false).o)).toBeNull();
    expect(await gate(new Request("https://commitscape.example/u/alice"), options(true).o)).toBeNull();
  });
});

describe("where signing in comes back to", () => {
  test("only pages of this Site, and the dashboard otherwise", () => {
    expect(returnTo("/gh/acme/ownership?screen=people")).toBe("/gh/acme/ownership?screen=people");
    for (const bad of [undefined, null, 3, "", "/", "//x.example", "https://x.example", "/\\x.example", "/sign-in?next=/u/a", "/api/health"]) expect(returnTo(bad), String(bad)).toBe("/dashboard");
    expect(signInFor("/dashboard")).toBe("/sign-in");
    expect(signInFor("/vs/a/b")).toBe("/sign-in?next=%2Fvs%2Fa%2Fb");
  });

  test("the pages open to anyone", () => {
    for (const path of ["/sign-in", "/privacy", "/s/abc", "/u/alice/work/abc"]) expect(isOpenPage(path), path).toBe(true);
    for (const path of ["/", "/u/alice", "/u/alice/work", "/u/alice/work/abc/more", "/s", "/s/abc/x", "/dashboard"]) expect(isOpenPage(path), path).toBe(false);
  });
});
