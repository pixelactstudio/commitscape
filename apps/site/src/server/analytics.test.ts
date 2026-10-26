import { describe, expect, test } from "vitest";
import { analyticsId } from "@commitscape/server";
import { analytics, type Counter } from "./analytics";

const SECRET = "x".repeat(32);

type Sent = Parameters<Counter["capture"]>[0];

function counting() {
  const sent: Sent[] = [];
  const counter: Counter = { capture: (e) => void sent.push(e), shutdown: async () => {} };
  return { sent, counter };
}

describe("the Site's PostHog moments", () => {
  test("know a person by a keyed hash of their account id, never the id, and make no person profile before they allow everything", () => {
    const { sent, counter } = counting();
    analytics({ counter, secret: SECRET }).capture("signed in", { userId: "user-9", headers: new Headers({ "cf-ipcountry": "DE" }) }, { first: true });
    expect(sent).toEqual([{ distinctId: analyticsId("user-9", SECRET), event: "signed in", properties: { first: true, app: "site", region: "ask", consent: "basic", $process_person_profile: false }, disableGeoip: true }]);
    expect(JSON.stringify(sent)).not.toContain("user-9");
  });

  test("with everything allowed, join the browser's PostHog session and send the whole address for the city", () => {
    const { sent, counter } = counting();
    const headers = new Headers({ "cf-ipcountry": "US", "cf-connecting-ip": "203.0.113.9", "x-posthog-distinct-id": "browser-1", "x-posthog-session-id": "session-1" });
    const a = analytics({ counter, secret: SECRET });
    a.capture("profile served", { userId: "user-9", headers });
    a.capture("profile served", { userId: null, headers });
    expect(sent[0]).toMatchObject({ distinctId: analyticsId("user-9", SECRET), properties: { consent: "full", $process_person_profile: true, $session_id: "session-1", $ip: "203.0.113.9" }, disableGeoip: false });
    expect(sent[1]).toMatchObject({ distinctId: "browser-1", properties: { $process_person_profile: false, $session_id: "session-1" } });
  });

  test("still count, at basic and with part of the address, a browser that signals not to track or a visitor who chose basic", () => {
    const { sent, counter } = counting();
    const a = analytics({ counter, secret: SECRET });
    a.capture("profile served", { userId: "u", headers: new Headers({ "cf-ipcountry": "US", "cf-connecting-ip": "203.0.113.9", dnt: "1", "x-posthog-session-id": "s" }) });
    a.capture("profile served", { userId: "u", headers: new Headers({ "cf-ipcountry": "US", "cf-connecting-ip": "203.0.113.9", cookie: "commitscape.analytics=basic" }) });
    for (const e of sent) {
      expect(e.properties).toMatchObject({ consent: "basic", $ip: "203.0.113.0", $process_person_profile: false });
      expect(e.properties).not.toHaveProperty("$session_id");
    }
    analytics({ counter: null, secret: SECRET }).capture("profile served", { userId: "u" });
    expect(sent).toHaveLength(2);
  });

  test("without the Site's secret, use a fresh id each time rather than the account id", () => {
    const { sent, counter } = counting();
    const a = analytics({ counter, secret: undefined });
    a.capture("build requested", { userId: "user-1" });
    a.capture("build requested", { userId: "user-1" });
    expect(sent[0]?.distinctId).not.toBe(sent[1]?.distinctId);
    expect(sent.every((e) => !e.distinctId.includes("user-1"))).toBe(true);
  });

  test("count a page polled while a Build runs once, per person and page, until the window passes", async () => {
    const { sent, counter } = counting();
    const a = analytics({ counter, secret: SECRET, onceFor: 50 });
    for (let i = 0; i < 5; i++) a.capture("repository page served", { userId: "u" }, { report: false }, "acme/rocket");
    a.capture("repository page served", { userId: "v" }, { report: false }, "acme/rocket");
    a.capture("repository page served", { userId: "u" }, { report: true }, "acme/other");
    expect(sent).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 60));
    a.capture("repository page served", { userId: "u" }, { report: true }, "acme/rocket");
    expect(sent).toHaveLength(4);
  });
});
