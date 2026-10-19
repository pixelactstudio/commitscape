import { useSyncExternalStore } from "react";

const never = () => () => {};

/** False while the server draws the page and until the browser has taken it over, true after: for what can only be measured in a browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false);
}
