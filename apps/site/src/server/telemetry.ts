import "@tanstack/react-start/server-only";
import * as Sentry from "@sentry/tanstackstart-react";

declare const __ROUTES__: string[] | undefined;

export const ROUTES: readonly string[] = typeof __ROUTES__ === "undefined" ? [] : __ROUTES__;

export const SERVER_FN_ROUTE = "/_serverFn";

export type EngineOutcome = "ok" | "no_answer" | "no_pack" | "refused" | "failed" | "timeout" | "unreachable";

export type AnswerSource = "engine" | "report" | "stored" | "unchanged";

type Scored = { route: string; literal: number; length: number; splat: boolean };

function scoreOf(route: string, parts: string[]): Scored | null {
  const pattern = route.split("/").filter(Boolean);
  let literal = 0;
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i] ?? "";
    if (want === "$") return parts.length > i ? { route, literal, length: pattern.length, splat: true } : null;
    const got = parts[i];
    if (got === undefined) return null;
    if (want.startsWith("$")) continue;
    if (want !== got) return null;
    literal++;
  }
  return parts.length === pattern.length ? { route, literal, length: pattern.length, splat: false } : null;
}

/** The route pattern of the Site that serves a path, as TanStack Router names it (`/api/reports/$owner/$repo/answer`): the most literal match, a splat (`$`) only when nothing else matches. Null when no route does. */
export function routeOf(path: string, routes: readonly string[] = ROUTES): string | null {
  const parts = path.split("/").filter(Boolean);
  let best: Scored | null = null;
  for (const route of routes) {
    const s = scoreOf(route.replace(/\/$/, "") || "/", parts);
    if (!s) continue;
    if (!best || Number(best.splat) - Number(s.splat) > 0 || (best.splat === s.splat && (s.literal > best.literal || (s.literal === best.literal && s.length > best.length)))) best = s;
  }
  return best?.route ?? null;
}

const fnRequests = new WeakSet<Sentry.Span>();

function nameRoot(name: string, route: string): Sentry.Span | null {
  const active = Sentry.getActiveSpan();
  if (!active) return null;
  const root = Sentry.getRootSpan(active);
  Sentry.updateSpanName(root, name);
  root.setAttribute("http.route", route);
  root.setAttribute("sentry.segment.name.source", "route");
  Sentry.getCurrentScope().setTransactionName(name);
  return root;
}

/** Names the request's Sentry transaction after the route that serves it (`GET /api/reports/$owner/$repo/answer`), a server function's as `/_serverFn` until the function is known; the route, or null when none serves the path. */
export function nameRequest(request: Request, fnBase: string, routes: readonly string[] = ROUTES): string | null {
  const { pathname } = new URL(request.url);
  const route = pathname.startsWith(fnBase) ? SERVER_FN_ROUTE : routeOf(pathname, routes);
  const root = route ? nameRoot(`${request.method} ${route}`, route) : null;
  if (root && route === SERVER_FN_ROUTE) fnRequests.add(root);
  return route;
}

/** Names a server function's request after the function (`POST /_serverFn/getViewer`); does nothing when the function runs inside a page being drawn. */
export function nameServerFn(method: string, name: string | undefined): void {
  const active = Sentry.getActiveSpan();
  if (!active || !name) return;
  if (!fnRequests.has(Sentry.getRootSpan(active))) return;
  nameRoot(`${method} ${SERVER_FN_ROUTE}/${name}`, `${SERVER_FN_ROUTE}/${name}`);
}

/** Records how long one request to the engine service took, by endpoint and how it ended. */
export function engineTimed(endpoint: string, outcome: EngineOutcome, ms: number): void {
  Sentry.metrics.distribution("engine.latency", ms, { unit: "millisecond", attributes: { endpoint, outcome } });
}

/** An engine service request that failed: its endpoint, its pack and how it failed. */
export class EngineError extends Error {
  readonly endpoint: string;
  readonly pack: string | null;
  readonly outcome: EngineOutcome;
  readonly status: number | null;
  constructor(endpoint: string, pack: string | null, outcome: EngineOutcome, status: number | null, detail: string) {
    super(`engine ${endpoint}: ${outcome}${status === null ? "" : ` ${status}`}${detail ? `: ${detail}` : ""}`);
    this.name = "EngineError";
    this.endpoint = endpoint;
    this.pack = pack;
    this.outcome = outcome;
    this.status = status;
  }
}

/** Reports an engine service failure or timeout to Sentry with its endpoint and pack key, grouped by endpoint and how it failed, and logs it. */
export function engineFailed(error: EngineError, ms: number): void {
  console.error(error.message);
  Sentry.captureException(error, {
    level: "error",
    tags: { "engine.endpoint": error.endpoint, "engine.outcome": error.outcome },
    contexts: { engine: { endpoint: error.endpoint, pack: error.pack, outcome: error.outcome, status: error.status, ms: Math.round(ms) } },
    fingerprint: ["engine", error.endpoint, error.outcome],
  });
}

/** Counts one lookup in the Site's cache of packed answers and files, kept or made. */
export function cacheLooked(kept: boolean, kind: string): void {
  Sentry.metrics.count("answer.cache", 1, { attributes: { result: kept ? "hit" : "miss", kind } });
}

/** Records how long the Site took to give a screen its answer, by the Data Source path and where the answer came from. */
export function answerTimed(path: string, source: AnswerSource, ms: number): void {
  Sentry.metrics.distribution("answer.duration", ms, { unit: "millisecond", attributes: { path, source } });
}
