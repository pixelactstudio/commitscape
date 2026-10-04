import { expect, test } from "vitest";
import { survival } from "./survival";

test("Survival is shown only when both numbers are known and it is a share", () => {
  expect(survival(61_148, 106_349)).toBe("57%");
  expect(survival(1, 1000)).toBe("<1%");
  expect(survival(0, 6)).toBe("0%");
  expect(survival(null, 10)).toBeNull();
  expect(survival(10, null)).toBeNull();
  expect(survival(10, 0)).toBeNull();
  expect(survival(12, 10)).toBeNull();
});
