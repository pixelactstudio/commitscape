import { describe, expect, test } from "vitest";
import { toRoute, screenRoute, toSearch } from "../route";
import { CODE_SHUT, codeLink, codePath, codeView, crumbsOf, repoPathOf, windowState } from "./address";
import { lfsOf, stalenessOf } from "./data";
import { clampBox, MIN_H, MIN_W, moved, readBox, resized } from "./geometry";
import { plainMarkdown } from "./markdown";
import { withoutTab, withTab } from "./tabs";

const room = { width: 1440, height: 900, top: 56 };

describe("the Code window's address", () => {
  test("opens a path over the screen on view, keeping a maximised window maximised", () => {
    const route = toRoute({ screen: "people", window: "1y", id: 4 });
    expect(codeLink(route, "src/a.ts", 12)).toMatchObject({ screen: "people", window: "1y", id: 4, code: "src/a.ts", line: 12 });
    expect(codeLink({ ...route, win: "min" }, "src/").win).toBeUndefined();
    expect(codeLink({ ...route, win: "max" }, "").code).toBe("/");
    expect(codeLink({ ...route, win: "max" }, "").win).toBe("max");
    expect(toSearch({ ...codeLink(route, "src/a.ts"), ...CODE_SHUT })).toEqual({ screen: "people", window: "1y", id: 4 });
  });

  test("keeps old Code screen addresses working: they open the window over the Overview", () => {
    expect(toRoute({ screen: "code", path: "crates/core/main.rs", line: "9" })).toEqual({ screen: "overview", code: "crates/core/main.rs", line: 9 });
    expect(toRoute({ screen: "code" })).toEqual({ screen: "overview", code: "/" });
    expect(toRoute({ screen: "map", path: "src/" }).path).toBe("src/");
  });

  test("the sidebar's Code item opens the window and keeps the screen; other screens keep it open", () => {
    const route = toRoute({ screen: "branches", code: "a.ts", line: 3, win: "min" });
    expect(screenRoute(route, "code")).toMatchObject({ screen: "branches", code: "a.ts", win: undefined });
    expect(screenRoute(route, "people")).toMatchObject({ screen: "people", code: "a.ts", line: 3, win: "min" });
  });

  test("reads the path, view and window state", () => {
    expect(codePath({ code: "/" })).toBe("");
    expect(codePath({ code: "src/" })).toBe("src/");
    expect(codeView({ view: "history" })).toBe("history");
    expect(codeView({ view: "nonsense" })).toBe("code");
    expect(windowState({ win: "max" })).toBe("max");
    expect(windowState({})).toBe("normal");
  });

  test("names each folder above a path for the breadcrumb", () => {
    expect(crumbsOf("crates/core/main.rs")).toEqual([
      { name: "crates", path: "crates/" },
      { name: "core", path: "crates/core/" },
      { name: "main.rs", path: "crates/core/main.rs" },
    ]);
    expect(crumbsOf("crates/")).toEqual([{ name: "crates", path: "crates/" }]);
  });

  test("makes relative links in a file paths in the repository", () => {
    expect(repoPathOf("docs/README.md", "../src/a.ts#L3")).toBe("src/a.ts");
    expect(repoPathOf("README.md", "./docs/")).toBe("docs/");
    expect(repoPathOf("README.md", "/LICENSE")).toBe("LICENSE");
    expect(repoPathOf("README.md", "https://example.com")).toBeNull();
    expect(repoPathOf("README.md", "#usage")).toBeNull();
    expect(repoPathOf("README.md", "../../x")).toBeNull();
  });
});

describe("the Code window's box", () => {
  test("stays inside the room, no smaller than the minimum, its title bar reachable", () => {
    expect(clampBox({ x: -5000, y: 0, w: 100, h: 100 }, room)).toEqual({ x: 160 - MIN_W, y: 56, w: MIN_W, h: MIN_H });
    expect(clampBox({ x: 5000, y: 5000, w: 5000, h: 5000 }, room)).toEqual({ x: 1280, y: 856, w: 1440, h: 844 });
    expect(moved({ x: 300, y: 100, w: 800, h: 600 }, 50, -500, room)).toEqual({ x: 350, y: 56, w: 800, h: 600 });
  });

  test("resizes from an edge or corner, the opposite edge staying put", () => {
    const box = { x: 300, y: 100, w: 800, h: 600 };
    expect(resized(box, "se", 40, 20, room)).toEqual({ x: 300, y: 100, w: 840, h: 620 });
    expect(resized(box, "w", -100, 0, room)).toEqual({ x: 200, y: 100, w: 900, h: 600 });
    expect(resized(box, "nw", 700, 700, room)).toEqual({ x: 1100 - MIN_W, y: 700 - MIN_H, w: MIN_W, h: MIN_H });
    expect(resized(box, "n", 0, -200, room)).toEqual({ x: 300, y: 56, w: 800, h: 644 });
  });

  test("reads a remembered box, and nothing that is not one", () => {
    expect(readBox('{"x":1,"y":2,"w":3,"h":4}')).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(readBox('{"x":"1"}')).toBeNull();
    expect(readBox("nope")).toBeNull();
    expect(readBox(null)).toBeNull();
  });
});

describe("the open files", () => {
  test("adds a file once, dropping the oldest past the most kept", () => {
    expect(withTab(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(withTab(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
  });

  test("closing the file shown shows its right neighbour, else its left", () => {
    expect(withoutTab(["a", "b", "c"], "b", "b")).toEqual({ tabs: ["a", "c"], next: "c" });
    expect(withoutTab(["a", "b", "c"], "c", "c")).toEqual({ tabs: ["a", "b"], next: "b" });
    expect(withoutTab(["a"], "a", "a")).toEqual({ tabs: [], next: null });
    expect(withoutTab(["a", "b"], "a", "b")).toEqual({ tabs: ["b"], next: null });
  });
});

describe("what a file says of itself", () => {
  test("tells a Git LFS pointer by its first line", () => {
    const oid = "a".repeat(64);
    expect(lfsOf(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 12345\n`)).toEqual({ oid, size: 12345 });
    expect(lfsOf("version 2\n")).toBeNull();
  });

  test("puts days since a change in its Staleness bucket", () => {
    expect([3, 10, 60, 200, 900].map(stalenessOf)).toEqual(["under a week", "under a month", "under 3 months", "under a year", "a year or more"]);
  });

  test("makes the HTML in a README plain Markdown", () => {
    expect(plainMarkdown('<p align="center"><img src="logo.png" alt="Logo" width="80"></p>\n<!-- hidden -->\n# Title')).toBe("![Logo](logo.png)\n\n# Title");
  });
});
