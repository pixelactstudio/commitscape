import { expect, test } from "vitest";
import { Sized } from "./sized";

test("values are dropped least recently used first once their sizes pass the budget, a value changed in place counted again when refreshed", () => {
  const box = (n: number) => ({ n });
  const kept = new Sized<{ n: number }>(10, (v) => v.n);
  kept.set("a", box(4));
  kept.set("b", box(4));
  expect(kept.bytes()).toBe(8);
  kept.get("a");
  kept.set("c", box(4));
  expect([kept.peek("a"), kept.peek("b"), kept.peek("c")].map((v) => v?.n ?? null)).toEqual([4, null, 4]);
  expect(kept.bytes()).toBe(8);
  const grown = kept.peek("a");
  if (grown) grown.n = 9;
  kept.refresh("a");
  expect([kept.peek("a"), kept.peek("c")].map((v) => v?.n ?? null)).toEqual([null, 4]);
  expect(kept.bytes()).toBe(4);
  kept.set("a", box(2));
  expect(kept.bytes()).toBe(6);
  kept.delete("a");
  expect(kept.bytes()).toBe(4);
});

test("one value larger than the budget stays until another comes", () => {
  const kept = new Sized<number>(5, (v) => v);
  kept.set("big", 50);
  expect(kept.peek("big")).toBe(50);
  kept.set("small", 1);
  expect([kept.peek("big"), kept.peek("small")]).toEqual([undefined, 1]);
});
