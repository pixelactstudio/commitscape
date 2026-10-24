import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { siteToken } from "./github-app";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const app = { appId: "1", privateKey, api: "http://github.test" };

afterEach(() => vi.unstubAllGlobals());

function github(repositories: { private: boolean }[]) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(new URL(url).pathname);
    if (url.includes("/access_tokens")) return Response.json({ token: "ghs_site", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    return Response.json({ repositories });
  });
  return asked;
}

test("the Site's token is minted from its installation once and kept while fresh", async () => {
  const asked = github([{ private: false }]);
  const site = siteToken(app, 7, "fallback");
  expect(await site.ready()).toBe("ghs_site");
  expect(site.current()).toBe("ghs_site");
  expect(asked).toEqual(["/app/installations/7/access_tokens", "/installation/repositories"]);
});

test("an installation that can read anything private is refused, and not asked again at once", async () => {
  const asked = github([{ private: false }, { private: true }]);
  const lines: string[] = [];
  const site = siteToken(app, 7, "fallback", (l) => lines.push(l));
  expect(await site.ready()).toBe("fallback");
  expect(await site.ready()).toBe("fallback");
  expect(asked).toHaveLength(2);
  expect(lines[0]).toContain("private");
});

test("without an installation the fallback is the token", async () => {
  expect(await siteToken(null, null, "fallback").ready()).toBe("fallback");
});
