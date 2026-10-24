import "@tanstack/react-start/server-only";
import { desc, inArray } from "drizzle-orm";
import { schema } from "@commitscape/server";
import { apiOf, type GitHubDeps } from "./github";
import type { Mine } from "./me";
import { privateReposOf, type PrivateRepo } from "./private-work";

const { builds, repoEvents, repositories } = schema;

export type DashboardRepo = { id: string; owner: string; name: string; private: boolean; stars: number | null; builtAt: number | null; building: boolean; account: string };
export type DashboardEvent = { id: string; repo: string; kind: string; actor: string | null; title: string | null; url: string | null; count: number | null; at: number };
export type Allowance = { core: { remaining: number; limit: number; reset: number }; graphql: { remaining: number; limit: number; reset: number } } | null;
export type Dashboard = { repositories: DashboardRepo[]; events: DashboardEvent[]; privateWork: PrivateRepo[]; allowance: Allowance };

type Limit = { remaining?: number; limit?: number; reset?: number };

/** How much of their own GitHub allowance a person has left; asking GitHub this costs nothing. */
export async function allowanceOf(deps: GitHubDeps, token: string): Promise<Allowance> {
  const answer = await (deps.github.fetcher ?? fetch)(`${apiOf(deps.github)}/rate_limit`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "commitscape" } }).catch(() => null);
  if (!answer?.ok) return null;
  const { resources } = (await answer.json()) as { resources?: { core?: Limit; graphql?: Limit } };
  const of = (l?: Limit) => ({ remaining: l?.remaining ?? 0, limit: l?.limit ?? 0, reset: l?.reset ?? 0 });
  return resources ? { core: of(resources.core), graphql: of(resources.graphql) } : null;
}

/** A signed-in person's dashboard: the repositories they connected and how each is read, what happened in them lately, their private work and what it shows, and their GitHub allowance. */
export async function dashboardOf(deps: GitHubDeps, mine: Mine, token: string | null): Promise<Dashboard> {
  const listed = mine.installations.flatMap((i) => i.repositories.map((r) => ({ id: r.name.toLowerCase(), private: r.private, account: i.account })));
  const ids = listed.map((r) => r.id);
  const [rows, open, events, privateWork, allowance] = await Promise.all([
    ids.length > 0 ? deps.db.select().from(repositories).where(inArray(repositories.id, ids)) : [],
    ids.length > 0 ? deps.db.select({ repoId: builds.repoId, state: builds.state }).from(builds).where(inArray(builds.repoId, ids)) : [],
    ids.length > 0 ? deps.db.select().from(repoEvents).where(inArray(repoEvents.repoId, ids)).orderBy(desc(repoEvents.at)).limit(40) : [],
    mine.user.login ? privateReposOf(deps.db, mine.user.login) : [],
    token ? allowanceOf(deps, token) : null,
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const building = new Set(open.filter((b) => b.state === "queued" || b.state === "running").map((b) => b.repoId));
  return {
    repositories: listed
      .map((l) => {
        const row = byId.get(l.id);
        const [owner = "", name = ""] = l.id.split("/");
        return { id: l.id, owner: row?.owner ?? owner, name: row?.name ?? name, private: l.private, stars: row?.stars ?? null, builtAt: row?.reportAt ?? null, building: building.has(l.id), account: l.account };
      })
      .sort((a, b) => (b.builtAt ?? 0) - (a.builtAt ?? 0)),
    events: events.map((e) => ({ id: e.id, repo: e.repoId, kind: e.kind, actor: e.actor, title: e.title, url: e.url, count: e.count, at: e.at })),
    privateWork,
    allowance,
  };
}
