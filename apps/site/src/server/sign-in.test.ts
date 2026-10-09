import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { schema, type Db } from "@commitscape/server";
import { testDb } from "#/test/deps";
import { syncLogin } from "./logins";
import { createAuth, userTokenOf } from "./sign-in";

afterEach(() => vi.unstubAllGlobals());

const SITE = "http://site.test";

type Person = { id: number; login: string; name: string };

function github(person: () => Person) {
  const asked: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    const p = person();
    if (url.pathname === "/login/oauth/access_token") return Response.json({ access_token: "ghu_token", token_type: "bearer", scope: "", expires_in: 28_800, refresh_token: "ghr_token", refresh_token_expires_in: 15_811_200 });
    if (url.pathname === "/user/emails") return Response.json([{ email: `${p.login}@example.com`, primary: true, verified: true }]);
    if (url.pathname === "/user" || url.pathname === `/user/${p.id}`) return Response.json({ id: p.id, login: p.login, name: p.name, avatar_url: `https://a/${p.login}`, email: `${p.login}@example.com` });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { asked, fetcher };
}

async function signIn(auth: ReturnType<typeof createAuth>) {
  const start = await auth.handler(new Request(`${SITE}/api/auth/sign-in/social`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ provider: "github", callbackURL: "/me" }) }));
  const { url } = (await start.json()) as { url: string };
  const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const back = await auth.handler(new Request(`${SITE}/api/auth/callback/github?code=c&state=${new URL(url).searchParams.get("state")}`, { headers: { cookie } }));
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/me");
}

function setup(db: Db, person: () => Person, token: { value: string | null } = { value: null }) {
  const gh = github(person);
  vi.stubGlobal("fetch", gh.fetcher);
  const deps = { db, github: { api: "http://github.test", fetcher: gh.fetcher } };
  const auth: ReturnType<typeof createAuth> = createAuth({
    db,
    baseURL: SITE,
    secret: "s".repeat(40),
    github: { clientId: "id", clientSecret: "secret" },
    onSignIn: async (userId) => {
      token.value = await userTokenOf(auth, db, userId);
      await syncLogin(deps, userId, token.value);
    },
  });
  return { auth, gh, token };
}

describe("signing in with GitHub", () => {
  test("a new person's login is kept at their first sign-in, with the token GitHub just gave", async () => {
    const db = await testDb();
    const { auth, token } = setup(db, () => ({ id: 583_231, login: "octocat", name: "The Octocat" }));
    await signIn(auth);
    const [row] = await db.select().from(schema.user);
    expect(row).toMatchObject({ name: "The Octocat", login: "octocat" });
    expect(token.value).toBe("ghu_token");
    const [linked] = await db.select().from(schema.account);
    expect(linked).toMatchObject({ providerId: "github", accountId: "583231" });
    expect(linked?.accessToken).not.toBe("ghu_token");
  });

  test("a person whose login was never kept gets it at their next sign-in, and a renamed one gets the new name", async () => {
    const db = await testDb();
    let person: Person = { id: 7, login: "old-name", name: "Same Person" };
    const { auth } = setup(db, () => person);
    await signIn(auth);
    await db.update(schema.user).set({ login: null });
    person = { id: 7, login: "old-name", name: "Same Person" };
    await signIn(auth);
    expect((await db.select().from(schema.user)).map((u) => [u.name, u.login])).toEqual([["Same Person", "old-name"]]);
    person = { id: 7, login: "new-name", name: "Same Person" };
    await signIn(auth);
    expect(await db.select({ login: schema.user.login }).from(schema.user)).toEqual([{ login: "new-name" }]);
    expect(await db.select().from(schema.user)).toHaveLength(1);
    expect(await db.select().from(schema.session)).toHaveLength(3);
  });

  test("a sign-in still works when GitHub cannot say who the person is", async () => {
    const db = await testDb();
    const gh = github(() => ({ id: 9, login: "nine", name: "Nine" }));
    vi.stubGlobal("fetch", gh.fetcher);
    const auth: ReturnType<typeof createAuth> = createAuth({
      db,
      baseURL: SITE,
      secret: "s".repeat(40),
      github: { clientId: "id", clientSecret: "secret" },
      onSignIn: async () => {
        throw new Error("GitHub is down");
      },
    });
    await signIn(auth);
    expect(await db.select({ login: schema.user.login, name: schema.user.name }).from(schema.user).where(eq(schema.user.name, "Nine"))).toEqual([{ login: null, name: "Nine" }]);
    expect(await db.select().from(schema.session)).toHaveLength(1);
  });
});
