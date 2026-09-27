import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { expect, test } from "vitest";
import { appJwt, githubSigned, pkcs8, seal, unseal } from "./crypto";

test("a sealed token opens with the Site's key only", async () => {
  const key = "k".repeat(40);
  const sealed = await seal(key, "ghu_secret");
  expect(sealed).not.toContain("ghu_secret");
  expect(await unseal(key, sealed)).toBe("ghu_secret");
  expect(await unseal("x".repeat(40), sealed)).toBeNull();
  expect(await unseal(key, `${sealed.slice(0, -2)}AA`)).toBeNull();
});

test("the App's JWT is RS256 over GitHub's own key format, and verifies", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  expect(pkcs1).toContain("BEGIN RSA PRIVATE KEY");
  expect(Buffer.from(pkcs8(pkcs1)).equals(privateKey.export({ type: "pkcs8", format: "der" }))).toBe(true);
  for (const form of [pkcs1, Buffer.from(pkcs1).toString("base64")]) {
    const jwt = await appJwt("12345", form, 1_000_000);
    const [head, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(claims ?? "", "base64url").toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: "12345" });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(signature ?? "", "base64url"))).toBe(true);
  }
});

test("a webhook is GitHub's only with its signature", async () => {
  const body = '{"action":"deleted"}';
  const good = `sha256=${createHmac("sha256", "hook-secret").update(body).digest("hex")}`;
  expect(await githubSigned("hook-secret", good, body)).toBe(true);
  expect(await githubSigned("hook-secret", good, `${body} `)).toBe(false);
  expect(await githubSigned("other", good, body)).toBe(false);
  expect(await githubSigned("hook-secret", null, body)).toBe(false);
  expect(await githubSigned("", good, body)).toBe(false);
});
