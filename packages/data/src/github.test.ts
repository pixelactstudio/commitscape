import { expect, test } from "vitest";
import { parseGitHub } from "./github";

test("a GitHub link or owner/name, in the forms people paste", () => {
  const rg = { owner: "BurntSushi", name: "ripgrep" };
  expect(parseGitHub("https://github.com/BurntSushi/ripgrep")).toEqual(rg);
  expect(parseGitHub("  github.com/BurntSushi/ripgrep/tree/master/crates ")).toEqual(rg);
  expect(parseGitHub("git@github.com:BurntSushi/ripgrep.git")).toEqual(rg);
  expect(parseGitHub("BurntSushi/ripgrep")).toEqual(rg);
  expect(parseGitHub("https://github.com/BurntSushi/ripgrep?tab=readme")).toEqual(rg);
});

test("anything else is not a repository", () => {
  expect(parseGitHub("https://gitlab.com/a/b")).toBeNull();
  expect(parseGitHub("ripgrep")).toBeNull();
  expect(parseGitHub("a/..")).toBeNull();
  expect(parseGitHub("a b/c")).toBeNull();
});
