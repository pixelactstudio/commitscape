import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { schema, type Db } from "@commitscape/server";
import { accountsFor, noreplyLogin, signaturesOf, type Signature } from "./accounts";

const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const sha = (n: number) => n.toString(16).padStart(40, "0");
const sig = (email: string, commits: number, n: number): Signature => ({ email, name: email, commits, sha: sha(n) });

test("signatures are read as commitscape writes them, and a noreply address names its login", () => {
  expect(signaturesOf(JSON.stringify([{ email: "a@x", name: "A", commits: 2, sha: sha(1) }, { email: 3 }]))).toEqual([{ email: "a@x", name: "A", commits: 2, sha: sha(1) }]);
  expect(noreplyLogin("12345+Octo-Cat@users.noreply.github.com")).toBe("Octo-Cat");
  expect(noreplyLogin("octocat@users.noreply.github.com")).toBe("octocat");
  expect(noreplyLogin("49699333+dependabot[bot]@users.noreply.github.com")).toBe("dependabot[bot]");
  expect(noreplyLogin("ada@example.com")).toBeNull();
});

test("logins are asked for the emails with most commits, up to the cap, each kept for the next Build", async () => {
  const db = await database();
  const asked: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    asked.push(url);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t");
    const n = Number.parseInt(new URL(url).searchParams.get("sha") ?? "", 16);
    return Response.json([{ sha: sha(n), author: n === 3 ? null : { login: `user${n}` } }], { headers: { etag: `"e${n}"` } });
  }) as unknown as typeof fetch;
  const gh = { api: "http://gh.test/", token: "t", fetcher };
  const list = [sig("one@x", 1, 1), sig("two@x", 9, 2), sig("three@x", 5, 3), sig("1+bot[bot]@users.noreply.github.com", 50, 4)];
  const first = await accountsFor(db, gh, { owner: "acme", name: "rocket", scope: "public" }, list, 2);
  expect(first.accounts).toEqual({ "two@x": "user2", "1+bot[bot]@users.noreply.github.com": "bot[bot]" });
  expect(asked).toEqual([`http://gh.test/repos/acme/rocket/commits?sha=${sha(2)}&per_page=1`, `http://gh.test/repos/acme/rocket/commits?sha=${sha(3)}&per_page=1`]);
  await accountsFor(db, gh, { owner: "acme", name: "rocket", scope: "public" }, list, 2);
  expect(asked).toHaveLength(2);
  await accountsFor(db, gh, { owner: "acme", name: "rocket", scope: "acme/rocket" }, list, 2);
  expect(asked).toHaveLength(4);
});

test("a rate limit stops the asking and keeps what was found", async () => {
  const db = await database();
  let asked = 0;
  const fetcher = (async () => {
    asked++;
    return new Response("{}", { status: 403 });
  }) as unknown as typeof fetch;
  const list = Array.from({ length: 40 }, (_, i) => sig(`p${i}@x`, 40 - i, i + 1));
  const found = await accountsFor(db, { api: "http://gh.test", token: null, fetcher }, { owner: "a", name: "b", scope: "public" }, list, 300);
  expect(found.accounts).toEqual({});
  expect(asked).toBe(8);
});
