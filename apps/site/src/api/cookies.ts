/** Cookies, read and written the one way the Site uses them. */

export function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** A cookie for this Site only: `Secure` over HTTPS, never readable by scripts unless `readable`. */
export function setCookie(request: Request, name: string, value: string, seconds: number, readable = false): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${seconds}; SameSite=Lax${readable ? "" : "; HttpOnly"}${secure}`;
}

/**
 * Whether a request that changes something came from the Site's own pages:
 * its Origin, when a browser sends one, is the Site's.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}
