import "@tanstack/react-start/server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, eq } from "drizzle-orm";
import { schema } from "@commitscape/server";
import { db } from "./context";
import { env } from "./env";

type GitHubProfile = { id: number | string; login: string; email?: string | null };

/** Better Auth, signing in with GitHub only. */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db(), { provider: "pg", schema }),
  emailAndPassword: { enabled: false },
  socialProviders: env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET
    ? {
        github: {
          clientId: env.GITHUB_APP_CLIENT_ID,
          clientSecret: env.GITHUB_APP_CLIENT_SECRET,
          disableDefaultScope: true,
          mapProfileToUser: (profile: GitHubProfile) => ({
            login: profile.login,
            email: profile.email || `${profile.id}+${profile.login}@users.noreply.github.com`,
          }),
        },
      }
    : {},
  user: { additionalFields: { login: { type: "string", required: false, input: false } } },
  account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
  session: { expiresIn: 30 * 24 * 3600, updateAge: 24 * 3600, cookieCache: { enabled: true, maxAge: 300 } },
  advanced: { cookiePrefix: "commitscape" },
  plugins: [tanstackStartCookies()],
});

/** A person's GitHub user token, refreshed when it has expired. */
export async function githubTokenOf(userId: string, headers: Headers): Promise<string | null> {
  const [linked] = await db()
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")));
  if (!linked) return null;
  const answer = await auth.api.getAccessToken({ body: { accountId: linked.id, userId }, headers }).catch(() => null);
  return answer?.accessToken ?? null;
}
