import { expect, test } from "vitest";
import { winnerOf } from "./tone";

test("who leads a view: the higher number, the lower where lower is better, nobody at nought each or unknown", () => {
  expect(winnerOf({ a: 3, b: 5 })).toBe("b");
  expect(winnerOf({ a: 0.7, b: 6, lowerWins: true })).toBe("a");
  expect(winnerOf({ a: 4, b: 4 })).toBe("tie");
  expect(winnerOf({ a: 0, b: 0, winner: "tie" })).toBeNull();
  expect(winnerOf({ a: null, b: 9 })).toBeNull();
  expect(winnerOf({ a: 1, b: 2, winner: null })).toBeNull();
});
