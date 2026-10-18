import { describe, expect, it } from "vitest";
import { compact, date, day, grouped, share } from "./format";

describe("numbers in words", () => {
  it("groups thousands with commas", () => {
    expect(grouped(0)).toBe("0");
    expect(grouped(999)).toBe("999");
    expect(grouped(1234567)).toBe("1,234,567");
  });
  it("shortens large numbers to one decimal", () => {
    expect(compact(950)).toBe("950");
    expect(compact(1234)).toBe("1.2k");
    expect(compact(64000)).toBe("64k");
    expect(compact(2_500_000)).toBe("2.5M");
  });
  it("says a share as a whole percentage, and nothing when there is no whole", () => {
    expect(share(1, 3)).toBe("33%");
    expect(share(0, 0)).toBe("—");
  });
});

describe("dates in words", () => {
  it("writes a day as day, three-letter month and year, September included", () => {
    expect(day(Date.UTC(2024, 8, 19) / 86_400_000)).toBe("19 Sep 2024");
    expect(day(Date.UTC(2026, 7, 4) / 86_400_000)).toBe("4 Aug 2026");
    expect(date(Date.UTC(2016, 2, 11) / 1000)).toBe("11 Mar 2016");
  });
});
