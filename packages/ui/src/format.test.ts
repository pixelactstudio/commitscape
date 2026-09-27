import { describe, expect, it } from "vitest";
import { grouped, compact, share } from "./format";

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
