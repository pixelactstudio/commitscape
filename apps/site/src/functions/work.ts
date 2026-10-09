import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "#/server/auth";
import { db } from "#/server/context";
import { SiteError } from "#/server/http";
import { loginFor, profileDeps, profileViewer } from "#/server/viewer";
import { sharedWork, shareWork, unshareWork, WorkGateError, workOf } from "#/server/work";

const ask = z.object({ login: z.string().min(1).max(39), from: z.string().length(10), to: z.string().length(10), filter: z.string().max(140).nullable().optional() });

/** A person's Proof of Work for a period, or the sign-in it needs when it is too big for the Site's shared GitHub allowance. */
export const getWork = createServerFn({ method: "GET" })
  .validator(ask)
  .handler(async ({ data }) => {
    try {
      return await workOf(profileDeps(), profileViewer(getRequest()), data.login, data);
    } catch (e) {
      if (e instanceof WorkGateError) return e.gate;
      throw e;
    }
  });

async function me() {
  const s = await auth.api.getSession({ headers: getRequest().headers });
  if (!s) throw new SiteError(401, "Sign in to share your Proof of Work.");
  return { userId: s.user.id, login: await loginFor(getRequest(), s.user.id) };
}

/** Keeps the signed-in person's Proof of Work as a link, with only the private repositories they chose. */
export const shareMyWork = createServerFn({ method: "POST" })
  .validator(ask.extend({ privateRepos: z.array(z.string().max(140)).max(200) }))
  .handler(async ({ data }) => {
    const who = await me();
    if (who.login?.toLowerCase() !== data.login.toLowerCase()) throw new SiteError(403, "Only the person themselves can share their Proof of Work.");
    const work = await workOf(profileDeps(), profileViewer(getRequest()), data.login, data);
    return { id: await shareWork(db(), who.userId, work, data.privateRepos) };
  });

/** A shared Proof of Work. */
export const getSharedWork = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1).max(40) }))
  .handler(({ data }) => sharedWork(db(), data.id));

/** Deletes a shared Proof of Work. */
export const deleteSharedWork = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(40) }))
  .handler(async ({ data }) => {
    await unshareWork(db(), (await me()).userId, data.id);
    return { deleted: true };
  });
