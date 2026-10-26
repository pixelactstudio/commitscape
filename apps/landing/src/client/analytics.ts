import type { CaptureResult, CapturedNetworkRequest, PostHog } from "posthog-js";
import { consentCookie, eventAllowed, featuresAt, levelOf, MASKED_TEXT, regionById, sharedCookieDomain, type Choice, type Level, type Region } from "@commitscape/data/analytics";
import { INGEST } from "@commitscape/data/posthog";
import { APP_URL } from "../env";
import { SETTINGS_GLOBAL, type LandingSettings } from "../settings";

declare global {
  interface Window {
    [SETTINGS_GLOBAL]?: LandingSettings;
  }
}

type Moment = Record<string, string | number | boolean | null>;

let client: PostHog | null = null;
let region: Region | null = null;
let level: Level = "basic";
const waiting: [string, Moment][] = [];

const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-posthog-.*)$/i;

function gate(e: CaptureResult | null): CaptureResult | null {
  if (!e || !region) return e;
  if (!eventAllowed(e.event, featuresAt(region, level), level)) return null;
  e.properties = { ...e.properties, app: "landing", region: region.id, consent: level };
  return e;
}

function scrub(r: CapturedNetworkRequest): CapturedNetworkRequest | null {
  if (r.name.includes(`${INGEST}/`)) return null;
  const keep = (h: CapturedNetworkRequest["requestHeaders"]) => h && Object.fromEntries(Object.entries(h).filter(([name]) => !SECRET_HEADER.test(name)));
  return { ...r, requestHeaders: keep(r.requestHeaders), responseHeaders: keep(r.responseHeaders), requestBody: null, responseBody: null };
}

function apply(next: Level): void {
  level = next;
  if (!client) return;
  if (next === "full") {
    if (client.get_explicit_consent_status() !== "granted") client.opt_in_capturing({ captureEventName: false });
  } else if (client.get_explicit_consent_status() === "granted") client.opt_out_capturing();
}

/** Sends one of the landing page's moments, once PostHog has started, when the visitor's choice allows it. */
export function track(event: string, properties: Moment = {}): void {
  if (client) client.capture(event, properties, { transport: "sendBeacon" });
  else if (window[SETTINGS_GLOBAL]?.key) waiting.push([event, properties]);
}

function choose(choice: Choice, banner: HTMLElement): void {
  if (!region) return;
  const secure = window.location.protocol === "https:";
  document.cookie = consentCookie(choice, sharedCookieDomain(window.location.hostname, new URL(APP_URL).hostname), secure);
  apply(levelOf(region, choice, false));
  track("analytics choice made", { choice, region: region.id });
  banner.hidden = true;
}

function showBanner(): void {
  const banner = document.querySelector<HTMLElement>("[data-consent]");
  if (!banner || !region) return;
  banner.querySelectorAll<HTMLElement>("[data-consent-words]").forEach((w) => {
    w.hidden = w.dataset.consentWords !== region?.before;
  });
  banner.addEventListener("click", (e) => {
    const choice = (e.target as Element).closest<HTMLElement>("[data-consent-choice]")?.dataset.consentChoice;
    if (choice === "all" || choice === "basic") choose(choice, banner);
  });
  banner.hidden = false;
}

/** Runs PostHog for the visitor at the level their region and choice allow, with the settings the Worker wrote into the page, and shows the choice to a visitor who has not made it. */
export async function startAnalytics(): Promise<void> {
  const settings = window[SETTINGS_GLOBAL];
  if (!settings?.key || client) return;
  region = regionById(settings.region);
  level = settings.level;
  if (settings.choice === null) showBanner();
  const can = featuresAt(region, "full");
  const { default: posthog } = await import("posthog-js");
  posthog.init(settings.key, {
    api_host: INGEST,
    defaults: "2025-11-30",
    capture_pageview: true,
    capture_pageleave: true,
    person_profiles: "identified_only",
    cookieless_mode: "on_reject",
    opt_out_capturing_by_default: true,
    respect_dnt: false,
    autocapture: can.has("autocapture") ? { capture_copied_text: true } : false,
    rageclick: can.has("rageclicks"),
    capture_dead_clicks: can.has("deadclicks"),
    capture_heatmaps: can.has("heatmaps"),
    capture_performance: { web_vitals: can.has("webVitals"), network_timing: can.has("replayNetwork") },
    capture_exceptions: false,
    disable_session_recording: !can.has("replay"),
    enable_recording_console_log: can.has("replayConsole"),
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: MASKED_TEXT,
      recordHeaders: can.has("replayNetwork"),
      recordBody: false,
      maskCapturedNetworkRequestFn: scrub,
      captureCanvas: { recordCanvas: can.has("replayCanvas"), canvasFps: 4, canvasQuality: "0.4" },
    },
    disable_capture_url_hashes: true,
    disable_surveys: true,
    disable_product_tours: true,
    before_send: gate,
  });
  client = posthog;
  apply(level);
  for (const [event, properties] of waiting.splice(0)) track(event, properties);
}
