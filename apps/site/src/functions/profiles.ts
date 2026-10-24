import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { Profile } from "@commitscape/data";
import { lookupProfile, readProfile } from "#/server/profiles";
import { engineOf } from "#/server/engine";
import { commitsOnDay } from "#/server/day-commits";
import { survivalOf } from "#/server/survival";
import { traitsOf } from "#/server/traits";
import { wrappedFor } from "#/server/wrapped";
import { deps, profileDeps, profileViewer } from "#/server/viewer";
import { lockedFor, orLocked } from "#/server/gates";
import { isLocked } from "#/lib/gates";
import { SiteError } from "#/server/http";

const withoutPrs = (p: Profile): Profile => ({ ...p, prs: [] });

const person = z.object({ login: z.string().min(1).max(39) });

/** Who a GitHub login is, at once. */
export const getProfileLookup = createServerFn({ method: "GET" })
  .validator(person)
  .handler(async ({ data }) => {
    const found = await orLocked(() => lookupProfile(profileDeps(), profileViewer(getRequest()), data.login));
    return isLocked(found) ? { status: "locked" as const, login: data.login, requests: 0 } : found;
  });

/** A person's Profile from GitHub's yearly totals, quickly. */
export const getProfile = createServerFn({ method: "GET" })
  .validator(person)
  .handler(({ data }) => orLocked(async () => withoutPrs(await readProfile(profileDeps(), profileViewer(getRequest()), data.login))));

/** A person's whole Profile, their pull requests read too. */
export const getFullProfile = createServerFn({ method: "GET" })
  .validator(person)
  .handler(async ({ data }) => {
    const viewer = profileViewer(getRequest());
    return (await lockedFor("profile", viewer)) ?? orLocked(async () => withoutPrs(await readProfile(profileDeps(), viewer, data.login, true)));
  });

/** What the engine knows of a person in the repositories the Site has built, and which of the repositories they committed to wait to be read. */
export const getEngine = createServerFn({ method: "GET" })
  .validator(person)
  .handler(async ({ data }) => {
    const viewer = profileViewer(getRequest());
    const profile = await readProfile(profileDeps(), viewer, data.login).catch(() => null);
    return profile ? survivalOf(deps(), viewer, data.login, profile.repositories) : engineOf(deps(), viewer, data.login);
  });

/** A person's Archetypes and Achievements. */
export const getTraits = createServerFn({ method: "GET" })
  .validator(person)
  .handler(({ data }) => orLocked(() => traitsOf(profileDeps(), profileViewer(getRequest()), data.login)));

/** A person's year across GitHub. */
export const getWrapped = createServerFn({ method: "GET" })
  .validator(person.extend({ year: z.number().int() }))
  .handler(async ({ data }) => {
    const viewer = profileViewer(getRequest());
    const locked = await lockedFor("wrapped", viewer);
    if (locked) throw new SiteError(401, "Sign in to see a year in review.");
    return wrappedFor(profileDeps(), viewer, data.login, data.year);
  });

/** A person's commits on one day, in the public repositories the Site has read. */
export const getDayCommits = createServerFn({ method: "GET" })
  .validator(person.extend({ day: z.number().int().min(0).max(200_000) }))
  .handler(({ data }) => commitsOnDay(deps(), data.login, data.day));
