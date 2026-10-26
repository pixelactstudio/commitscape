import { readFileSync } from "node:fs";
import * as Sentry from "@sentry/tanstackstart-react";
import { describe, expect, test } from "vitest";
import { nameRequest, nameServerFn, routeOf } from "./telemetry";

const sent: string[] = [];

Sentry.init({
  dsn: "https://public@o0.ingest.sentry.io/0",
  tracesSampleRate: 1,
  transport: () => ({ send: async () => ({}), flush: async () => true }),
  beforeSendSpan: (span) => {
    if (span.is_segment) sent.push(`${span.name} ${String(span.attributes?.["http.route"] ?? "")} ${String(span.attributes?.["sentry.segment.name.source"] ?? "")}`);
    return span;
  },
});

const tree = readFileSync(new URL("../routeTree.gen.ts", import.meta.url), "utf8");
const ROUTES = [...(/fullPaths:([\s\S]*?)\n\s+fileRoutesByTo/.exec(tree)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "");

describe("routeOf", () => {
  test("names a path by the route that serves it, the most literal first and a splat last", () => {
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(routeOf("/api/reports/react/react/answer", ROUTES)).toBe("/api/reports/$owner/$repo/answer");
    expect(routeOf("/api/reports/react/react/git/tree.json", ROUTES)).toBe("/api/reports/$owner/$repo/git/$file");
    expect(routeOf("/gh/react/react", ROUTES)).toBe("/gh/$owner/$repo");
    expect(routeOf("/u/gaearon/cards", ROUTES)).toBe("/u/$login/cards");
    expect(routeOf("/u/gaearon/react/react", ROUTES)).toBe("/u/$login/$owner/$repo");
    expect(routeOf("/api/cards/u/gaearon/totals.svg", ROUTES)).toBe("/api/cards/u/$login/$file");
    expect(routeOf("/api/health", ROUTES)).toBe("/api/health");
    expect(routeOf("/api/auth/callback/github", ROUTES)).toBe("/api/auth/$");
    expect(routeOf("/vs/", ROUTES)).toBe("/vs");
    expect(routeOf("/", ROUTES)).toBe("/");
    expect(routeOf("/no/such/page", ROUTES)).toBe("/$");
    expect(routeOf("/ingest/e/", ROUTES)).toBe("/ingest/$");
    expect(routeOf("/a/b", ["/a/$x", "/a/b"])).toBe("/a/b");
    expect(routeOf("/a/b/c", ["/a/$x"])).toBeNull();
  });
});

describe("a request's transaction", () => {
  test("is named after its route, and a server function's after the function, never inside a page being drawn", async () => {
    sent.length = 0;
    const serve = (url: string, method = "GET", fn?: string) =>
      Sentry.startSpan({ name: method, op: "http.server", forceTransaction: true }, async () => {
        nameRequest(new Request(url, { method }), "/_serverFn/", ROUTES);
        await Sentry.startSpan({ name: "work" }, async () => nameServerFn(method, fn));
      });
    await serve("https://site.test/api/reports/react/react/answer?key=%2Fapi%2Foverview");
    await serve("https://site.test/_serverFn/abc123", "POST", "startBuild");
    await serve("https://site.test/gh/react/react", "GET", "getLookup");
    await Sentry.flush(1000);
    expect(sent).toEqual(["GET /api/reports/$owner/$repo/answer /api/reports/$owner/$repo/answer route", "POST /_serverFn/startBuild /_serverFn/startBuild route", "GET /gh/$owner/$repo /gh/$owner/$repo route"]);
  });
});
