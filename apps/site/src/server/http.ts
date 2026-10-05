import "@tanstack/react-start/server-only";

export class SiteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export function says(status: number, words: string): Response {
  return json({ error: words }, status);
}

export async function answer(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof SiteError) return says(e.status, e.message);
    throw e;
  }
}

/** The visitor's address from the proxy's header; an IPv6 address counts as its /64. */
export function clientAddress(request: Request, header: string): string {
  const raw = request.headers.get("cf-connecting-ip") ?? request.headers.get(header)?.split(",")[0]?.trim() ?? "local";
  if (!raw.includes(":")) return raw;
  const [head = "", tail = ""] = raw.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = raw.includes("::") && tail ? tail.split(":") : [];
  const groups = raw.includes("::") ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** Whether a request comes from the Site's own pages: its Origin is the public address the Site is served at, or the address the request itself was sent to. */
export function sameOrigin(request: Request, site: string): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (origin === new URL(site).origin) return true;
  try {
    const from = new URL(origin);
    const to = new URL(request.url);
    return from.host === (request.headers.get("host") ?? to.host) && from.protocol === to.protocol;
  } catch {
    return false;
  }
}
