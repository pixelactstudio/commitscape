/**
 * Signing in with GitHub, through the GitHub App's user authorization
 * (ADR-0017): the OAuth web flow with the App's client id. A session is a
 * random token in an HttpOnly cookie, kept in D1 as its hash, with GitHub's
 * user token locked by SESSION_KEY. No password, and no library: the whole
 * flow is a few requests, measured like every handler (ADR-0014).
 */
import { eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { access, repositories, sessions, users } from "../db/schema";
import { cookie, sameOrigin, setCookie } from "./cookies";
import { seal, unseal } from "./crypto";
import { json, now, says, sha256 } from "./http";
import { randomId } from "./random";

/** A session lasts thirty days. */
const SESSION_FOR = 30 * 24 * 3600;
const SESSION = "cs_session";
/** The login, readable by the pages to say who is signed in; never trusted by the API. */
const LOGIN = "cs_login";
const STATE = "cs_state";

const oauth = (env: Env) => (env.GITHUB_OAUTH || "https://github.com").replace(/\/$/, "");
const api = (env: Env) => (env.GITHUB_API || "https://api.github.com").replace(/\/$/, "");

/** `GET /api/auth/github`: off to GitHub, with a state to come back with. */
export function signIn(request: Request, env: Env): Response {
  if (!env.GITHUB_APP_CLIENT_ID) return says(503, "Signing in is not set up on this Site yet.");
  const state = randomId();
  const back = `${new URL(request.url).origin}/api/auth/callback`;
  const to = `${oauth(env)}/login/oauth/authorize?client_id=${encodeURIComponent(env.GITHUB_APP_CLIENT_ID)}&redirect_uri=${encodeURIComponent(back)}&state=${state}`;
  return new Response(null, { status: 302, headers: { location: to, "set-cookie": setCookie(request, STATE, state, 600) } });
}

type TokenAnswer = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
};

