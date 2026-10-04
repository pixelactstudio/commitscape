import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import { MODE_COOKIE, modeOf } from "@commitscape/ui/mode";
import { z } from "zod";
import { leaderboards } from "#/server/boards";
import { peopleBoards } from "#/server/people-boards";
import { deleteMyData, mine } from "#/server/me";
import { auth, githubTokenOf } from "#/server/auth";
import { db, reports } from "#/server/context";
import { env } from "#/server/env";
import { sameOrigin, SiteError } from "#/server/http";

/** The Leaderboards of repositories. */
export const getBoards = createServerFn({ method: "GET" }).handler(() => leaderboards(db(), env.BOARDS_CACHE_SECONDS));

/** The Leaderboards of people, for a window and optionally one repository. */
export const getPeopleBoards = createServerFn({ method: "GET" })
  .validator(z.object({ window: z.enum(["season", "last-season", "90d", "all"]), repo: z.string().max(140).nullable() }))
  .handler(({ data }) => peopleBoards(db(), data.window, data.repo));

/** The signed-in person's repositories, or null. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) return null;
  const token = await githubTokenOf(s.user.id, request.headers);
  const user = s.user as typeof s.user & { login?: string | null };
  const who = { login: user.login ?? user.name, name: user.name, image: user.image ?? null };
  if (!token) return { user: { login: who.login, name: who.name, avatar: who.image }, installations: [], install: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null, tokenLost: true };
  return { ...(await mine({ api: env.GITHUB_API }, who, token, env.GITHUB_APP_SLUG)), tokenLost: false };
});

/** Deletes the signed-in person's data. */
export const deleteMe = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  if (!sameOrigin(request, env.BETTER_AUTH_URL)) throw new SiteError(403, "Not from this Site.");
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) throw new SiteError(401, "Not signed in.");
  return { reports: await deleteMyData(db(), reports(), s.user.id) };
});

/** Who is signed in, and the Site's origin. */
export const getViewer = createServerFn({ method: "GET" }).handler(async () => {
  const s = await auth.api.getSession({ headers: getRequest().headers });
  const user = s?.user as (NonNullable<typeof s>["user"] & { login?: string | null }) | undefined;
  return {
    origin: new URL(env.BETTER_AUTH_URL).origin,
    public: { PUBLIC_SENTRY_DSN: env.PUBLIC_SENTRY_DSN, PUBLIC_POSTHOG_KEY: env.PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST: env.PUBLIC_POSTHOG_HOST },
    user: user ? { login: user.login ?? user.name, image: user.image ?? null } : null,
    mode: modeOf(getCookie(MODE_COOKIE)),
  };
});
