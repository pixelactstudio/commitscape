import { expect, test, vi } from "vitest";
import { testD1 } from "../test/d1";
import { allow, sweep } from "./limits";

test("an address gets its number in each window, then no more, and others are counted apart", async () => {
  const db = testD1();
  const limit = { action: "share", max: 3, seconds: 3600 };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T10:15:00Z"));
  const four = [];
  for (let i = 0; i < 4; i++) four.push(await allow(db, limit, "203.0.113.7"));
  expect(four).toEqual([true, true, true, false]);
  expect(await allow(db, limit, "198.51.100.1")).toBe(true);
  // The next hour starts again.
  vi.setSystemTime(new Date("2026-09-25T11:00:01Z"));
  expect(await allow(db, limit, "203.0.113.7")).toBe(true);
  // No address is kept, only its hash.
  const keys = await db.prepare("SELECT key FROM rate_limits").all<{ key: string }>();
  expect(keys.results.some((r) => r.key.includes("203.0.113.7"))).toBe(false);
  // The last hour's counters go once it has passed.
  await sweep(db);
  const left = await db.prepare("SELECT count(*) AS n FROM rate_limits").first<{ n: number }>();
  expect(left?.n).toBe(1);
  vi.useRealTimers();
});
