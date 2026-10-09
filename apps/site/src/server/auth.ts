import "@tanstack/react-start/server-only";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "./context";
import { env } from "./env";
import { syncLogin } from "./logins";
import { createAuth, userTokenOf } from "./sign-in";

/** Better Auth, signing in with GitHub only; every sign-in keeps the person's login. */
export const auth = createAuth({
  db: db(),
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  github: env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET ? { clientId: env.GITHUB_APP_CLIENT_ID, clientSecret: env.GITHUB_APP_CLIENT_SECRET } : null,
  plugins: [tanstackStartCookies()],
  onSignIn: async (userId) => {
    await syncLogin({ db: db(), github: { api: env.GITHUB_API, token: env.GITHUB_TOKEN } }, userId, await githubTokenOf(userId));
  },
});

/** A person's GitHub user token, refreshed when it has expired. */
export function githubTokenOf(userId: string, headers?: Headers): Promise<string | null> {
  return userTokenOf(auth, db(), userId, headers);
}
