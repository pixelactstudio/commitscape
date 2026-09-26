import { expect, test } from "vitest";
import { base64url, deleteToken, keyOf, unbase64url, unlock } from "./share";

// The vector crates/commitscape/src/share.rs's tests hold too: key 32 × 7,
// nonce 12 × 9, plain "the report".
const key = new Uint8Array(32).fill(7);
const locked = unbase64url("CQkJCQkJCQkJCQkJU-3htMyVsQ7SFiW449uUXvmxSiSw7zwauAA") as Uint8Array;

test("what commitscape share locked opens in the browser, and nothing changed does", async () => {
  expect(new TextDecoder().decode(await unlock(key, locked))).toBe("the report");
  const tampered = locked.slice();
  tampered[20] = (tampered[20] ?? 0) ^ 1;
  await expect(unlock(key, tampered)).rejects.toThrow();
  await expect(unlock(new Uint8Array(32).fill(8), locked)).rejects.toThrow();
});

test("the Delete Token is the one the command derives", async () => {
  expect(await deleteToken(key)).toBe("78UF_u01KXZi-HTDpVBCbJQpmn87MYkNQr9hvL4_6-g");
});

test("a link's fragment is a key only when it is 32 bytes of base64url", () => {
  expect(keyOf(`#${base64url(key)}`)).toEqual(key);
  expect(keyOf("#short")).toBeNull();
  expect(keyOf("#not base64!")).toBeNull();
});
