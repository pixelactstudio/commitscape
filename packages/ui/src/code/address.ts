import type { Route } from "../route";

export type CodeView = "code" | "history" | "insights";

export type WindowState = "normal" | "max" | "min";

export const CODE_VIEWS: readonly CodeView[] = ["code", "history", "insights"];

/** Where the Code window opens a file or folder over the screen on view: `path` at HEAD (a folder ends in "/", "" or "/" is the top), and a line to show. */
export function codeLink(route: Route, path: string, line?: number): Route {
  return { ...route, code: path === "" ? "/" : path, line, view: undefined, win: route.win === "max" ? "max" : undefined };
}

export const CODE_SHUT: Pick<Route, "code" | "line" | "win" | "view"> = { code: undefined, line: undefined, win: undefined, view: undefined };

/** The path the Code window shows, as the tree names it: "" for the top of the repository. */
export const codePath = (route: Pick<Route, "code">): string => (route.code === undefined || route.code === "/" ? "" : route.code.replace(/^\/+/, ""));

export const isFolderPath = (path: string): boolean => path === "" || path.endsWith("/");

export const windowState = (route: Pick<Route, "win">): WindowState => (route.win === "max" || route.win === "min" ? route.win : "normal");

export const codeView = (route: Pick<Route, "view">): CodeView => ((CODE_VIEWS as readonly string[]).includes(route.view ?? "") ? (route.view as CodeView) : "code");

export const nameOf = (path: string): string => {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
};

export const parentOf = (path: string): string => {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const cut = trimmed.lastIndexOf("/");
  return cut < 0 ? "" : trimmed.slice(0, cut + 1);
};

/** Each folder above a path and the path itself, as the breadcrumb shows them. */
export function crumbsOf(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, path: `${parts.slice(0, i + 1).join("/")}${i === parts.length - 1 && !isFolderPath(path) ? "" : "/"}` }));
}

const decoded = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

const RELATIVE = /^(?![a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** A link in a file's text, made a path in the repository when it is relative, else null: `../docs/a.md#x` read from `src/README.md` is `docs/a.md`. */
export function repoPathOf(from: string, href: string): string | null {
  if (!RELATIVE.test(href)) return null;
  const clean = href.split(/[?#]/)[0] ?? "";
  if (clean === "") return null;
  const start = clean.startsWith("/") ? [] : parentOf(from).split("/").filter(Boolean);
  const parts = [...start];
  for (const part of clean.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(decoded(part));
  }
  return `${parts.join("/")}${clean.endsWith("/") && parts.length > 0 ? "/" : ""}`;
}
