import { expect, test, vi } from "vitest";
import type { Lookup } from "@commitscape/data";
import { testD1 } from "../test/d1";
import { testR2 } from "../test/r2";
import { startBuild } from "./builds";

test("with the Builder down, the Build says Builds are paused, and the facts still show", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/builds")) throw new Error("connection refused");
    if (url.endsWith("/languages")) return new Response("{}");
    if (url.includes("/contributors") || url.includes("/releases")) return new Response("[]");
    return new Response(JSON.stringify({ full_name: "acme/rocket", private: false, size: 5, description: "A rocket.", stargazers_count: 3 }));
  });
  const env = { DB: testD1(), REPORTS: testR2(), BUILDER_URL: "http://down", BUILDER_SECRET: "s".repeat(40), GITHUB_API: "http://gh", GITHUB_TOKEN: "" } as unknown as Env;
  const started = await startBuild(new Request("http://site/api/builds", { method: "POST", body: JSON.stringify({ owner: "acme", name: "rocket" }) }), env);
  const lookup = (await started.json()) as Lookup;
  expect(lookup.build).toMatchObject({ state: "failed", reason: "paused" });
  expect(lookup.facts?.description).toBe("A rocket.");
  // A paused Build may be asked for again at once.
  expect(lookup.canBuild).toBe(true);
  vi.unstubAllGlobals();
});
