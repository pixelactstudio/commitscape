/**
 * Keyboard shortcuts, as npmx.dev has them: single keys that act at once,
 * off while typing in a field, and shown on screen next to what they do.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

export type Shortcuts = Record<string, (e: KeyboardEvent) => void>;

/** Whether a key press belongs to a field someone is typing in. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(type);
}

/**
 * Runs `shortcuts[key]` for a key pressed anywhere but in a field. `mod+k`
 * is ⌘K on a Mac and Ctrl+K elsewhere, and works in fields too.
 */
export function useShortcuts(shortcuts: Shortcuts) {
  const current = useRef(shortcuts);
  useLayoutEffect(() => {
    current.current = shortcuts;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        const run = current.current["mod+k"];
        if (run) {
          e.preventDefault();
          run(e);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const run = current.current[e.key];
      if (run) {
        e.preventDefault();
        run(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Every shortcut, in words, for the list `?` shows. */
export const SHORTCUT_WORDS: [string, string][] = [
  ["1–6", "Choose a screen"],
  ["mod+k", "Jump to a screen, a person, a folder or a file"],
  ["/", "Search: the commits on Commits, otherwise the same as ⌘K"],
  ["w", "The next Window: 30 days, 90 days, a year, all time"],
  ["shift+w", "The Window before"],
  ["?", "Show or hide this help, every number's explanation, and the keys"],
  ["escape", "Close what is open"],
];
