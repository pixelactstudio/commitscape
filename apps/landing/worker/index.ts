import { visitorOf } from "@commitscape/data/analytics";
import { INGEST, ingest } from "@commitscape/data/posthog";
import { SETTINGS_GLOBAL, type LandingSettings } from "../src/settings";

export type Env = { ASSETS: Fetcher; POSTHOG_KEY?: string; POSTHOG_HOST?: string };

const DEFAULT_HOST = "https://us.i.posthog.com";
const CONDITIONAL = ["if-none-match", "if-modified-since"];

/** The analytics settings for one visitor: the project key, their region from Cloudflare's country, their stored choice and the level those give. */
export function settingsFor(headers: Headers, key: string): LandingSettings {
  const visitor = visitorOf(headers, "cf-ipcountry");
  return { key, region: visitor.region.id, choice: visitor.choice, level: visitor.level };
}

/** The page with a visitor's analytics settings written into its head, for its script to read before PostHog starts. */
export function withSettings(html: string, settings: LandingSettings): string {
  const script = `<script>window.${SETTINGS_GLOBAL}=${JSON.stringify(settings).replaceAll("<", "\\u003c")}</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${script}</head>`) : html;
}

async function page(request: Request, env: Env, key: string): Promise<Response> {
  const asked = new Headers(request.headers);
  for (const h of CONDITIONAL) asked.delete(h);
  const stored = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers: asked }));
  if (!stored.ok || !stored.headers.get("content-type")?.includes("text/html")) return stored;
  const headers = new Headers(stored.headers);
  for (const h of ["content-length", "etag", "last-modified"]) headers.delete(h);
  headers.set("cache-control", "private, no-cache");
  headers.set("vary", "cookie");
  const body = request.method === "HEAD" ? null : withSettings(await stored.text(), settingsFor(request.headers, key));
  return new Response(body, { status: stored.status, headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const key = env.POSTHOG_KEY?.trim();
    if (pathname.startsWith(`${INGEST}/`)) return key ? ingest(request, { apiHost: env.POSTHOG_HOST?.trim() || DEFAULT_HOST, countryHeader: "cf-ipcountry", addressHeader: "x-forwarded-for" }) : new Response(null, { status: 404 });
    if (!key) return env.ASSETS.fetch(request);
    return page(request, env, key);
  },
} satisfies ExportedHandler<Env>;
