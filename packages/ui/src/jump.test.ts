import { expect, test } from "vitest";
import { jumpSource, type Jump } from "./jump";

const jump = (id: string, label: string, group: string): Jump => ({ id, label, auxiliaryData: { group, to: {} } });

test("⌘K matches every word typed, in any order, once the list arrives", async () => {
  let arrive: (list: Jump[]) => void = () => {};
  const source = jumpSource(new Promise((ok) => (arrive = ok)));
  // Asked before the list is there: answered when it is.
  const early = source.search("example bob");
  arrive([
    jump("screen:people", "People", "Screens"),
    jump("person:1", "Bob Example", "People"),
    jump("person:2", "Alice Example", "People"),
    jump("file:src/bob.rs", "src/bob.rs", "Files"),
  ]);
  expect((await early).map((j) => j.id)).toEqual(["person:1"]);
  expect((await source.search("BOB")).map((j) => j.id)).toEqual(["person:1", "file:src/bob.rs"]);
  expect((await source.bootstrap()).map((j) => j.id)).toEqual(["screen:people"]);
});
