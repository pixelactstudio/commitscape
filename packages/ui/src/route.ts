import type { Params } from "@commitscape/data";
import type { Meta } from "@commitscape/data";

export const SCREENS = ["overview", "people", "activity", "map", "commits"] as const;
export type Screen = (typeof SCREENS)[number];

export const TITLES: Record<Screen, string> = {
  overview: "Overview",
  activity: "Activity",
  people: "People",
  map: "Map",
  commits: "Commits",
};

export type Route = {
  screen: Screen;
  window?: string;
  from?: number;
  to?: number;
  person?: number;
  folder?: string;
  id?: number;
  path?: string;
  file?: string;
  q?: string;
};

const NUMBERS = ["from", "to", "person", "id"] as const;
const TEXTS = ["window", "folder", "path", "file", "q"] as const;

export function toRoute(search: Record<string, unknown>): Route {
  const screen = (SCREENS as readonly unknown[]).includes(search.screen) ? (search.screen as Screen) : "overview";
  const route: Route = { screen };
  for (const k of NUMBERS) {
    const v = search[k];
    if (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v))) route[k] = Number(v);
  }
  for (const k of TEXTS) {
    const v = search[k];
    if (typeof v === "string" && v !== "") route[k] = v;
    else if (typeof v === "number") route[k] = String(v);
  }
  return route;
}

export type Go = (change: Partial<Route>, replace?: boolean) => void;

const DAY = 86_400;

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

/** The answer a screen needs before it can draw. */
export function primaryRequest(route: Route, params: Params): [string, Params] | null {
  switch (route.screen) {
    case "overview":
      return ["/api/overview", params];
    case "activity":
      return ["/api/activity", params];
    case "people":
      return route.id !== undefined ? ["/api/person", { ...params, id: route.id }] : ["/api/people", params];
    case "map":
      return ["/api/map", { ...params, path: route.path ?? "" }];
    default:
      return null;
  }
}

export type Search = Partial<Route>;

/** A route as the address's query holds it, without the default screen. */
export function toSearch(input: Record<string, unknown>): Search {
  const { screen, ...rest } = toRoute(input);
  return screen === "overview" ? rest : { screen, ...rest };
}
