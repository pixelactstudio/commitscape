import "@tanstack/react-start/server-only";
import { wrappedOf, type Wrapped } from "@commitscape/data";
import { SiteError } from "./http";
import { readProfile, type ProfileDeps, type ProfileViewer } from "./profiles";

/** A person's year across GitHub, their private work counted only for themselves. */
export async function wrappedFor(deps: ProfileDeps, viewer: ProfileViewer, login: string, year: number): Promise<Wrapped> {
  const thisYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2008 || year > thisYear) throw new SiteError(404, `Wrapped covers 2008 to ${thisYear}.`);
  return wrappedOf(await readProfile(deps, viewer, login, true), year);
}
