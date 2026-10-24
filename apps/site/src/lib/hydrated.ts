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

/** Whether a keyboard is at hand, so a box may take focus on arrival without raising a touch screen's keyboard over the page. */
export function mayTakeFocus(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
