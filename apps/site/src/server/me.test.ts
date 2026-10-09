import { describe, expect, test } from "vitest";
import { now, schema } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { mine } from "./me";

function github(status = 200) {
  const asked: { path: string; token: string | null; match: string | null }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const match = headers.get("if-none-match");
    asked.push({ path: url.pathname, token: headers.get("authorization")?.replace("Bearer ", "") ?? null, match });
    if (status !== 200) return new Response("{}", { status });
    if (match === '"e"') return new Response(null, { status: 304 });
    const body = url.pathname === "/user/installations" ? { installations: [{ id: 3, account: { login: "acme" } }] } : { repositories: [{ full_name: "acme/secret", private: true, description: "Hidden" }] };
    return Response.json(body, { headers: { etag: '"e"' } });
  }) as unknown as typeof fetch;
  return { asked, fetcher };
}

const person = { login: "alice", name: "Alice", image: null };

describe("mine", () => {
  test("lists the installations and their repositories with the person's token, then answers from Postgres for a minute", async () => {
    const gh = github();
    const deps = { db: await testDb(), github: { api: "http://github.test", fetcher: gh.fetcher } };
    const first = await mine(deps, "u1", person, "ghu_alice", "commitscape");
    expect(first).toEqual({
      user: { login: "alice", name: "Alice", avatar: null },
      installations: [{ id: 3, account: "acme", repositories: [{ name: "acme/secret", private: true, description: "Hidden" }] }],
      install: "https://github.com/apps/commitscape/installations/new",
    });
    expect(gh.asked.map((a) => a.token)).toEqual(["ghu_alice", "ghu_alice"]);
    expect(await mine(deps, "u1", person, "ghu_alice")).toMatchObject({ installations: first.installations });
    expect(gh.asked).toHaveLength(2);
  });

  test("after that minute GitHub is asked with the ETags, and its 304 costs nothing", async () => {
    const gh = github();
    const deps = { db: await testDb(), github: { api: "http://github.test", fetcher: gh.fetcher } };
    await mine(deps, "u1", person, "ghu_alice");
    await deps.db.update(schema.githubCache).set({ until: now() - 1 });
    const again = await mine(deps, "u1", person, "ghu_alice");
    expect(again.installations).toHaveLength(1);
    expect(gh.asked.slice(2).map((a) => a.match)).toEqual(['"e"', '"e"']);
  });

  test("one person's list is never given to another", async () => {
    const gh = github();
    const deps = { db: await testDb(), github: { api: "http://github.test", fetcher: gh.fetcher } };
    await mine(deps, "u1", person, "ghu_alice");
    await mine(deps, "u2", { login: "bob", name: null, image: null }, "ghu_bob");
    expect(gh.asked.map((a) => a.token)).toEqual(["ghu_alice", "ghu_alice", "ghu_bob", "ghu_bob"]);
  });

  test("a token GitHub no longer accepts asks the person to sign in again", async () => {
    const deps = { db: await testDb(), github: { api: "http://github.test", fetcher: github(401).fetcher } };
    await expect(mine(deps, "u1", person, "ghu_old")).rejects.toMatchObject({ status: 401 });
  });

  test("a person whose username is not known yet is still listed", async () => {
    const deps = { db: await testDb(), github: { api: "http://github.test", fetcher: github().fetcher } };
    expect((await mine(deps, "u1", { login: null, name: "Alice", image: null }, "ghu_alice")).user.login).toBeNull();
  });
});
