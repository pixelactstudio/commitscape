import { expect, test } from "vitest";
import { openToken, sealToken } from "./lent";

const SECRET = "a".repeat(32);

test("a sealed token opens only with the same secret, and not once changed", () => {
  const sealed = sealToken(SECRET, "ghu_secret");
  expect(sealed).not.toContain("ghu_secret");
  expect(openToken(SECRET, sealed)).toBe("ghu_secret");
  expect(openToken("b".repeat(32), sealed)).toBeNull();
  const [iv, tag, body] = sealed.split(".");
  expect(openToken(SECRET, [iv, tag, `${body}A`].join("."))).toBeNull();
  expect(openToken(SECRET, "nonsense")).toBeNull();
});
