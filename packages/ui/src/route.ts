import { OVERVIEW_TOP, type Params } from "@commitscape/data";
import type { Meta } from "@commitscape/data";

export const SCREENS = ["overview", "people", "activity", "map", "commits", "universe", "code", "branches", "pulls"] as const;

export const GIT_SCREENS = ["code", "branches", "pulls"] as const;

export type Screen = (typeof SCREENS)[number];

const WITHOUT_GIT = SCREENS.filter((s) => !(GIT_SCREENS as readonly Screen[]).includes(s));

/** The screens a Report has: the git ones only where the Site kept git data. */
export function screensOf(git: boolean): readonly Screen[] {
  return git ? SCREENS : WITHOUT_GIT;
}

export const GROUPS: readonly { title: string; screens: readonly Screen[] }[] = [
  { title: "Report", screens: ["overview", "people", "activity", "map", "commits"] },
  { title: "Explore", screens: ["universe"] },
  { title: "Git", screens: ["code", "branches", "pulls"] },
];

export const UNWINDOWED: ReadonlySet<Screen> = new Set(["universe", "code", "branches"]);

export const TITLES: Record<Screen, string> = {
  overview: "Overview",
  activity: "Activity",
  people: "People",
  map: "Map",
  universe: "Universe",
  commits: "Commits",
  code: "Code",
  branches: "Branches",
  pulls: "Pull requests",
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
  who?: number;
  since?: number;
  until?: number;
  weekday?: number;
  hour?: number;
  merges?: string;
  kind?: string;
  rank?: string;
  card?: string;
  concept?: string;
  at?: number;
  cam?: string;
  line?: number;
  pr?: number;
  page?: number;
  branch?: string;
  under?: string;
  state?: string;
  by?: string;
  tab?: string;
  code?: string;
  win?: string;
  view?: string;
  author?: string;
  prefix?: string;
  bots?: string;
  lens?: string;
  label?: string;
  size?: string;
  review?: string;
  stale?: string;
  draft?: string;
};

export type Drill = Pick<Route, "who" | "since" | "until" | "weekday" | "hour" | "merges" | "under" | "kind">;

export const NO_DRILL: Drill = { who: undefined, since: undefined, until: undefined, weekday: undefined, hour: undefined, merges: undefined, under: undefined, kind: undefined };

export const NO_GIT: Pick<Route, "line" | "pr" | "page" | "branch" | "state" | "by" | "tab" | "author" | "prefix" | "bots" | "label" | "size" | "review" | "stale" | "draft"> = { line: undefined, pr: undefined, page: undefined, branch: undefined, state: undefined, by: undefined, tab: undefined, author: undefined, prefix: undefined, bots: undefined, label: undefined, size: undefined, review: undefined, stale: undefined, draft: undefined };

const NUMBERS = ["from", "to", "person", "id", "who", "since", "until", "weekday", "hour", "at", "line", "pr", "page"] as const;
const TEXTS = ["window", "folder", "path", "file", "q", "merges", "kind", "rank", "card", "concept", "cam", "branch", "under", "state", "by", "tab", "code", "win", "view", "author", "prefix", "bots", "lens", "label", "size", "review", "stale", "draft"] as const;

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
  if (route.screen === "code") {
    route.screen = "overview";
    route.code ??= route.path ?? "/";
    delete route.path;
  }
  return route;
}

export type Go = (change: Partial<Route>, replace?: boolean) => void;

/** Where a screen opens from the one on view: the Window and filters kept, everything that belongs to one screen dropped. */
export function screenRoute(route: Route, screen: Screen): Route {
  if (screen === "code") return { ...route, code: route.code ?? "/", win: undefined };
  const fromGit = (GIT_SCREENS as readonly Screen[]).includes(route.screen);
  return { ...route, screen, id: undefined, file: undefined, ...NO_DRILL, ...NO_GIT, ...(fromGit ? { q: undefined } : {}), ...(route.screen === "code" ? { path: undefined } : {}), ...(route.code ? { line: route.line } : {}) };
}

/** A route as an address's query string, with a leading "?" when it has anything in it. */
export function queryOf(route: Partial<Route>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(toSearch(route))) if (v !== undefined) search.set(k, String(v));
  const text = search.toString();
  return text ? `?${text}` : "";
}

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
      return ["/api/overview", { ...params, top: OVERVIEW_TOP }];
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
