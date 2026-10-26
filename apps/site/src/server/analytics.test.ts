import { describe, expect, test } from "vitest";
import { analyticsId } from "@commitscape/server";
import { analytics, type Counter } from "./analytics";

const SECRET = "x".repeat(32);

function counting() {
  const sent: { distinctId: string; event: string; properties: Record<string, unknown> }[] = [];
  const counter: Counter = { capture: (e) => void sent.push(e), shutdown: async () => {} };
  return { sent, counter };
}

describe("the Site's PostHog moments", () => {
  test("know a person only by a keyed hash of their account id, with no person profile", () => {
    const { sent, counter } = counting();
    analytics({ counter, secret: SECRET }).capture("signed in", { userId: "user-9", headers: new Headers() }, { first: true });
    expect(sent).toEqual([{ distinctId: analyticsId("user-9", SECRET), event: "signed in", properties: { first: true, $process_person_profile: false } }]);
    expect(JSON.stringify(sent)).not.toContain("user-9");
  });

  test("are never sent for a request that asks not to be tracked, or when PostHog is not set up", () => {
    const { sent, counter } = counting();
    const a = analytics({ counter, secret: SECRET });
    a.capture("profile served", { userId: "u", headers: new Headers({ dnt: "1" }) });
    a.capture("profile served", { userId: "u", headers: new Headers({ "sec-gpc": "1" }) });
    expect(sent).toHaveLength(0);
    analytics({ counter: null, secret: SECRET }).capture("profile served", { userId: "u" });
    expect(sent).toHaveLength(0);
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
