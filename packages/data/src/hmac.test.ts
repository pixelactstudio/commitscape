import { expect, test } from "vitest";
import { sign, verify } from "./hmac";

test("a signature holds for its request only, and only for a while", async () => {
  const s = await sign("secret", "POST", "/builds", '{"id":"b1"}', 1000);
  expect(await verify("secret", s, "POST", "/builds", '{"id":"b1"}', 1000)).toBe(true);
  expect(await verify("secret", s, "POST", "/builds", '{"id":"b1"}', 1299)).toBe(true);
  // Another body, path, method, secret or time: no.
  expect(await verify("secret", s, "POST", "/builds", '{"id":"b2"}', 1000)).toBe(false);
  expect(await verify("secret", s, "POST", "/other", '{"id":"b1"}', 1000)).toBe(false);
  expect(await verify("secret", s, "PUT", "/builds", '{"id":"b1"}', 1000)).toBe(false);
  expect(await verify("other", s, "POST", "/builds", '{"id":"b1"}', 1000)).toBe(false);
  expect(await verify("secret", s, "POST", "/builds", '{"id":"b1"}', 1301)).toBe(false);
  expect(await verify("secret", s.replace("t=1000", "t=1100"), "POST", "/builds", '{"id":"b1"}', 1100)).toBe(false);
  expect(await verify("secret", null, "POST", "/builds", "", 1000)).toBe(false);
  expect(await verify("", s, "POST", "/builds", '{"id":"b1"}', 1000)).toBe(false);
});
