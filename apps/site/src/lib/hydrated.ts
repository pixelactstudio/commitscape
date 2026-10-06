import { useSyncExternalStore } from "react";

const nothing = () => () => {};

/** False while the server's page is being hydrated, true after. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    nothing,
    () => true,
    () => false,
  );
}
