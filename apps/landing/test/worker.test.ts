import { describe, expect, test } from "vitest";
import worker, { settingsFor, withSettings, type Env } from "../worker/index";

const PAGE = "<!doctype html><html><head><title>x</title></head><body></body></html>";

function env(key: string | undefined, seen: Request[] = []): Env {
  const ASSETS = {
    fetch: async (r: Request) => {
      seen.push(r);
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", etag: '"a"', "cache-control": "public, max-age=0" } });
    },
  } as unknown as Fetcher;
  return { ASSETS, POSTHOG_KEY: key };
}

const call = (request: Request, e: Env) => worker.fetch(request as never, e);

describe("the landing page's Worker", () => {
  test("writes each visitor's region, choice and level into the page, never cached for the next visitor", async () => {
    const seen: Request[] = [];
    const answer = await call(new Request("https://commitscape.com/", { headers: { "cf-ipcountry": "DE", "if-none-match": '"a"' } }), env("phc_x", seen));
    const html = await answer.text();
    expect(html).toContain('<script>window.__COMMITSCAPE_ANALYTICS__={"key":"phc_x","region":"ask","choice":null,"level":"basic"}</script></head>');
    expect(answer.headers.get("cache-control")).toBe("private, no-cache");
    expect(answer.headers.get("etag")).toBeNull();
    expect(seen[0]?.headers.get("if-none-match")).toBeNull();
    expect(settingsFor(new Headers({ "cf-ipcountry": "US", cookie: "commitscape.analytics=basic" }), "k")).toEqual({ key: "k", region: "tell", choice: "basic", level: "basic" });
  });

  test("leaves the page as it is without a PostHog key, and answers 404 for PostHog's paths", async () => {
    const answer = await call(new Request("https://commitscape.com/"), env(undefined));
    expect(await answer.text()).toBe(PAGE);
    expect((await call(new Request("https://commitscape.com/ingest/e/", { method: "POST", body: "x" }), env(undefined))).status).toBe(404);
  });

  test("keeps a script tag in the settings from closing early", () => {
    expect(withSettings(PAGE, { key: "</script><script>alert(1)", region: "ask", choice: null, level: "basic" })).not.toContain("</script><script>alert(1)");
  });
});
