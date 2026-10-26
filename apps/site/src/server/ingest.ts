import "@tanstack/react-start/server-only";
import { addressFor, visitorOf } from "#/lib/analytics-config";
import { assetsHostOf, INGEST } from "#/lib/posthog-hosts";
import { visitorAddress } from "./http";

const BODY_MAX = 2 * 1024 * 1024;
const TIMEOUT = 10_000;

const DROPPED_REQUEST = new Set(["cookie", "authorization", "host", "connection", "keep-alive", "transfer-encoding", "content-length", "forwarded", "x-real-ip", "true-client-ip", "via", "origin", "referer"]);
const DROPPED_RESPONSE = new Set(["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

const dropped = (name: string, set: Set<string>) => set.has(name) || name.startsWith("x-forwarded-") || name.startsWith("cf-");

/** Where a request under `/ingest` goes at PostHog: scripts and remote settings to its assets host, everything else to its API host. */
export function ingestTarget(url: URL, apiHost: string): string | null {
  if (!url.pathname.startsWith(`${INGEST}/`)) return null;
  const rest = url.pathname.slice(INGEST.length);
  const host = rest.startsWith("/static/") || rest.startsWith("/array/") ? assetsHostOf(apiHost) : new URL(apiHost).origin;
  return `${host}${rest}${url.search}`;
}

export type IngestOptions = { apiHost: string; countryHeader: string; addressHeader: string };

/** Passes a request from the Site's pages to PostHog and its answer back, without the visitor's cookies or sign-in, and with only as much of their address as their choice allows, so blockers that drop requests to PostHog's own hosts leave the Site's counts alone. */
export async function ingest(request: Request, { apiHost, countryHeader, addressHeader }: IngestOptions, fetcher: typeof fetch = fetch): Promise<Response> {
  const target = ingestTarget(new URL(request.url), apiHost);
  if (!target) return new Response(null, { status: 404 });
  if (!["GET", "HEAD", "POST", "OPTIONS"].includes(request.method)) return new Response(null, { status: 405 });
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!dropped(name, DROPPED_REQUEST)) headers.set(name, value);
  });
  const address = addressFor(visitorAddress(request.headers, addressHeader), visitorOf(request.headers, countryHeader).features);
  if (address) headers.set("x-forwarded-for", address);
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return new Response(null, { status: 413 });
    body = await request.arrayBuffer();
    if (body.byteLength > BODY_MAX) return new Response(null, { status: 413 });
  }
  const answered = await fetcher(target, { method: request.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  if (!answered) return new Response(null, { status: 502 });
  const back = new Headers();
  answered.headers.forEach((value, name) => {
    if (!dropped(name, DROPPED_RESPONSE)) back.set(name, value);
  });
  return new Response(request.method === "HEAD" ? null : await answered.arrayBuffer(), { status: answered.status, headers: back });
}
