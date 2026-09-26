/**
 * A Shared Report's key, taken from the link's fragment and removed from
 * the address bar before anything renders (ADR-0016): browsers never send
 * the fragment, and once it is gone no screenshot, history entry or copied
 * address carries it either. Kept only in this module, for the page.
 */
import { keyOf } from "@commitscape/data";

let key: Uint8Array | null = null;

if (typeof window !== "undefined" && window.location.pathname.startsWith("/s/") && window.location.hash) {
  key = keyOf(window.location.hash);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** The key the page was opened with, if it had one. */
export function shareKey(): Uint8Array | null {
  return key;
}
