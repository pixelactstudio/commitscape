import "@tanstack/react-start/server-only";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@commitscape/server";

type GitHubProfile = { id: number | string; login: string; email?: string | null };

export type AuthConfig = {
  db: Db;
  baseURL: string;
  secret: string;
  github: { clientId: string; clientSecret: string } | null;
  plugins?: BetterAuthPlugin[];
  onSignIn: (userId: string) => Promise<void>;
};

/** Better Auth, signing in with GitHub only. It drops the `login` GitHub sends (the field takes no outside input), so `onSignIn` runs after every sign-in to keep it. */
export function createAuth(config: AuthConfig) {
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(config.db, { provider: "pg", schema }),
    emailAndPassword: { enabled: false },
    socialProviders: config.github
      ? {
          github: {
            clientId: config.github.clientId,
            clientSecret: config.github.clientSecret,
            disableDefaultScope: true,
            mapProfileToUser: (profile: GitHubProfile) => ({
              email: profile.email || `${profile.id}+${profile.login}@users.noreply.github.com`,
            }),
          },
        }
      : {},
    user: { additionalFields: { login: { type: "string", required: false, input: false } } },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: { expiresIn: 30 * 24 * 3600, updateAge: 24 * 3600, cookieCache: { enabled: true, maxAge: 300 } },
    advanced: { cookiePrefix: "commitscape" },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await config.onSignIn(session.userId).catch(() => undefined);
          },
        },
      },
    },
    plugins: config.plugins ?? [],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** A person's GitHub user token, refreshed when expired; without request headers it is read by id, as just after sign-in. */
export async function userTokenOf(auth: Auth, db: Db, userId: string, headers?: Headers): Promise<string | null> {
  const [linked] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")));
  if (!linked) return null;
  const answer = await auth.api.getAccessToken({ body: { accountId: linked.id, userId }, headers }).catch(() => null);
  return answer?.accessToken ?? null;
}
