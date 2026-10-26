import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { analyticsId, doNotTrack } from "@commitscape/server";

export type Moment = "signed in" | "build requested" | "repository page served" | "profile served";

export type MomentProperties = Record<string, string | number | boolean | null>;

export type Counter = { capture: (event: { distinctId: string; event: string; properties: Record<string, unknown> }) => void; shutdown: (ms?: number) => Promise<void> };

export type AnalyticsOptions = { counter: Counter | null; secret: string | undefined; onceFor?: number };

const ONCE_FOR = 10 * 60_000;
const ONCE_KEPT = 10_000;

/** The product's moments as PostHog server events: never for a request that asks not to be tracked, the person known only by a keyed hash of their account id (a fresh id each time when the Site has no secret), and no person profiles. */
export function analytics({ counter, secret, onceFor = ONCE_FOR }: AnalyticsOptions) {
  const seen = new Map<string, number>();
  return {
    /** Counts one moment; with `once`, at most once per key in ten minutes, so a page polled while a Build runs counts as one view. */
    capture(moment: Moment, who: { userId: string | null; headers?: Headers | null }, properties: MomentProperties = {}, once?: string): void {
      if (!counter || doNotTrack(who.headers)) return;
      const distinctId = who.userId && secret ? analyticsId(who.userId, secret) : randomUUID();
      if (once !== undefined) {
        const key = `${who.userId ?? ""}\n${moment}\n${once}`;
        const at = Date.now();
        if ((seen.get(key) ?? 0) > at - onceFor) return;
        if (seen.size >= ONCE_KEPT) seen.clear();
        seen.set(key, at);
      }
      counter.capture({ distinctId, event: moment, properties: { ...properties, $process_person_profile: false } });
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
