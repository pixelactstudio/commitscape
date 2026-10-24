import { useCallback, useEffect, useState } from "react";

export const TABS_MAX = 12;

const keyOf = (repo: string) => `commitscape.code.tabs:${repo.toLowerCase()}`;

/** The open files after one was shown: added at the end when new, the oldest dropped past the most kept, the one shown never dropped. */
export function withTab(tabs: readonly string[], path: string, max = TABS_MAX): string[] {
  if (tabs.includes(path)) return [...tabs];
  const next = [...tabs, path];
  while (next.length > max) next.splice(next[0] === path ? 1 : 0, 1);
  return next;
}

/** The open files after one was closed, and the one to show instead when it was the one shown: its right neighbour, else its left, else none. */
export function withoutTab(tabs: readonly string[], path: string, shown: string): { tabs: string[]; next: string | null } {
  const at = tabs.indexOf(path);
  const left = tabs.filter((t) => t !== path);
  if (path !== shown || at < 0) return { tabs: left, next: null };
  return { tabs: left, next: left[at] ?? left[at - 1] ?? null };
}

function read(repo: string): string[] {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(keyOf(repo)) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").slice(-TABS_MAX) : [];
  } catch {
    return [];
  }
}

/** The files open in the Code window for one repository, kept for the browser tab's session; the file shown is always among them. */
export function useTabs(repo: string, shown: string | null) {
  const [tabs, setTabs] = useState<string[]>(() => (shown ? [shown] : []));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTabs((now) => now.reduce((all, t) => withTab(all, t), read(repo)));
    setReady(true);
  }, [repo]);
  useEffect(() => {
    if (shown) setTabs((now) => withTab(now, shown));
  }, [shown]);
  useEffect(() => {
    if (!ready) return;
    try {
      window.sessionStorage.setItem(keyOf(repo), JSON.stringify(tabs));
    } catch {
      return;
    }
  }, [tabs, repo, ready]);
  const close = useCallback(
    (path: string): string | null => {
      const done = withoutTab(tabs, path, shown ?? "");
      setTabs(done.tabs);
      return done.next;
    },
    [tabs, shown],
  );
  return { tabs, close };
}
