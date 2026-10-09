import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "#/server/auth";
import { db } from "#/server/context";
import { SiteError } from "#/server/http";
import { addRival, removeRival, rivalLogins, rivalsOf, versusFullOf } from "#/server/versus";
import { loginFor, profileDeps } from "#/server/viewer";

const login = z.string().min(1).max(39);

/** Two people side by side, in full. */
export const getVersus = createServerFn({ method: "GET" })
  .validator(z.object({ a: login, b: login }))
  .handler(({ data }) => versusFullOf(profileDeps(), data.a, data.b));

async function me() {
  const s = await auth.api.getSession({ headers: getRequest().headers });
  if (!s) return null;
  const who = await loginFor(getRequest(), s.user.id);
  return who ? { userId: s.user.id, login: who } : null;
}

/** The signed-in person's login and their Rivals' logins, or null when signed out. */
export const getMyRivals = createServerFn({ method: "GET" }).handler(async () => {
  const who = await me();
  return who ? { login: who.login, logins: await rivalLogins(db(), who.userId) } : null;
});

/** How far the signed-in person is from each of their Rivals. */
export const getRivalGaps = createServerFn({ method: "GET" }).handler(async () => {
  const who = await me();
  return who ? rivalsOf(profileDeps(), who.userId, who.login) : [];
});

/** Adds or removes a Rival for the signed-in person. */
export const setMyRival = createServerFn({ method: "POST" })
  .validator(z.object({ login, on: z.boolean() }))
  .handler(async ({ data }) => {
    const who = await me();
    if (!who) throw new SiteError(401, "Sign in to keep Rivals.");
    if (data.on) await addRival(db(), who.userId, who.login, data.login);
    else await removeRival(db(), who.userId, data.login);
    return { logins: await rivalLogins(db(), who.userId) };
  });
