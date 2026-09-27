import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { leaderboards } from "#/server/boards";
import { deleteMyData, mine } from "#/server/me";
import { auth, githubTokenOf } from "#/server/auth";
import { db, reports } from "#/server/context";
import { env } from "#/server/env";
import { sameOrigin, SiteError } from "#/server/http";

/** The Leaderboards. */
export const getBoards = createServerFn({ method: "GET" }).handler(() => leaderboards(db(), env.BOARDS_CACHE_SECONDS));

/** The signed-in person's repositories, or null. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) return null;
  const token = await githubTokenOf(s.user.id, request.headers);
  if (!token) throw new SiteError(401, "GitHub no longer accepts this sign-in. Sign in again.");
  const user = s.user as typeof s.user & { login?: string | null };
  return mine({ api: env.GITHUB_API }, { login: user.login ?? user.name, name: user.name, image: user.image ?? null }, token, env.GITHUB_APP_SLUG);
});

/** Deletes the signed-in person's data. */
export const deleteMe = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  if (!sameOrigin(request)) throw new SiteError(403, "Not from this Site.");
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
    user: user ? { login: user.login ?? user.name, image: user.image ?? null } : null,
  };
});
