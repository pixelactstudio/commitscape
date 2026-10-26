import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import { analyticsId } from "@commitscape/server";
import { MODE_COOKIE, modeOf } from "@commitscape/ui/mode";
import { visitorOf } from "@commitscape/data/analytics";
import { deleteMyData, mine } from "#/server/me";
import { deletePerson } from "#/server/posthog-people";
import { auth, githubTokenOf } from "#/server/auth";
import { db, reports, siteAnalytics } from "#/server/context";
import { env } from "#/server/env";
import { sameOrigin, SiteError } from "#/server/http";
import { loginOf } from "#/server/logins";
import { loginFor, profileDeps } from "#/server/viewer";

/** The signed-in person's repositories, or null. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) return null;
  const token = await githubTokenOf(s.user.id, request.headers);
  const login = await loginOf(profileDeps(), s.user.id, async () => token);
  const who = { login, name: s.user.name, image: s.user.image ?? null };
  if (!token) return { user: { login, name: who.name, avatar: who.image }, installations: [], install: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null, tokenLost: true };
  return { ...(await mine(profileDeps(), s.user.id, who, token, env.GITHUB_APP_SLUG)), tokenLost: false };
});

/** Deletes the signed-in person's data. */
export const deleteMe = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  if (!sameOrigin(request, env.BETTER_AUTH_URL)) throw new SiteError(403, "Not from this Site.");
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) throw new SiteError(401, "Not signed in.");
  await loginFor(request, s.user.id);
  const removed = await deleteMyData(db(), reports(), s.user.id);
  siteAnalytics().capture("data deleted", { userId: null }, { reports: removed });
  if (env.TOKEN_SECRET) await deletePerson(analyticsId(s.user.id, env.TOKEN_SECRET), { apiHost: env.PUBLIC_POSTHOG_HOST, key: env.POSTHOG_PERSONAL_API_KEY, project: env.POSTHOG_PROJECT_ID });
  return { reports: removed };
});

/** Who is signed in, the Site's origin, and the visitor's analytics region and choice. The login is null when GitHub could not say, never the display name. */
export const getViewer = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const s = await auth.api.getSession({ headers: request.headers });
  const visitor = visitorOf(request.headers, env.COUNTRY_HEADER);
  return {
    origin: new URL(env.BETTER_AUTH_URL).origin,
    public: { PUBLIC_SENTRY_DSN: env.PUBLIC_SENTRY_DSN, PUBLIC_POSTHOG_KEY: env.PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST: env.PUBLIC_POSTHOG_HOST, PUBLIC_LANDING_URL: env.PUBLIC_LANDING_URL },
    user: s ? { login: await loginFor(request, s.user.id), name: s.user.name, image: s.user.image ?? null } : null,
    mode: modeOf(getCookie(MODE_COOKIE)),
    analytics: { region: visitor.region.id, choice: visitor.choice, level: visitor.level, id: s && env.TOKEN_SECRET ? analyticsId(s.user.id, env.TOKEN_SECRET) : null },
  };
});
