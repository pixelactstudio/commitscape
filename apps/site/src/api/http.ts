/** Answers the API gives, all alike: JSON or plain words, never cached unless said. */

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/** A plain message, for a person to read. */
export function says(status: number, words: string): Response {
  return json({ error: words }, status);
}

/**
 * The address a request came from, as Cloudflare saw it, for rate limits.
 * An IPv6 address is taken as its /64: one connection is usually given a
 * whole /64, and counting each of its addresses apart would let it past
 * every limit.
 */
export function address(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** Now, in seconds since the epoch. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Hex of SHA-256. */
export async function sha256(text: string | Uint8Array): Promise<string> {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
