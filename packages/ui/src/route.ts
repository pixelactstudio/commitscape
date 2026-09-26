/**
 * Where the page is, kept in the address's `#`, so the back button, a
 * reload and a copied link all keep it: the screen, the Window or date
 * range, the filters, and what is open on the screen.
 */
import { useCallback, useEffect, useState } from "react";
import type { Params } from "@commitscape/data";
import type { Meta } from "@commitscape/data";

export const SCREENS = ["overview", "activity", "people", "map", "risk", "commits"] as const;
export type Screen = (typeof SCREENS)[number];

export const TITLES: Record<Screen, string> = {
  overview: "Overview",
  activity: "Activity",
  people: "People",
  map: "Map",
  risk: "Risk",
  commits: "Commits",
};

export type Route = {
  screen: Screen;
  window?: string;
  /** A date range, as days since the epoch, in place of the Window. */
  from?: number;
  to?: number;
  /** Filters: one person, one folder. */
  person?: number;
  folder?: string;
  /** A person's profile, on People. */
  id?: number;
  /** The Map's folder, and the file chosen on it or on Risk. */
  path?: string;
  file?: string;
  /** What is searched for on Commits. */
  q?: string;
};

const NUMBERS = ["from", "to", "person", "id"] as const;
const TEXTS = ["window", "folder", "path", "file", "q"] as const;

export function parse(hash: string): Route {
  const [where, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const screen = (SCREENS as readonly string[]).includes(where ?? "")
    ? (where as Screen)
    : "overview";
  const params = new URLSearchParams(query);
  const route: Route = { screen };
  for (const k of NUMBERS) {
    const v = params.get(k);
    if (v !== null && v !== "" && Number.isFinite(Number(v))) route[k] = Number(v);
  }
  for (const k of TEXTS) {
    const v = params.get(k);
    if (v !== null && v !== "") route[k] = v;
  }
  return route;
}

export function format(route: Route): string {
  const params = new URLSearchParams();
  for (const k of [...TEXTS, ...NUMBERS]) {
    const v = route[k];
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const query = params.toString();
  return `#/${route.screen}${query ? `?${query}` : ""}`;
}

/** The route now, and a way to change part of it. */
export function useRoute(): [Route, (change: Partial<Route>, replace?: boolean) => void] {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((change: Partial<Route>, replace = false) => {
    const next = format({ ...parse(window.location.hash), ...change });
    if (replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
    setRoute(parse(next));
  }, []);
  return [route, go];
}

const DAY = 86_400;

/** What the API is asked, from where the page is. */
export function paramsOf(route: Route, meta: Meta): Params {
  if (route.from !== undefined || route.to !== undefined) {
    return {
      from: route.from === undefined ? undefined : route.from * DAY,
      to: route.to === undefined ? undefined : (route.to + 1) * DAY - 1,
      person: route.person,
      folder: route.folder,
    };
  }
  return { window: route.window ?? meta.window, person: route.person, folder: route.folder };
}
