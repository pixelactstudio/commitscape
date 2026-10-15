import { expect, test } from "vitest";
import { testDb } from "#/test/deps";
import { allowanceOf, dashboardOf } from "./dashboard";

test("a person's allowance is read from GitHub's rate limit, and nothing is shown when GitHub does not answer", async () => {
  const db = await testDb();
  const fetcher = (async () => Response.json({ resources: { core: { remaining: 4200, limit: 5000, reset: 1 }, graphql: { remaining: 10, limit: 5000, reset: 2 } } })) as unknown as typeof fetch;
  expect(await allowanceOf({ db, github: { api: "http://github.test", fetcher } }, "ghu_x")).toEqual({ core: { remaining: 4200, limit: 5000, reset: 1 }, graphql: { remaining: 10, limit: 5000, reset: 2 } });
  const down = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
  expect(await allowanceOf({ db, github: { api: "http://github.test", fetcher: down } }, "ghu_x")).toBeNull();
});

test("a dashboard lists every connected repository, read or not, without a token", async () => {
  const db = await testDb();
  const d = await dashboardOf({ db, github: { api: "http://github.test" } }, { user: { login: null, name: null, avatar: null }, installations: [{ id: 1, account: "acme", repositories: [{ name: "acme/Rocket", private: true, description: null }] }], install: null }, null);
  expect(d.repositories).toEqual([expect.objectContaining({ id: "acme/rocket", owner: "acme", name: "rocket", private: true, builtAt: null, building: false })]);
  expect(d.allowance).toBeNull();
});
