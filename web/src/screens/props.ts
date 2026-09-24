import type { Params } from "../api/client";
import type { Meta } from "../api/types";
import type { Route } from "../route";

export type ScreenProps = {
  meta: Meta;
  route: Route;
  go: (change: Partial<Route>, replace?: boolean) => void;
  /** The Window or dates, and the filters, as the API asks for them. */
  params: Params;
};

/** The folder a file is in, as the Map names it: "" for the top. */
export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

/** Ways to open a person, a file and a folder from any screen. */
export function openers(go: ScreenProps["go"]) {
  return {
    person: (id: number) => go({ screen: "people", id }),
    file: (path: string) => go({ screen: "map", path: folderOf(path), file: path }),
    folder: (path: string) => go({ screen: "map", path, file: undefined }),
  };
}
