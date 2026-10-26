export const SIGN_IN = "/sign-in";

export const HOME = "/dashboard";

const OPEN_PAGES = [/^\/sign-in\/?$/, /^\/privacy\/?$/, /^\/s\/[^/]+\/?$/, /^\/u\/[^/]+\/work\/[^/]+\/?$/];

/** Whether a page opens without signing in: signing in itself, what we keep, a Shared Report and a shared Proof of Work. */
export function isOpenPage(path: string): boolean {
  return OPEN_PAGES.some((p) => p.test(path));
}

/** Where to send someone once they have signed in: a page of this Site they asked for, else the dashboard; never another site, never the sign-in page again. */
export function returnTo(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return HOME;
  const path = next.split(/[?#]/)[0] ?? "";
  if (path === "/" || path === SIGN_IN || path.startsWith(`${SIGN_IN}/`) || path.startsWith("/api/")) return HOME;
  return next;
}

/** The sign-in page's address that comes back to `next` afterwards. */
export function signInFor(next: string): string {
  const back = returnTo(next);
  return back === HOME ? SIGN_IN : `${SIGN_IN}?${new URLSearchParams({ next: back })}`;
}
