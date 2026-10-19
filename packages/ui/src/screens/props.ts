import type { Params } from "@commitscape/data";
import type { Meta } from "@commitscape/data";
import { codeLink } from "../code/address";
import { NO_DRILL, type Drill, type Go, type Route } from "../route";

export type ScreenProps = {
  meta: Meta;
  route: Route;
  go: Go;
  params: Params;
};

export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

/** Where a click on a person, a file, a folder or a number of commits goes: the same Report, another screen or the Code window over this one. */
export function openers(go: ScreenProps["go"], route: Route) {
  return {
    person: (id: number) => go({ screen: "people", id, tab: undefined }),
    file: (path: string) => go({ screen: "map", path: folderOf(path), file: path }),
    code: (path: string, line?: number) => go(codeLink(route, path, line)),
    folder: (path: string) => go({ screen: "map", path, file: undefined }),
    commits: (drill: Drill) => go({ screen: "commits", id: undefined, file: undefined, q: undefined, tab: undefined, ...NO_DRILL, merges: "out", ...drill }),
  };
}
