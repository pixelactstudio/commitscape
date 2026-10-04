import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { db } from "#/server/context";
import { SiteError } from "#/server/http";
import { answer, createCrew, createRace, crewOf, invite, leave, mineOf, raceOf } from "#/server/races";
import { personOf, profileDeps, profileViewer } from "#/server/viewer";

const id = z.object({ id: z.string().min(1).max(40) });
const kind = z.enum(["race", "crew"]);
const logins = z.array(z.string().max(40)).max(20);

async function me() {
  const who = await personOf(getRequest());
  if (!who) throw new SiteError(401, "Sign in with GitHub first.");
  return who;
}

async function token() {
  return profileViewer(getRequest()).token().catch(() => null);
}

/** A Race and its live Standings. */
export const getRace = createServerFn({ method: "GET" })
  .validator(id)
  .handler(async ({ data }) => raceOf(profileDeps(), await personOf(getRequest()), data.id, await token()));

/** A Crew, this Season's Standings and last Season's recap. */
export const getCrew = createServerFn({ method: "GET" })
  .validator(id)
  .handler(async ({ data }) => crewOf(profileDeps(), await personOf(getRequest()), data.id, await token()));

/** The signed-in person's Races, Crews and invitations, or null when signed out. */
export const getMyRaces = createServerFn({ method: "GET" }).handler(async () => {
  const who = await personOf(getRequest());
  return who ? { login: who.login, ...(await mineOf(db(), who)) } : null;
});

/** Starts a Race. */
export const startRace = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().max(80), from: z.string().length(10), to: z.string().length(10), invite: logins }))
  .handler(async ({ data }) => ({ id: await createRace(db(), await me(), data) }));

/** Starts a Crew. */
export const startCrew = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().max(80), invite: logins }))
  .handler(async ({ data }) => ({ id: await createCrew(db(), await me(), data) }));

/** Invites more people to a Race or a Crew. */
export const inviteMore = createServerFn({ method: "POST" })
  .validator(id.extend({ kind, invite: logins }))
  .handler(async ({ data }) => {
    await invite(db(), await me(), data.kind, data.id, data.invite);
    return { ok: true };
  });

/** Accepts or declines an invitation. */
export const answerInvitation = createServerFn({ method: "POST" })
  .validator(id.extend({ kind, accept: z.boolean() }))
  .handler(async ({ data }) => {
    await answer(db(), await me(), data.kind, data.id, data.accept);
    return { ok: true };
  });

/** Leaves a Race or a Crew at once. */
export const leaveIt = createServerFn({ method: "POST" })
  .validator(id.extend({ kind }))
  .handler(async ({ data }) => {
    await leave(db(), await me(), data.kind, data.id);
    return { ok: true };
  });
