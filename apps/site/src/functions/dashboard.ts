import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth, githubTokenOf } from "#/server/auth";
import { db } from "#/server/context";
import { dashboardOf } from "#/server/dashboard";
import { env } from "#/server/env";
import { SiteError } from "#/server/http";
import { loginOf } from "#/server/logins";
import { mine } from "#/server/me";
import { choosePrivate, privateReposOf } from "#/server/private-work";
import { profileDeps } from "#/server/viewer";

async function signedIn() {
  const request = getRequest();
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) throw new SiteError(401, "Sign in to see your dashboard.");
  const token = await githubTokenOf(s.user.id, request.headers);
  const login = await loginOf(profileDeps(), s.user.id, async () => token);
  return { userId: s.user.id, login, token, user: { login, name: s.user.name, image: s.user.image ?? null } };
}

/** The signed-in person's dashboard. */
export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const who = await signedIn();
  const empty = { user: { login: who.login, name: who.user.name, avatar: who.user.image }, installations: [], install: null };
  const listed = who.token ? await mine(profileDeps(), who.userId, who.user, who.token, env.GITHUB_APP_SLUG).catch(() => empty) : empty;
  return { login: who.login, install: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null, ...(await dashboardOf(profileDeps(), listed, who.token)) };
});

/** Chooses what one of the signed-in person's private repositories shows on their public Profile. */
export const setPrivateWork = createServerFn({ method: "POST" })
  .validator(z.object({ repo: z.string().min(3).max(140), show: z.enum(["hidden", "counts", "named"]) }))
  .handler(async ({ data }) => {
    const who = await signedIn();
    if (!who.login) throw new SiteError(400, "GitHub has not told us your username yet.");
    const own = await privateReposOf(db(), who.login);
    if (!own.some((r) => r.repo.toLowerCase() === data.repo.toLowerCase())) throw new SiteError(404, "That is not one of your private repositories.");
    await choosePrivate(db(), who.login, data.repo, data.show);
    return privateReposOf(db(), who.login);
  });
