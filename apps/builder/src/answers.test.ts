import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { schema, type Db } from "@commitscape/server";
import { issueAnswers } from "./answers";

const migrations = fileURLToPath(new URL("../../../packages/server/drizzle", import.meta.url));

async function database(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: migrations });
  return db as unknown as Db;
}

const at = (hours: number) => new Date(Date.UTC(2026, 0, 1) + hours * 3_600_000).toISOString();
const user = (login: string, type = "User") => ({ login, type });

test("each of the newest issues is answered by its first comment from someone else who is not a Bot, the typical wait their median", async () => {
  const db = await database();
  const issues = [
    { number: 5, created_at: at(0), comments: 2, user: user("ann") },
    { number: 4, created_at: at(0), comments: 0, user: user("bo") },
    { number: 3, created_at: at(0), comments: 3, user: user("cy") },
    { number: 2, created_at: at(0), comments: 1, user: user("di"), pull_request: {} },
    { number: 1, created_at: at(0), comments: 1, user: user("ed") },
  ];
  const comments: Record<number, unknown[]> = {
    5: [{ created_at: at(1), user: user("ann") }, { created_at: at(2), user: user("max") }],
    3: [{ created_at: at(1), user: user("renovate[bot]", "Bot") }, { created_at: at(2), user: user("github-actions") }, { created_at: at(6), user: null }],
    1: [{ created_at: at(9), user: user("ed") }],
  };
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith("/issues")) return Response.json(issues);
    const n = Number(path.split("/").at(-2));
    return Response.json(comments[n] ?? []);
  }) as unknown as typeof fetch;
  const answers = await issueAnswers(db, { api: "http://gh.test", token: "t", fetcher }, "acme", "rocket");
  expect(answers).toEqual({ asked: 4, answered: 2, typical_hours: 4 });
  expect(asked.some((u) => u.includes("/issues/4/comments") || u.includes("/issues/2/comments"))).toBe(false);
  expect(asked[0]).toBe("http://gh.test/repos/acme/rocket/issues?state=all&sort=created&direction=desc&per_page=100&page=1");
  await issueAnswers(db, { api: "http://gh.test", token: "t", fetcher }, "acme", "rocket");
  expect(asked).toHaveLength(4);
});

test("no answer is given when GitHub cannot be asked", async () => {
  const db = await database();
  const fetcher = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
  expect(await issueAnswers(db, { api: "http://gh.test", token: null, fetcher }, "acme", "rocket")).toBeNull();
});
