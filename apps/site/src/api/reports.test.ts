import { expect, test } from "vitest";
import { repoId } from "./reports";

test("repository names are GitHub's, compared without case", () => {
  expect(repoId("BurntSushi", "ripgrep")).toBe("burntsushi/ripgrep");
  expect(repoId("a", "..")).toBeNull();
  expect(repoId("../etc", "passwd")).toBeNull();
  expect(repoId("a b", "c")).toBeNull();
});
