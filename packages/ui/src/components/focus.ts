import { useEffect, useRef } from "react";

/** The page's own heading: the first h1 in the main area, else the first on the page. */
export function pageHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("h1");
}

/** Moves focus to the page's own heading, so a keyboard or screen-reader user starts at the top of what opened. */
export function focusHeading(): void {
  const heading = pageHeading();
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus();
}

/** Moves focus to the page's heading when the screen changes, so a keyboard or screen-reader user starts at the top of what opened, not in what they left. */
export function useFocusHeading(screen: string): void {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = screen;
    if (before === null || before === screen) return;
    focusHeading();
  }, [screen]);
}

/** Moves focus to what `target` returns each time `key` changes after the first render, for a view that replaces another on the same screen. */
export function useFocusOnChange(key: unknown, target: () => HTMLElement | null): void {
  const seen = useRef(key);
  useEffect(() => {
    if (Object.is(seen.current, key)) return;
    seen.current = key;
    target()?.focus();
  }, [key, target]);
}