async function exchange(env: Env, body: Record<string, string>): Promise<TokenAnswer> {
  const answer = await fetch(`${oauth(env)}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, ...body }),
  });
  return (await answer.json().catch(() => ({ error: "unreadable" }))) as TokenAnswer;
}

/** `GET /api/auth/callback`: GitHub sends the person back with a code. */
export async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || state !== cookie(request, STATE) || !code) return says(400, "That sign-in was not started here, or took too long. Try again.");
  const token = await exchange(env, { code });
  if (!token.access_token) return says(502, "GitHub did not sign you in. Try again.");
  const me = await fetch(`${api(env)}/user`, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "user-agent": "commitscape-site" },
  });
  if (!me.ok) return says(502, "GitHub did not say who you are. Try again.");
  const user = (await me.json()) as { id: number; login: string; name: string | null; avatar_url: string };
  const db = drizzle(env.DB);
  const id = String(user.id);
  await db
    .insert(users)
    .values({ id, login: user.login, name: user.name, avatar: user.avatar_url, createdAt: now() })
    .onConflictDoUpdate({ target: users.id, set: { login: user.login, name: user.name, avatar: user.avatar_url } });
  const secret = randomId(32);
  await db.insert(sessions).values({
    id: await sha256(secret),
    userId: id,
    createdAt: now(),
    expiresAt: now() + SESSION_FOR,
    githubToken: await seal(env.SESSION_KEY, token.access_token),
    githubTokenExpiresAt: token.expires_in ? now() + token.expires_in : null,
    githubRefresh: token.refresh_token ? await seal(env.SESSION_KEY, token.refresh_token) : null,
  });
  const headers = new Headers({ location: "/me" });
  headers.append("set-cookie", setCookie(request, SESSION, secret, SESSION_FOR));
  headers.append("set-cookie", setCookie(request, LOGIN, user.login, SESSION_FOR, true));
  headers.append("set-cookie", setCookie(request, STATE, "", 0));
  return new Response(null, { status: 302, headers });
}

export type Session = { id: string; userId: string; token: string };

/**
 * The signed-in session of a request, with a GitHub user token that works:
 * refreshed when it has expired. `null` when not signed in.
 */
export async function session(request: Request, env: Env): Promise<Session | null> {
  const secret = cookie(request, SESSION);
  if (!secret) return null;
  const db = drizzle(env.DB);
  const row = await db.select().from(sessions).where(eq(sessions.id, await sha256(secret))).get();
  if (!row || row.expiresAt < now()) return null;
  if (row.githubTokenExpiresAt && row.githubTokenExpiresAt < now() + 60 && row.githubRefresh) {
    const refresh = await unseal(env.SESSION_KEY, row.githubRefresh);
    const fresh = refresh ? await exchange(env, { grant_type: "refresh_token", refresh_token: refresh }) : null;
    if (!fresh?.access_token) return null;
    await db
      .update(sessions)
      .set({
        githubToken: await seal(env.SESSION_KEY, fresh.access_token),
        githubTokenExpiresAt: fresh.expires_in ? now() + fresh.expires_in : null,
        githubRefresh: fresh.refresh_token ? await seal(env.SESSION_KEY, fresh.refresh_token) : row.githubRefresh,
      })
      .where(eq(sessions.id, row.id));
    return { id: row.id, userId: row.userId, token: fresh.access_token };
  }
  const token = await unseal(env.SESSION_KEY, row.githubToken);
  return token ? { id: row.id, userId: row.userId, token } : null;
}

/** GitHub's API, as the signed-in person. */
export function asUser(env: Env, s: Session, path: string): Promise<Response> {
  return fetch(`${api(env)}${path}`, {
    headers: { authorization: `Bearer ${s.token}`, accept: "application/vnd.github+json", "user-agent": "commitscape-site", "x-github-api-version": "2022-11-28" },
  });
}

type Repo = { full_name: string; private: boolean; description: string | null; html_url: string };

/**
 * `GET /api/me`: who is signed in, and every repository the App may read
 * for them: their installations' repositories, as GitHub lists them to them.
 */
export async function me(request: Request, env: Env): Promise<Response> {
  const s = await session(request, env);
  if (!s) return says(401, "Not signed in.");
  const user = await drizzle(env.DB).select().from(users).where(eq(users.id, s.userId)).get();
  const installed = await asUser(env, s, "/user/installations?per_page=100");
  if (installed.status === 401) return says(401, "GitHub no longer accepts this sign-in. Sign in again.");
  const installations = ((await installed.json()) as { installations?: { id: number; account: { login: string } }[] }).installations ?? [];
  const lists = await Promise.all(
    installations.slice(0, 20).map(async (i) => {
      const answer = await asUser(env, s, `/user/installations/${i.id}/repositories?per_page=100`);
      const repos = ((await answer.json()) as { repositories?: Repo[] }).repositories ?? [];
      return {
        id: i.id,
        account: i.account.login,
        repositories: repos.map((r) => ({ name: r.full_name, private: r.private, description: r.description })),
      };
    }),
  );
  return json({
    user: user ? { login: user.login, name: user.name, avatar: user.avatar } : null,
    installations: lists,
    install: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null,
  });
}

function signedOut(request: Request, body: unknown): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  headers.append("set-cookie", setCookie(request, SESSION, "", 0));
  headers.append("set-cookie", setCookie(request, LOGIN, "", 0, true));
  return new Response(JSON.stringify(body), { headers });
}

/** `POST /api/auth/signout`. */
export async function signOut(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return says(403, "Not from this Site.");
  const secret = cookie(request, SESSION);
  if (secret) await drizzle(env.DB).delete(sessions).where(eq(sessions.id, await sha256(secret)));
  return signedOut(request, { ok: true });
}

/**
 * `POST /api/me/delete`: "Delete my data" (ADR-0017): the account, every
 * session, and the Reports of every repository they connected, at once.
 */
export async function deleteMyData(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return says(403, "Not from this Site.");
  const s = await session(request, env);
  if (!s) return says(401, "Not signed in.");
  const db = drizzle(env.DB);
  const theirs = await db.select().from(repositories).where(eq(repositories.connectedBy, s.userId)).all();
  await removeReports(env, theirs);
  // Their sessions' remembered access answers, in one statement however
  // many sessions: an answer's key starts with its session's id (64 hex
  // digits), and D1 allows LIKE patterns of 50 characters only.
  await env.DB.prepare("DELETE FROM access WHERE substr(key, 1, 64) IN (SELECT id FROM sessions WHERE user_id = ?1)").bind(s.userId).run();
  await db.delete(sessions).where(eq(sessions.userId, s.userId));
  await db.delete(users).where(eq(users.id, s.userId));
  return signedOut(request, { ok: true, reports: theirs.length });
}

/** Deletes repositories' stored Reports, cards and pages, and their rows. */
export async function removeReports(env: Env, rows: (typeof repositories.$inferSelect)[]): Promise<void> {
  // In chunks: D1 binds at most 100 values a statement, R2 deletes at most 1,000 keys a call.
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const keys = chunk.flatMap((r) => [r.reportKey, r.cardKey, r.pageKey]).filter((k): k is string => !!k);
    if (keys.length > 0) await env.REPORTS.delete(keys);
    await drizzle(env.DB)
      .delete(repositories)
      .where(inArray(repositories.id, chunk.map((r) => r.id)));
  }
}

/** Sessions past their thirty days, and access answers past their five minutes. */
export async function sweepSessions(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  await db.delete(sessions).where(lt(sessions.expiresAt, now()));
  await db.delete(access).where(lt(access.until, now()));
}
