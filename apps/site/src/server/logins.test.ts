import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import { schema, type Db } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { loginOf, syncLogin } from "./logins";

let db: Db;

beforeAll(async () => {
  db = await testDb();
});

async function person(id: string, over: { login?: string | null; accountId?: string | null; name?: string } = {}) {
  await db.insert(schema.user).values({ id, name: over.name ?? "Display Name", email: `${id}@example.com`, login: over.login ?? null });
  if (over.accountId !== null) await db.insert(schema.account).values({ id: `a-${id}`, accountId: over.accountId ?? "583231", providerId: "github", userId: id });
}

type Step = { status?: number; body?: unknown };

function github(steps: Record<string, Step | (() => Step)>) {
  const asked: { path: string; token: string | null }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit) => {
    const url = new URL(String(input));
    asked.push({ path: url.pathname, token: new Headers(init.headers).get("authorization") });
    const step = steps[url.pathname];
    const found = typeof step === "function" ? step() : step;
    if (!found) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(found.body ?? {}), { status: found.status ?? 200 });
  }) as unknown as typeof fetch;
  return { asked, fetcher };
}

const octocat = { id: 583_231, login: "octocat" };
const deps = (fetcher: typeof fetch, token?: string) => ({ db, github: { api: "http://github.test", token, fetcher } });
const stored = async (id: string) => (await db.select({ login: schema.user.login }).from(schema.user).where(eq(schema.user.id, id)))[0]?.login;

describe("loginOf", () => {
  test("a kept login is returned without asking GitHub", async () => {
    await person("kept", { login: "octocat" });
    const gh = github({});
    expect(await loginOf(deps(gh.fetcher), "kept")).toBe("octocat");
    expect(gh.asked).toEqual([]);
  });

  test("a missing login is looked up once from the GitHub account id with the Site's token, and kept", async () => {
    await person("lazy");
    const gh = github({ "/user/583231": { body: octocat } });
    expect(await loginOf(deps(gh.fetcher, "site"), "lazy")).toBe("octocat");
    expect(await stored("lazy")).toBe("octocat");
    expect(await loginOf(deps(gh.fetcher, "site"), "lazy")).toBe("octocat");
    expect(gh.asked).toEqual([{ path: "/user/583231", token: "Bearer site" }]);
  });

  test("the person's own token is asked first, so their quota is spent", async () => {
    await person("own", { accountId: "42" });
    const gh = github({ "/user": { body: { id: 42, login: "forty-two" } } });
    expect(await loginOf(deps(gh.fetcher, "site"), "own", async () => "ghu_own")).toBe("forty-two");
    expect(gh.asked).toEqual([{ path: "/user", token: "Bearer ghu_own" }]);
  });

  test("the display name is never taken for a login, and an answer about another account is not believed", async () => {
    await person("wrong", { accountId: "77", name: "octocat" });
    const gh = github({ "/user/77": { body: { id: 78, login: "someone-else" } } });
    expect(await loginOf(deps(gh.fetcher, "site"), "wrong")).toBeNull();
    expect(await stored("wrong")).toBeNull();
  });

  test("a login that is not a GitHub username is not kept", async () => {
    await person("odd", { accountId: "5" });
    const gh = github({ "/user/5": { body: { id: 5, login: "not a login!" } } });
    expect(await loginOf(deps(gh.fetcher, "site"), "odd")).toBeNull();
    expect(await stored("odd")).toBeNull();
  });

  test("when GitHub cannot say, the answer is null and a second try waits a minute", async () => {
    await person("down", { accountId: "6" });
    const gh = github({ "/user/6": { status: 503 } });
    expect(await loginOf(deps(gh.fetcher, "site"), "down")).toBeNull();
    expect(await loginOf(deps(gh.fetcher, "site"), "down")).toBeNull();
    expect(gh.asked).toHaveLength(1);
  });

  test("a rate-limited lookup is not kept as an answer", async () => {
    await person("limited", { accountId: "8" });
    const gh = github({ "/user/8": { status: 403, body: { message: "API rate limit exceeded" } } });
    const before = (await db.select().from(schema.githubCache)).length;
    expect(await loginOf(deps(gh.fetcher, "site"), "limited")).toBeNull();
    expect(await db.select().from(schema.githubCache)).toHaveLength(before);
  });

  test("people asking at once share one lookup", async () => {
    await person("busy", { accountId: "9" });
    const gh = github({ "/user/9": { body: { id: 9, login: "nine" } } });
    const all = await Promise.all([1, 2, 3, 4].map(() => loginOf(deps(gh.fetcher, "site"), "busy")));
    expect(all).toEqual(["nine", "nine", "nine", "nine"]);
    expect(gh.asked).toHaveLength(1);
  });

  test("someone without a GitHub account, or who is not there, has no login", async () => {
    await person("bare", { accountId: null });
    const gh = github({});
    expect(await loginOf(deps(gh.fetcher, "site"), "bare")).toBeNull();
    expect(await loginOf(deps(gh.fetcher, "site"), "nobody")).toBeNull();
    expect(gh.asked).toEqual([]);
  });
});

describe("syncLogin", () => {
  test("replaces a login GitHub has since changed, as at every sign-in", async () => {
    await person("renamed", { login: "old-name", accountId: "11" });
    const gh = github({ "/user": { body: { id: 11, login: "new-name" } } });
    expect(await syncLogin(deps(gh.fetcher), "renamed", "ghu_renamed")).toBe("new-name");
    expect(await stored("renamed")).toBe("new-name");
  });

  test("keeps the old login when GitHub answers nothing usable", async () => {
    await person("steady", { login: "steady", accountId: "12" });
    const gh = github({ "/user": { status: 401 }, "/user/12": { status: 502 } });
    expect(await syncLogin(deps(gh.fetcher, "site"), "steady", "ghu_expired")).toBeNull();
    expect(await stored("steady")).toBe("steady");
  });

  test("falls back to the account id when the person's token is no longer accepted", async () => {
    await person("expired", { accountId: "13" });
    const gh = github({ "/user": { status: 401 }, "/user/13": { body: { id: 13, login: "thirteen" } } });
    expect(await syncLogin(deps(gh.fetcher, "site"), "expired", "ghu_expired")).toBe("thirteen");
    expect(gh.asked.map((a) => a.path)).toEqual(["/user", "/user/13"]);
  });
});
