import { keyOf } from "@commitscape/data";

let key: Uint8Array | null = null;

if (typeof window !== "undefined" && window.location.pathname.startsWith("/s/") && window.location.hash) {
  key = keyOf(window.location.hash);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function shareKey(): Uint8Array | null {
  return key;
}
