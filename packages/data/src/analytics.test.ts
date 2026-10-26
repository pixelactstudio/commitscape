import { describe, expect, test } from "vitest";
import { addressFor, choiceOf, consentCookie, cookieValue, eventAllowed, FEATURES, featuresAt, levelOf, regionById, regionOf, REGIONS, sharedCookieDomain, visitorOf, type FeatureId } from "./analytics";

const ASK = regionById("ask");
const TELL = regionById("tell");

describe("the analytics config", () => {
  test("puts the EU, the EEA, the UK, Switzerland and India in the region that asks first, and everyone else where everything starts", () => {
    for (const c of ["DE", "fr", "IE", "NO", "GB", "CH", "IN"]) expect(regionOf(c).id).toBe("ask");
    for (const c of ["US", "BR", "JP", "AU"]) expect(regionOf(c).id).toBe("tell");
    for (const c of [null, "", "XX", "T1"]) expect(regionOf(c).id).toBe("ask");
    expect(REGIONS.at(-1)?.countries).toBe("*");
  });

  test("lets a choice win, then a browser's signal not to track, then the region", () => {
    expect(levelOf(ASK, null, false)).toBe("basic");
    expect(levelOf(TELL, null, false)).toBe("full");
    expect(levelOf(TELL, null, true)).toBe("basic");
    expect(levelOf(ASK, "all", true)).toBe("full");
    expect(levelOf(TELL, "basic", false)).toBe("basic");
    expect(choiceOf("all")).toBe("all");
    expect(choiceOf("everything")).toBeNull();
  });

  test("never lets basic include a feature that needs a cookie, and gives full everything", () => {
    const basic = featuresAt({ ...ASK, basic: Object.keys(FEATURES) as FeatureId[] }, "basic");
    for (const f of basic) expect("cookies" in FEATURES[f]).toBe(false);
    expect(featuresAt(TELL, "full").size).toBe(Object.keys(FEATURES).length);
  });

  test("allows each of PostHog's events by the feature that makes it, the Site's by Moments, and exceptions never", () => {
    const basic = featuresAt(ASK, "basic");
    const full = featuresAt(ASK, "full");
    expect(eventAllowed("$pageview", basic, "basic")).toBe(true);
    expect(eventAllowed("$autocapture", basic, "basic")).toBe(false);
    expect(eventAllowed("$autocapture", full, "full")).toBe(true);
    expect(eventAllowed("$identify", basic, "basic")).toBe(false);
    expect(eventAllowed("card copied", basic, "basic")).toBe(true);
    expect(eventAllowed("$opt_in", basic, "basic")).toBe(false);
    expect(eventAllowed("$opt_in", full, "full")).toBe(true);
    expect(eventAllowed("$exception", full, "full")).toBe(false);
  });

  test("gives PostHog the whole address only for the city, and the start of it for the country", () => {
    const full = featuresAt(TELL, "full");
    const basic = featuresAt(TELL, "basic");
    expect(addressFor("203.0.113.9", full)).toBe("203.0.113.9");
    expect(addressFor("203.0.113.9", basic)).toBe("203.0.113.0");
    expect(addressFor("2001:db8:85a3:8d3:1319:8a2e:370:7348", basic)).toBe("2001:db8:85a3::");
    expect(addressFor("2001:db8::1", basic)).toBe("2001:db8:0::");
    expect(addressFor("203.0.113.9", new Set())).toBeNull();
    expect(addressFor("local", full)).toBeNull();
  });

  test("reads a visitor from a request's country, cookie and signals", () => {
    expect(cookieValue("a=1; commitscape.analytics=all; b=2", "commitscape.analytics")).toBe("all");
    const v = visitorOf(new Headers({ "cf-ipcountry": "IN", cookie: "commitscape.analytics=all" }), "cf-ipcountry");
    expect(v).toMatchObject({ choice: "all", level: "full" });
    expect(v.region.id).toBe("ask");
    expect(visitorOf(new Headers({ "cf-ipcountry": "US", "sec-gpc": "1" }), "cf-ipcountry").level).toBe("basic");
    expect(visitorOf(null, "cf-ipcountry").level).toBe("basic");
  });
});

describe("the choice's cookie", () => {
  test("is shared by the app and its landing page under their parent domain, and kept to one host otherwise", () => {
    expect(sharedCookieDomain("app.commitscape.com", "commitscape.com")).toBe("commitscape.com");
    expect(sharedCookieDomain("commitscape.com", "app.commitscape.com")).toBe("commitscape.com");
    expect(sharedCookieDomain("app.commitscape.com", "example.org")).toBeNull();
    expect(sharedCookieDomain("localhost", "localhost")).toBeNull();
    expect(sharedCookieDomain("10.0.0.1", "10.0.0.2")).toBeNull();
    expect(sharedCookieDomain("app.commitscape.com", undefined)).toBeNull();
    expect(consentCookie("all", "commitscape.com", true)).toBe("commitscape.analytics=all; path=/; max-age=31536000; samesite=lax; domain=commitscape.com; secure");
    expect(consentCookie("basic", null, false)).toBe("commitscape.analytics=basic; path=/; max-age=31536000; samesite=lax");
  });
});
