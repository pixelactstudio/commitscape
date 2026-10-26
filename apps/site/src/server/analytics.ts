import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { analyticsId } from "@commitscape/server";
import { addressFor, visitorOf } from "@commitscape/data/analytics";
import { visitorAddress } from "@commitscape/data/posthog";

export type Moment =
  | "signed in"
  | "build requested"
  | "repository page served"
  | "profile served"
  | "data deleted"
  | "app installed"
  | "app removed"
  | "card served"
  | "share created"
  | "share opened"
  | "share deleted"
  | "cli command run";

export type MomentProperties = Record<string, string | number | boolean | null>;

export type Counter = { capture: (event: { distinctId: string; event: string; properties: Record<string, unknown>; disableGeoip?: boolean }) => void; shutdown: (ms?: number) => Promise<void> };

export type AnalyticsOptions = { counter: Counter | null; secret: string | undefined; countryHeader?: string; addressHeader?: string; onceFor?: number };

export type Who = { userId: string | null; headers?: Headers | null; distinctId?: string };

const ONCE_FOR = 10 * 60_000;
const ONCE_KEPT = 10_000;
const COOKIELESS = "$posthog_cookieless";

/** The product's moments as PostHog server events, at the level the visitor's region and choice allow: a signed-in person known by a keyed hash of their account id, the browser's own PostHog id and session when they allowed everything, and as much of their address as their country or city needs. */
export function analytics({ counter, secret, countryHeader = "cf-ipcountry", addressHeader = "x-forwarded-for", onceFor = ONCE_FOR }: AnalyticsOptions) {
  const seen = new Map<string, number>();
  return {
    /** Counts one moment; with `once`, at most once per key in ten minutes, so a page polled while a Build runs counts as one view. */
    capture(moment: Moment, who: Who, properties: MomentProperties = {}, once?: string): void {
      if (!counter) return;
      const visitor = visitorOf(who.headers, countryHeader);
      if (!visitor.features.has("moments")) return;
      const full = visitor.level === "full";
      const browser = full ? who.headers?.get("x-posthog-distinct-id") : null;
      const session = full ? who.headers?.get("x-posthog-session-id") : null;
      const known = !!who.userId && !!secret;
      const distinctId = who.distinctId ?? (who.userId && secret ? analyticsId(who.userId, secret) : browser && browser !== COOKIELESS ? browser : randomUUID());
      if (once !== undefined) {
        const key = `${who.userId ?? who.distinctId ?? ""}\n${moment}\n${once}`;
        const at = Date.now();
        if ((seen.get(key) ?? 0) > at - onceFor) return;
        if (seen.size >= ONCE_KEPT) seen.clear();
        seen.set(key, at);
      }
      const address = who.headers ? addressFor(visitorAddress(who.headers, addressHeader), visitor.features) : null;
      counter.capture({
        distinctId,
        event: moment,
        properties: {
          ...properties,
          app: "site",
          region: visitor.region.id,
          consent: visitor.level,
          $process_person_profile: full && known,
          ...(session ? { $session_id: session } : {}),
          ...(address ? { $ip: address } : {}),
        },
        disableGeoip: !address,
      });
    },
    /** Sends what is still queued. */
    stop: () => counter?.shutdown(2000) ?? Promise.resolve(),
  };
}

export type Analytics = ReturnType<typeof analytics>;

/** Shuts PostHog down when the process is asked to stop, then lets the signal do what it would have done. */
export function stopOnExit(a: Analytics): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void a.stop().finally(() => {
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    });
  }
  process.once("beforeExit", () => void a.stop());
}
