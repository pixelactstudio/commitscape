import { expect, test } from "vitest";
import type { StandingRow, Standings } from "@commitscape/data";
import { placesFor } from "./places";

const row = (key: string, commits: number, prsMerged: number | null = null): StandingRow => ({
  key, login: key, name: key, personId: 1, you: false, commits, linesAdded: null, linesRemoved: null, prsMerged, prsOpened: null, reviews: null, surviving: null, survivingStatus: null, first: null, last: null,
});

const standings = (people: StandingRow[], more: Partial<Standings> = {}): Standings => ({
  repo: { owner: "acme", name: "rocket", private: false, builtAt: 1, pullsReadAt: null, stars: 0 },
  people,
  counted: 0,
  hidden: 0,
  ...more,
});

test("a person's places are counted from the people listed when the Standings hold everyone", () => {
  expect(placesFor(standings([row("a", 5, 1), row("b", 9)]), "a").map((p) => [p.view, p.place, p.of])).toEqual([
    ["prsMerged", 1, 1],
    ["commits", 2, 2],
  ]);
});

test("a person's places are the ones the Site counted over everyone when the Standings hold only the first few", () => {
  const cut = standings([row("a", 5, 2)], {
    total: 40,
    places: {
      a: [
        { view: "commits", place: 7, of: 40, value: 5 },
        { view: "prsMerged", place: 3, of: 12, value: 2 },
      ],
    },
  });
  expect(placesFor(cut, "a").map((p) => [p.view, p.place, p.of])).toEqual([
    ["prsMerged", 3, 12],
    ["commits", 7, 40],
  ]);
});
