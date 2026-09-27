import type { Params } from "@commitscape/data";
import type { Meta } from "@commitscape/data";
import type { Go, Route } from "../route";

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

export function openers(go: ScreenProps["go"]) {
  return {
    person: (id: number) => go({ screen: "people", id }),
    file: (path: string) => go({ screen: "map", path: folderOf(path), file: path }),
    folder: (path: string) => go({ screen: "map", path, file: undefined }),
  };
}
