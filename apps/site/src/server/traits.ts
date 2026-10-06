import "@tanstack/react-start/server-only";
import { achievementsOf, archetypeChecks, archetypesOf, type Achievement, type Archetype, type ArchetypeCheck } from "@commitscape/data";
import { survivingTotal } from "./engine";
import { readProfile, type ProfileDeps, type ProfileViewer } from "./profiles";

export type Traits = { archetypes: Archetype[]; achievements: Achievement[]; complete: boolean; checks?: ArchetypeCheck[] };

/** A person's Archetypes and Achievements, from their Profile (with their pull requests) and their counted Surviving Lines. */
export async function traitsOf(deps: ProfileDeps, viewer: ProfileViewer, login: string): Promise<Traits> {
  const p = await readProfile(deps, viewer, login, true);
  const engine = await survivingTotal(deps.db, login);
  const input = { totals: p.totals, years: p.years, prs: p.prs, clock: p.clock ?? null, calendar: p.calendar, complete: p.read.complete, engine: engine ? { surviving: engine.surviving, oldest: engine.oldest } : null, now: Math.floor(Date.now() / 1000) };
  return { archetypes: archetypesOf(input), achievements: achievementsOf(input), complete: p.read.complete, checks: archetypeChecks(input) };
}
