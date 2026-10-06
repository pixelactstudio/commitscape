import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { Profile } from "@commitscape/data";
import { lookupProfile, readProfile } from "#/server/profiles";
import { engineOf } from "#/server/engine";
import { survivalOf } from "#/server/survival";
import { traitsOf } from "#/server/traits";
import { wrappedFor } from "#/server/wrapped";
import { deps, profileDeps, profileViewer } from "#/server/viewer";

const withoutPrs = (p: Profile): Profile => ({ ...p, prs: [] });

const person = z.object({ login: z.string().min(1).max(39) });

/** Who a GitHub login is, at once. */
export const getProfileLookup = createServerFn({ method: "GET" })
  .validator(person)
  .handler(({ data }) => lookupProfile(profileDeps(), profileViewer(getRequest()), data.login));

/** A person's Profile from GitHub's yearly totals, quickly. */
export const getProfile = createServerFn({ method: "GET" })
  .validator(person)
  .handler(async ({ data }) => withoutPrs(await readProfile(profileDeps(), profileViewer(getRequest()), data.login)));

/** A person's whole Profile, their pull requests read too. */
export const getFullProfile = createServerFn({ method: "GET" })
  .validator(person)
  .handler(async ({ data }) => withoutPrs(await readProfile(profileDeps(), profileViewer(getRequest()), data.login, true)));

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
  .handler(({ data }) => traitsOf(profileDeps(), profileViewer(getRequest()), data.login));

/** A person's year across GitHub. */
export const getWrapped = createServerFn({ method: "GET" })
  .validator(person.extend({ year: z.number().int() }))
  .handler(({ data }) => wrappedFor(profileDeps(), profileViewer(getRequest()), data.login, data.year));
