import * as Sentry from "@sentry/node";
import { PostHog } from "posthog-node";
import { analyticsId, type BuildJob } from "@commitscape/server";
import type { EngineEvent } from "./engine";

export type Who = { userId?: string | null | undefined; repo: string };

export type Telemetry = {
  capture: (event: string, who: Who, properties: Record<string, unknown>) => void;
  stop: () => Promise<void>;
};

export type TelemetryConfig = { sentryDsn?: string | undefined; environment: string; tracesSampleRate: number; posthogKey?: string | undefined; posthogHost: string; analyticsSecret?: string | undefined };

type Attribute = string | number | boolean;

/** Who an event is about, as PostHog may know it: a keyed hash of the person who asked for the Build, else the repository; never an account id or a login. */
export function distinctIdOf(who: Who, secret: string | undefined): string {
  return who.userId && secret ? analyticsId(who.userId, secret) : `repo:${who.repo}`;
}

/** Starts Sentry (errors, traces, logs and metrics) and one PostHog client when their keys are set; without them every call does nothing. The Builder makes no person profiles: its events join the one the Site made for a person who allowed everything. */
export function startTelemetry(cfg: TelemetryConfig): Telemetry {
  if (cfg.sentryDsn) {
    Sentry.init({
      dsn: cfg.sentryDsn,
      environment: cfg.environment,
      tracesSampleRate: cfg.tracesSampleRate,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    });
  }
  const posthog = cfg.posthogKey ? new PostHog(cfg.posthogKey, { host: cfg.posthogHost }) : null;
  return {
    capture(event, who, properties) {
      posthog?.capture({ distinctId: distinctIdOf(who, cfg.analyticsSecret), event, properties: { ...properties, app: "builder", $process_person_profile: false } });
    },
    async stop() {
      await posthog?.shutdown().catch(() => undefined);
      await Sentry.close(2000).catch(() => false);
    },
  };
}

/** Writes one line to the Builder's log and to Sentry Logs, within the trace it was written in. */
export function log(line: string): void {
  console.log(line);
  Sentry.logger.info(line);
}

const rounded = (ms: number) => Math.round(ms / 100) / 10;

/** The seconds each step of one Build took, each step also a span of its own and a `build.phase` metric. */
export class Phases {
  kind: "cold" | "warm" = "cold";
  readonly seconds: Record<string, number> = {};

  /** Runs one step of the Build in a span and records how long it took. */
  async time<T>(name: string, op: string, fn: () => Promise<T>, attributes: Record<string, Attribute> = {}): Promise<T> {
    const started = performance.now();
    try {
      return await Sentry.startSpan({ name, op, attributes }, fn);
    } finally {
      const seconds = rounded(performance.now() - started);
      this.seconds[name] = Math.round(((this.seconds[name] ?? 0) + seconds) * 10) / 10;
      Sentry.metrics.distribution("build.phase", seconds, { unit: "second", attributes: { phase: name, kind: this.kind } });
    }
  }
}

function attributesOf(fields: Record<string, unknown>): Record<string, Attribute> {
  const out: Record<string, Attribute> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[`engine.${k}`] = v;
    else if (v !== null && v !== undefined) out[`engine.${k}`] = JSON.stringify(v);
  }
  return out;
}

/** Turns the engine's timing events into child spans of the active span, each with the start and end the engine recorded, nested as the engine's own spans were. */
export function engineSpans(events: EngineEvent[]): void {
  const parent = Sentry.getActiveSpan();
  if (!parent) return;
  const open: { span: Sentry.Span; end: number }[] = [];
  for (const e of [...events].sort((a, b) => a.start_ms - b.start_ms || b.end_ms - a.end_ms)) {
    while (open.length > 0 && (open.at(-1)?.end ?? 0) < e.end_ms) open.pop();
    const span = Sentry.startInactiveSpan({ name: e.span, op: `engine.${e.span}`, startTime: e.start_ms / 1000, parentSpan: open.at(-1)?.span ?? parent, attributes: attributesOf(e.fields) });
    span.end(e.end_ms / 1000);
    open.push({ span, end: e.end_ms });
  }
}

/** Runs one Build in a `queue.process` span, continuing the trace of the request that queued it, and records how long it waited in the queue. */
export function inQueueSpan<T>(job: { id: string; data: BuildJob }, queue: string, fn: () => Promise<T>): Promise<T> {
  const wait = job.data.queuedAt ? Math.max(0, Date.now() - job.data.queuedAt) : undefined;
  if (wait !== undefined) Sentry.metrics.distribution("build.queue_wait", wait / 1000, { unit: "second", attributes: { queue } });
  const attributes: Record<string, Attribute> = {
    "messaging.system": "pg-boss",
    "messaging.destination.name": queue,
    "messaging.message.id": job.id,
    "messaging.message.retry.count": (job.data.attempt ?? 1) - 1,
    ...(wait !== undefined ? { "messaging.message.receive.latency": wait } : {}),
  };
  const processed = () => Sentry.startSpan({ name: queue, op: "queue.process", forceTransaction: true, attributes }, fn);
  return job.data.trace ? Sentry.continueTrace({ sentryTrace: job.data.trace.sentryTrace, baggage: job.data.trace.baggage }, processed) : Sentry.startNewTrace(processed);
}

/** Runs a timer's work under a Sentry cron monitor, so a timer that stops or fails is noticed. */
export function monitored<T>(slug: string, minutes: number, fn: () => Promise<T>): Promise<T> {
  return Sentry.withMonitor(slug, fn, { schedule: { type: "interval", value: minutes, unit: "minute" }, checkinMargin: minutes, maxRuntime: 30, timezone: "Etc/UTC" });
}
