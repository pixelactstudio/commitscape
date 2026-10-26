import { describe, expect, test } from "vitest";
import { analyticsId } from "./analytics";

const SECRET = "s".repeat(32);

describe("analyticsId", () => {
  test("is a keyed hash: the same for one person and secret, different for another secret, and never holds the id", () => {
    const id = analyticsId("user-123", SECRET);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(analyticsId("user-123", SECRET)).toBe(id);
    expect(analyticsId("user-124", SECRET)).not.toBe(id);
    expect(analyticsId("user-123", "t".repeat(32))).not.toBe(id);
    expect(id).not.toContain("user-123");
  });
});
