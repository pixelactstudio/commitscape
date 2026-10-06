import { expect, test } from "vitest";
import { ordinal, placesOf, type StandingRow } from "./standings";

const row = (key: string, prsMerged: number | null, surviving: number | null = null): StandingRow => ({
  key, login: key, name: key, personId: null, you: false, commits: null, linesAdded: null, linesRemoved: null, prsMerged, prsOpened: null, reviews: null, surviving, survivingStatus: null, first: null, last: null,
});

test("places count from the top, ties share the higher place, and nothing is no place", () => {
  const places = placesOf([row("a", 5), row("b", 9), row("c", 5), row("d", 0), row("e", null), row("f", 1)], "prsMerged");
  expect([...places.entries()].map(([k, p]) => [k, p.place, p.of])).toEqual([
    ["a", 2, 4],
    ["b", 1, 4],
    ["c", 2, 4],
    ["f", 4, 4],
  ]);
  expect(placesOf([row("a", 1, null)], "surviving").size).toBe(0);
});

test("places in words", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
});
