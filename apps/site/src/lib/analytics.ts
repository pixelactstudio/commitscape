import posthog, { type CaptureResult, type CapturedNetworkRequest } from "posthog-js";
import { eventAllowed, featuresAt, MASKED_TEXT, type Level, type Region } from "#/lib/analytics-config";
import { publicEnv } from "#/lib/env";
import { INGEST, uiHostOf } from "#/lib/posthog-hosts";

export type Person = { id: string; login: string | null; name: string | null; image: string | null };

type Live = { region: Region; level: Level; signedIn: boolean };

let live: Live | null = null;
let identified: string | null = null;

export const UNRECORDED = /^\/s\//;
const SECRET_HEADER = /^(authorization|cookie|set-cookie|x-upload-token|x-delete-token|x-posthog-.*)$/i;

function gate(e: CaptureResult | null): CaptureResult | null {
  if (!e || !live) return e;
  if (!eventAllowed(e.event, featuresAt(live.region, live.level), live.level)) return null;
  e.properties = { ...e.properties, app: "site", region: live.region.id, consent: live.level, signed_in: live.signedIn };
  return e;
}

type Headers = NonNullable<CapturedNetworkRequest["requestHeaders"]>;

function scrubbed(headers: Headers | undefined): Headers | undefined {
  return headers && Object.fromEntries(Object.entries(headers).filter(([name]) => !SECRET_HEADER.test(name)));
}

function scrub(r: CapturedNetworkRequest): CapturedNetworkRequest | null {
  if (r.name.includes(`${INGEST}/`)) return null;
  return { ...r, requestHeaders: scrubbed(r.requestHeaders), responseHeaders: scrubbed(r.responseHeaders), requestBody: null, responseBody: null };
}

/** Starts PostHog once, with every feature the region allows at full; what runs before the visitor allows it is held back by the consent state and `before_send`. */
export function startAnalytics(region: Region, level: Level, signedIn: boolean): void {
  const key = publicEnv.PUBLIC_POSTHOG_KEY;
  if (!key || live) return;
  live = { region, level, signedIn };
  const can = featuresAt(region, "full");
  posthog.init(key, {
    api_host: INGEST,
    ui_host: uiHostOf(publicEnv.PUBLIC_POSTHOG_HOST),
    defaults: "2025-11-30",
    capture_pageview: "history_change",
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
    disable_session_recording: !can.has("replay") || UNRECORDED.test(window.location.pathname),
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
    tracing_headers: [window.location.hostname],
    before_send: gate,
  });
}

/** Whether PostHog runs and records sessions at this level in the visitor's region. */
export function recording(level: Level): boolean {
  return live !== null && level === "full" && featuresAt(live.region, "full").has("replay");
}

/** Puts PostHog at a level: opted in with the person identified at full, cookieless at basic. */
export function applyLevel(level: Level, person: Person | null): void {
  if (!live) return;
  live.level = level;
  live.signedIn = person !== null;
  if (level === "full") {
    if (posthog.get_explicit_consent_status() !== "granted") posthog.opt_in_capturing({ captureEventName: false });
    if (person && identified !== person.id && featuresAt(live.region, "full").has("person")) {
      posthog.identify(person.id, { login: person.login, name: person.name, avatar: person.image }, { first_region: live.region.id });
      identified = person.id;
    }
  } else if (posthog.get_explicit_consent_status() === "granted") {
    posthog.opt_out_capturing();
    identified = null;
  }
}

/** Sends one of the Site's own moments from the browser, when PostHog is running and the visitor's choice allows it. */
export function track(event: string, properties: Record<string, string | number | boolean | null> = {}): void {
  if (live) posthog.capture(event, properties);
}

/** Counts signing out and forgets the person, so the next visitor in this browser starts anew. */
export function forgetPerson(): void {
  if (!live) return;
  track("signed out");
  if (identified) posthog.reset();
  identified = null;
  live.signedIn = false;
}
