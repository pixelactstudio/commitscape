import { describe, expect, test } from "vitest";
import { ingest, ingestTarget } from "./ingest";

const HOST = "https://us.i.posthog.com";
const OPTIONS = { apiHost: HOST, countryHeader: "cf-ipcountry", addressHeader: "x-forwarded-for" };

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

  test("passes the body and the answer through, without the visitor's cookies or sign-in, and only the first three parts of an address PostHog has no choice for", async () => {
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
    const answered = await ingest(request, OPTIONS, fetcher);
    expect(answered.status).toBe(200);
    expect(await answered.text()).toBe("ok");
    expect(answered.headers.get("set-cookie")).toBeNull();
    const [asked] = seen;
    expect(asked?.url).toBe("https://us.i.posthog.com/e/?compression=gzip-js");
    expect(new TextDecoder().decode(asked?.init.body as ArrayBuffer)).toBe("events");
    const headers = asked?.init.headers as Headers;
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.0");
    expect(headers.get("cf-connecting-ip")).toBeNull();
    expect(headers.get("user-agent")).toBe("Firefox");
  });

  test("sends the whole address only to visitors who allow it or whose region starts with everything, and part of it to those who signal not to track", async () => {
    const sent = async (headers: Record<string, string>) => {
      let forwarded: string | null = null;
      const fetcher = (async (_url: string, init: RequestInit) => {
        forwarded = (init.headers as Headers).get("x-forwarded-for");
        return new Response("ok");
      }) as unknown as typeof fetch;
      await ingest(new Request("https://site.test/ingest/e/", { method: "POST", body: "e", headers: { "cf-connecting-ip": "2001:db8:85a3::8a2e:370:7334", ...headers } }), OPTIONS, fetcher);
      return forwarded;
    };
    expect(await sent({ "cf-ipcountry": "US" })).toBe("2001:db8:85a3::8a2e:370:7334");
    expect(await sent({ "cf-ipcountry": "DE" })).toBe("2001:db8:85a3::");
    expect(await sent({ "cf-ipcountry": "DE", cookie: "commitscape.analytics=all" })).toBe("2001:db8:85a3::8a2e:370:7334");
    expect(await sent({ "cf-ipcountry": "US", cookie: "commitscape.analytics=basic" })).toBe("2001:db8:85a3::");
    expect(await sent({ "cf-ipcountry": "US", "sec-gpc": "1" })).toBe("2001:db8:85a3::");
  });

  test("refuses large bodies and other methods, and answers 502 when PostHog cannot be reached", async () => {
    const never = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    expect((await ingest(new Request("https://site.test/ingest/e/", { method: "POST", body: "x".repeat(3 * 1024 * 1024) }), OPTIONS, never)).status).toBe(413);
    expect((await ingest(new Request("https://site.test/ingest/e/", { method: "DELETE" }), OPTIONS, never)).status).toBe(405);
    expect((await ingest(new Request("https://site.test/ingest/e/", { method: "POST", body: "x" }), OPTIONS, never)).status).toBe(502);
  });
});
