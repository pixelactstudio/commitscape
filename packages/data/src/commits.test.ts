import { expect, test } from "vitest";
import { cursorOf, listPager, pageLimit, prepare, search, seqOf, UNKNOWN_PERSON } from "./commits";
import type { CommitList } from "./types";

const person = (id: number, name: string, login: string | null, emails: string[]) => ({
  person: { id, name, colour: null, login },
  emails,
});

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
  expect(rows({ text: "bob" })).toEqual([1, 3]);
  expect(rows({ text: "alice@example walk" })).toEqual([0]);
  expect(rows({ text: "nothing like it" })).toEqual([]);
});

test("filters narrow by person, time and kind", () => {
  expect(rows({ text: "", person: 1 })).toEqual([1, 3]);
  expect(rows({ text: "", from: 200, to: 300 })).toEqual([1, 2]);
  expect(rows({ text: "fix", kind: 1 })).toEqual([3]);
});

test("a cursor is opaque and only ever a position", () => {
  expect(seqOf(cursorOf(1234))).toBe(1234);
  expect(seqOf("")).toBeNull();
  expect(seqOf("not-a-cursor")).toBeNull();
  expect(pageLimit(undefined)).toBe(50);
  expect(pageLimit(5000)).toBe(200);
  expect(pageLimit(0)).toBe(1);
});

const full: CommitList = {
  link: "https://github.com/acme/rocket/commit/",
  lines: true,
  kinds: ["features", "fixes", "docs"],
  people: [person(7, "Alice Example", "alice", []), { person: { id: UNKNOWN_PERSON, name: "someone unknown", colour: null, login: null }, emails: [] }],
  ids: ["a1", "b2", "c3", "d4", "e5"],
  times: [500, 400, 300, 200, 100],
  offsets: [60, 0, 0, 0, -120],
  person: [0, 1, 0, 0, 1],
  subjects: ["feat: one", "fix: two", "docs: three", "feat: four", "fix: five"],
  kind: [0, 1, 2, 0, 1],
  merge: [false, true, false, false, false],
  files: [1, 2, 3, 4, 5],
  added: [1, null, 3, 4, 5],
  removed: [0, null, 1, 2, 3],
};

test("a list in memory is paged newest first, a cursor after the last row shown", async () => {
  const page = listPager(full);
  const first = await page({ limit: 2 });
  expect(first.rows.map((r) => r.sha)).toEqual(["a1", "b2"]);
  expect(first).toMatchObject({ all: 5, total: 5, link: full.link, lines: true });
  expect(Object.keys(first.people).sort()).toEqual(["4294967295", "7"]);
  expect(first.rows[1]).toEqual({ sha: "b2", at: 400, offset: 0, personId: UNKNOWN_PERSON, subject: "fix: two", kind: 1, merge: true, files: 2, added: null, removed: null });
  const second = await page({ limit: 2 }, first.next ?? undefined);
  expect(second.rows.map((r) => r.sha)).toEqual(["c3", "d4"]);
  const third = await page({ limit: 2 }, second.next ?? undefined);
  expect(third.rows.map((r) => r.sha)).toEqual(["e5"]);
  expect(third.next).toBeNull();
});

test("a list in memory is searched as the Site searches its rows", async () => {
  const page = listPager(full);
  expect((await page({ q: "FEAT" })).rows.map((r) => r.sha)).toEqual(["a1", "d4"]);
  expect((await page({ q: "alice fix" })).rows).toEqual([]);
  expect((await page({ person: UNKNOWN_PERSON })).rows.map((r) => r.sha)).toEqual(["b2", "e5"]);
  expect((await page({ person: 99 })).total).toBe(0);
  expect((await page({ kind: 2 })).rows.map((r) => r.sha)).toEqual(["c3"]);
  expect((await page({ from: 200, to: 400 })).total).toBe(3);
});
