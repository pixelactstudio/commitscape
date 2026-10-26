import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import { MODE_COOKIE, modeOf } from "@commitscape/ui/mode";
import { deleteMyData, mine } from "#/server/me";
import { auth, githubTokenOf } from "#/server/auth";
import { db, reports } from "#/server/context";
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
  return { reports: await deleteMyData(db(), reports(), s.user.id) };
});

/** Who is signed in, and the Site's origin. The login is null when GitHub could not say, never the display name. */
export const getViewer = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const s = await auth.api.getSession({ headers: request.headers });
  return {
    origin: new URL(env.BETTER_AUTH_URL).origin,
    public: { PUBLIC_SENTRY_DSN: env.PUBLIC_SENTRY_DSN, PUBLIC_POSTHOG_KEY: env.PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST: env.PUBLIC_POSTHOG_HOST, PUBLIC_LANDING_URL: env.PUBLIC_LANDING_URL },
    user: s ? { login: await loginFor(request, s.user.id), name: s.user.name, image: s.user.image ?? null } : null,
    mode: modeOf(getCookie(MODE_COOKIE)),
  };
});
