import { expect, test } from "vitest";
import { prepare, search } from "./search";

const person = (id: number, name: string, login: string | null, emails: string[]) => ({
  person: { id, name, colour: null, login },
  emails,
});

// Newest first, as the server sends it.
const list = {
  people: [person(0, "Alice Example", "alice", ["alice@example.com"]), person(1, "Bob Builder", null, [])],
  person: [0, 1, 0, 1],
  subjects: ["Fix the Walk", "feat: search commits", "docs: README", "fix: walk twice"],
  times: [400, 300, 200, 100],
  kind: [10, 0, 2, 1],
};
const rows = (q: Parameters<typeof search>[1]) => [...search(prepare(list), q)];

test("every word must match the subject or the person, in any case and order", () => {
  expect(rows({ text: "" })).toEqual([0, 1, 2, 3]);
  expect(rows({ text: "WALK fix" })).toEqual([0, 3]);
  expect(rows({ text: "sear" })).toEqual([1]);
  // By name, login or address, locally.
  expect(rows({ text: "bob" })).toEqual([1, 3]);
  expect(rows({ text: "alice@example walk" })).toEqual([0]);
  expect(rows({ text: "nothing like it" })).toEqual([]);
});

test("filters narrow by person, time and kind", () => {
  expect(rows({ text: "", person: 1 })).toEqual([1, 3]);
  expect(rows({ text: "", from: 200, to: 300 })).toEqual([1, 2]);
  expect(rows({ text: "fix", kind: 1 })).toEqual([3]);
});
