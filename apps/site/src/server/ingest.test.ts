import { describe, expect, test } from "vitest";
import { ingest, ingestTarget } from "./ingest";

const HOST = "https://us.i.posthog.com";

describe("the PostHog proxy", () => {
  test("sends scripts and remote settings to PostHog's assets host and the rest to its API host, query and all", () => {
    const at = (path: string) => ingestTarget(new URL(`https://site.test${path}`), HOST);
    expect(at("/ingest/static/array.js")).toBe("https://us-assets.i.posthog.com/static/array.js");
    expect(at("/ingest/array/phc_x/config.js")).toBe("https://us-assets.i.posthog.com/array/phc_x/config.js");
    expect(at("/ingest/e/?ip=0&compression=gzip-js")).toBe("https://us.i.posthog.com/e/?ip=0&compression=gzip-js");
    expect(ingestTarget(new URL("https://site.test/ingest/flags/?v=2"), "https://eu.i.posthog.com")).toBe("https://eu.i.posthog.com/flags/?v=2");
    expect(ingestTarget(new URL("https://site.test/ingest/e/"), "https://posthog.example.org")).toBe("https://posthog.example.org/e/");
    expect(at("/ingestion")).toBeNull();
  });

  test("passes the body and the answer through, without the visitor's cookies, sign-in or address", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain", "set-cookie": "x=1", "access-control-allow-origin": "*" } });
    }) as unknown as typeof fetch;
    const request = new Request("https://site.test/ingest/e/?compression=gzip-js", {
      method: "POST",
      body: "events",
      headers: { cookie: "commitscape.session_token=secret", authorization: "Bearer t", "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "203.0.113.9", "user-agent": "Firefox", "content-type": "text/plain" },
    });
    const answered = await ingest(request, HOST, fetcher);
    expect(answered.status).toBe(200);
    expect(await answered.text()).toBe("ok");
    expect(answered.headers.get("set-cookie")).toBeNull();
    const [asked] = seen;
    expect(asked?.url).toBe("https://us.i.posthog.com/e/?compression=gzip-js");
    expect(new TextDecoder().decode(asked?.init.body as ArrayBuffer)).toBe("events");
    const headers = asked?.init.headers as Headers;
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("cf-connecting-ip")).toBeNull();
    expect(headers.get("user-agent")).toBe("Firefox");
  });

  test("refuses large bodies and other methods, and answers 502 when PostHog cannot be reached", async () => {
    const never = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    expect((await ingest(new Request("https://site.test/ingest/e/", { method: "POST", body: "x".repeat(3 * 1024 * 1024) }), HOST, never)).status).toBe(413);
    expect((await ingest(new Request("https://site.test/ingest/e/", { method: "DELETE" }), HOST, never)).status).toBe(405);
    expect((await ingest(new Request("https://site.test/ingest/e/", { method: "POST", body: "x" }), HOST, never)).status).toBe(502);
  });
});
