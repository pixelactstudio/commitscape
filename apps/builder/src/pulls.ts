import { and, eq, inArray, sql } from "drizzle-orm";
import { installationToken, now, schema, type Db, type GitHubApp } from "@commitscape/server";
import { graphql, type GitHubApi } from "./github";

const { pullRequests, pullReviews, repositories } = schema;

const PAGE = 50;

type Who = { __typename?: string; login: string } | null;
type Node = {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  updatedAt: string;
  additions: number;
  deletions: number;
  author: Who;
  reviews: { nodes: { author: Who; submittedAt: string | null }[] };
};
type Page = { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] } } | null };

const QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: ${PAGE}, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state createdAt mergedAt updatedAt additions deletions
        author { __typename login }
        reviews(first: 40) { nodes { author { __typename login } submittedAt } }
      }
    }
  }
}`;

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** A login as kept: lower case, and a Bot's with GitHub's `[bot]` suffix so it is never ranked among people. */
export function loginOf(who: Who): string | null {
  if (!who) return null;
  const login = who.login.toLowerCase();
  return who.__typename === "Bot" && !login.endsWith("[bot]") ? `${login}[bot]` : login;
}

export type PullsOutcome = { pages: number; pulls: number; done: boolean; seconds: number };

/** Reads a repository's pull requests and reviews into Postgres: all of them the first time, then only those updated since the last read. */
export async function readPulls(db: Db, gh: GitHubApi, repoId: string, owner: string, name: string, deadline: number): Promise<PullsOutcome> {
  const started = Date.now();
  const [row] = await db.select({ pullsAt: repositories.pullsAt }).from(repositories).where(eq(repositories.id, repoId));
  const since = row?.pullsAt ?? null;
  let after: string | null = null;
  let newest: string | null = null;
  let pages = 0;
  let pulls = 0;
  for (;;) {
    if (Date.now() > deadline) return { pages, pulls, done: false, seconds: (Date.now() - started) / 1000 };
    const data: Page = await graphql<Page>(gh, QUERY, { owner, name, after });
    const list = data.repository?.pullRequests;
    if (!list) break;
    pages++;
    const fresh = list.nodes.filter((n) => !since || n.updatedAt > since);
    newest ??= list.nodes[0]?.updatedAt ?? null;
    if (fresh.length > 0) {
      await db.transaction(async (tx) => {
        const rows = fresh.map((n) => ({
          repoId,
          number: n.number,
          author: loginOf(n.author),
          state: n.state,
          title: n.title.slice(0, 300),
          createdAt: seconds(n.createdAt),
          mergedAt: n.mergedAt ? seconds(n.mergedAt) : null,
          updatedAt: seconds(n.updatedAt),
          additions: n.additions,
          deletions: n.deletions,
        }));
        await tx
          .insert(pullRequests)
          .values(rows)
          .onConflictDoUpdate({
            target: [pullRequests.repoId, pullRequests.number],
            set: { author: sql`excluded.author`, state: sql`excluded.state`, title: sql`excluded.title`, mergedAt: sql`excluded.merged_at`, updatedAt: sql`excluded.updated_at`, additions: sql`excluded.additions`, deletions: sql`excluded.deletions` },
          });
        await tx.delete(pullReviews).where(and(eq(pullReviews.repoId, repoId), inArray(pullReviews.number, fresh.map((n) => n.number))));
        const reviews = new Map<string, { repoId: string; number: number; reviewer: string; reviews: number; firstAt: number }>();
        for (const n of fresh) {
          const author = loginOf(n.author);
          for (const r of n.reviews.nodes) {
            const reviewer = loginOf(r.author);
            if (!reviewer || reviewer === author || !r.submittedAt) continue;
            const key = `${n.number}:${reviewer}`;
            const at = seconds(r.submittedAt);
            const seen = reviews.get(key);
            if (seen) {
              seen.reviews++;
              seen.firstAt = Math.min(seen.firstAt, at);
            } else reviews.set(key, { repoId, number: n.number, reviewer, reviews: 1, firstAt: at });
          }
        }
        if (reviews.size > 0) await tx.insert(pullReviews).values([...reviews.values()]);
      });
      pulls += fresh.length;
    }
    if (fresh.length < list.nodes.length || !list.pageInfo.hasNextPage) break;
    after = list.pageInfo.endCursor;
  }
  await db.update(repositories).set({ pullsAt: newest ?? since, pullsReadAt: now() }).where(eq(repositories.id, repoId));
  return { pages, pulls, done: true, seconds: (Date.now() - started) / 1000 };
}

/** The token to read a repository's pull requests with: an installation's for a private one, else the Builder's own. */
export async function pullsToken(app: GitHubApp | null, repo: { isPrivate: boolean; installationId: number | null; name: string }, own: string | null): Promise<string | null> {
  if (!repo.isPrivate) return own;
  return repo.installationId && app ? installationToken(app, repo.installationId, repo.name) : null;
}
