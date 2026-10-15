import "@tanstack/react-start/server-only";
import { and, eq } from "drizzle-orm";
import type { PrivateShow, Profile, ProfileRepo } from "@commitscape/data";
import { now, schema, type Db } from "@commitscape/server";

const { privateWork, profiles } = schema;

export type PrivateRepo = { repo: string; commits: number; prsMerged: number; reviews: number; language: string | null; colour: string | null; last: string | null; show: PrivateShow };

const nameOf = (r: ProfileRepo) => `${r.owner}/${r.name}`.toLowerCase();

async function ownPrivate(db: Db, login: string): Promise<ProfileRepo[]> {
  const [row] = await db
    .select({ data: profiles.data })
    .from(profiles)
    .where(and(eq(profiles.login, login.toLowerCase()), eq(profiles.scope, "self")));
  if (!row?.data) return [];
  return (JSON.parse(row.data) as Profile).repositories.filter((r) => r.private);
}

async function choicesOf(db: Db, login: string): Promise<Map<string, PrivateShow>> {
  const rows = await db.select().from(privateWork).where(eq(privateWork.login, login.toLowerCase()));
  return new Map(rows.map((r) => [r.repo, r.show as PrivateShow]));
}

/** A person's private repositories, from the Profile read with their own sign-in, and what each shows to everyone else. */
export async function privateReposOf(db: Db, login: string): Promise<PrivateRepo[]> {
  const [repos, chosen] = await Promise.all([ownPrivate(db, login), choicesOf(db, login)]);
  return repos
    .map((r) => ({ repo: `${r.owner}/${r.name}`, commits: r.commits, prsMerged: r.prsMerged, reviews: r.reviews, language: r.language, colour: r.colour, last: r.last, show: chosen.get(nameOf(r)) ?? "hidden" }))
    .sort((a, b) => b.commits + b.prsMerged - (a.commits + a.prsMerged));
}

/** Chooses what one of a person's private repositories shows to everyone else; hidden is kept as no choice at all. */
export async function choosePrivate(db: Db, login: string, repo: string, show: PrivateShow): Promise<void> {
  const key = { login: login.toLowerCase(), repo: repo.toLowerCase() };
  if (show === "hidden") {
    await db.delete(privateWork).where(and(eq(privateWork.login, key.login), eq(privateWork.repo, key.repo)));
    return;
  }
  await db
    .insert(privateWork)
    .values({ ...key, show, updatedAt: now() })
    .onConflictDoUpdate({ target: [privateWork.login, privateWork.repo], set: { show, updatedAt: now() } });
}

/** A public Profile with the private work its person chose to show: named repositories listed with a lock, and every shown repository's numbers summed apart from the public totals. */
export async function withPrivateWork(db: Db, p: Profile): Promise<Profile> {
  const chosen = await choicesOf(db, p.identity.login);
  if (chosen.size === 0) return p;
  const shown = (await ownPrivate(db, p.identity.login)).filter((r) => chosen.has(nameOf(r)));
  if (shown.length === 0) return p;
  const listed = new Set(p.repositories.map(nameOf));
  const named = shown.filter((r) => chosen.get(nameOf(r)) === "named" && !listed.has(nameOf(r)));
  const sum = (k: "commits" | "prsMerged" | "reviews") => shown.reduce((n, r) => n + r[k], 0);
  return {
    ...p,
    repositories: [...p.repositories, ...named.map((r) => ({ ...r, private: true }))],
    privateWork: { repositories: shown.length, named: named.length, commits: sum("commits"), prsMerged: sum("prsMerged"), reviews: sum("reviews") },
  };
}
