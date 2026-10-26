import "@tanstack/react-start/server-only";
import { HOME, isOpenPage, returnTo, SIGN_IN, signInFor } from "#/lib/access";

const OPEN_API = [/^\/api\/cards\//, /^\/api\/shares(\/|$)/, /^\/api\/work\/s\//, /^\/api\/auth(\/|$)/, /^\/api\/health$/, /^\/api\/github\/webhooks$/, /^\/api\/telemetry$/];

const OPEN_FILES = [/^\/assets\//, /^\/fonts\//, /^\/favicon\.svg$/, /^\/robots\.txt$/, /^\/mcp$/, /^\/ingest\//];

export const SIGN_IN_WORDS = "Sign in with GitHub to use commitscape.";

export type GateOptions = {
  fnBase: string;
  openFns: ReadonlySet<string>;
  landing?: string;
  signedIn: () => Promise<boolean>;
};

export type Access = { kind: "open" } | { kind: "redirect"; to: string } | { kind: "refuse"; as: "json" | "text" };

const OPEN: Access = { kind: "open" };

/** What a request may do: Cards, Shared Reports, shared Proof of Work, signing in, health, webhooks, the command's usage counts, files and the counting PostHog does through the Site are open; anything else needs a session, so a page sends someone signed out to sign in and back, and the API and server functions answer 401. */
export async function accessOf(url: URL, method: string, options: GateOptions): Promise<Access> {
  const path = url.pathname;
  const reading = method === "GET" || method === "HEAD";
  if (OPEN_FILES.some((p) => p.test(path))) return OPEN;
  if (path.startsWith("/api/")) return OPEN_API.some((p) => p.test(path)) || (await options.signedIn()) ? OPEN : { kind: "refuse", as: "json" };
  if (path.startsWith(options.fnBase)) return options.openFns.has(path) || (await options.signedIn()) ? OPEN : { kind: "refuse", as: "text" };
  if (path === "/" && reading) return { kind: "redirect", to: (await options.signedIn()) ? HOME : (options.landing ?? SIGN_IN) };
  if (path === SIGN_IN && reading && (await options.signedIn())) return { kind: "redirect", to: returnTo(url.searchParams.get("next")) };
  if (isOpenPage(path) || (await options.signedIn())) return OPEN;
  return reading ? { kind: "redirect", to: signInFor(`${path}${url.search}`) } : { kind: "refuse", as: "json" };
}

/** The answer for a request the gate stops, or null when it may go on. */
export async function gate(request: Request, options: GateOptions): Promise<Response | null> {
  const access = await accessOf(new URL(request.url), request.method, options);
  const headers = { "cache-control": "no-store", vary: "cookie" };
  if (access.kind === "open") return null;
  if (access.kind === "redirect") return new Response(null, { status: 302, headers: { ...headers, location: access.to } });
  if (access.as === "text") return new Response(SIGN_IN_WORDS, { status: 401, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
  return new Response(JSON.stringify({ error: SIGN_IN_WORDS }), { status: 401, headers: { ...headers, "content-type": "application/json" } });
}
