import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import { isLogin } from "@commitscape/data";
import { cachedGet, schema } from "@commitscape/server";
import { apiOf, type GitHubDeps } from "./github";

const { account, user } = schema;

export const LOGIN_FOR = 24 * 3600;
export const LOGIN_RETRY = 60_000;

type Who = { id?: number; login?: string };

const looking = new Map<string, Promise<string | null>>();
const failed = new Map<string, number>();

async function accountIdOf(deps: GitHubDeps, userId: string): Promise<string | null> {
  const [linked] = await deps.db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github")));
  return linked?.accountId ?? null;
}

async function whoIs(deps: GitHubDeps, accountId: string, token: string | null): Promise<string | null> {
  const base = apiOf(deps.github);
  const named = (answer: { status: number; body: Who | null }) => (answer.status === 200 && String(answer.body?.id) === accountId && typeof answer.body?.login === "string" && isLogin(answer.body.login) ? answer.body.login : null);
  if (token) {
    const own = named(await cachedGet<Who>(null, { url: `${base}/user`, token, ttl: 0, fetcher: deps.github.fetcher }));
    if (own) return own;
  }
  return named(await cachedGet<Who>(deps.db, { url: `${base}/user/${accountId}`, token: deps.github.token, scope: "public", ttl: LOGIN_FOR, fetcher: deps.github.fetcher }));
}

/** Asks GitHub for a person's current login and keeps it: by their own token when given, else by their account's numeric id. Null when GitHub cannot say. */
export async function syncLogin(deps: GitHubDeps, userId: string, token: string | null = null): Promise<string | null> {
  const accountId = await accountIdOf(deps, userId);
  if (!accountId) return null;
  const login = await whoIs(deps, accountId, token).catch(() => null);
  if (login) await deps.db.update(user).set({ login }).where(eq(user.id, userId));
  return login;
}

/** The signed-in person's GitHub login, looked up once and kept when none was (people who signed in before it was). A failed lookup waits a minute. */
export async function loginOf(deps: GitHubDeps, userId: string, token?: () => Promise<string | null>): Promise<string | null> {
  const [row] = await deps.db.select({ login: user.login }).from(user).where(eq(user.id, userId));
  if (!row) return null;
  if (row.login) return row.login;
  if ((failed.get(userId) ?? 0) > Date.now()) return null;
  const running = looking.get(userId);
  if (running) return running;
  const started = (async () => {
    const login = await syncLogin(deps, userId, (await token?.().catch(() => null)) ?? null).catch(() => null);
    if (!login) {
      failed.set(userId, Date.now() + LOGIN_RETRY);
      if (failed.size > 1000) failed.delete(failed.keys().next().value as string);
    }
    return login;
  })().finally(() => looking.delete(userId));
  looking.set(userId, started);
  return started;
}
