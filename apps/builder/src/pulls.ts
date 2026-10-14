import { and, eq, inArray, sql } from "drizzle-orm";
import { decisionOf, foldReview, installationToken, labelsOf, lentToken, now, PULLS_VERSION, reviewStateOf, schema, type Db, type GitHubApp, type ReviewerRow } from "@commitscape/server";
import { GitHubError, graphql, type GitHubApi } from "./github";

const { pullRequests, pullReviews, repositories } = schema;

const PAGE = 25;
const PAGE_MIN = 5;
const DECIDED_AT_ONCE = 20;
const TRIES = 3;
const RETRY_MS = 5000;
const TIMED_OUT = new Set([502, 504]);

type Who = { __typename?: string; login: string } | null;
export type Node = {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt?: string | null;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles?: number | null;
  isDraft?: boolean | null;
  headRefName: string | null;
  baseRefName?: string | null;
  isCrossRepository?: boolean | null;
  headRepositoryOwner?: { login: string } | null;
  author: Who;
  mergedBy?: Who;
  mergeCommit?: { oid: string } | null;
  labels?: { nodes: { name: string; color: string }[] } | null;
  comments?: { totalCount: number } | null;
  commits?: { totalCount: number } | null;
  reviews: { nodes: { author: Who; submittedAt: string | null; state?: string | null }[] };
};
type Page = { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] } } | null };

const QUERY = `query($owner: String!, $name: String!, $after: String, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state createdAt mergedAt closedAt updatedAt additions deletions changedFiles isDraft
        headRefName baseRefName isCrossRepository headRepositoryOwner { login }
        author { __typename login }
        mergedBy { __typename login }
        mergeCommit { oid }
        labels(first: 20) { nodes { name color } }
        comments { totalCount }
        commits { totalCount }
        reviews(first: 40) { nodes { author { __typename login } submittedAt state } }
      }
    }
  }
}`;

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** A login as kept: lower case, and a Bot's with GitHub's `[bot]` suffix so it is never ranked among people. */
export function loginOf(who: Who | undefined): string | null {
  if (!who) return null;
  const login = who.login.toLowerCase();
  return who.__typename === "Bot" && !login.endsWith("[bot]") ? `${login}[bot]` : login;
}

/** A pull request as its row keeps it, from one GraphQL node. */
export function pullRow(repoId: string, n: Node): typeof pullRequests.$inferInsert {
  return {
    repoId,
    number: n.number,
    author: loginOf(n.author),
    state: n.state,
    title: n.title.slice(0, 300),
    createdAt: seconds(n.createdAt),
    mergedAt: n.mergedAt ? seconds(n.mergedAt) : null,
    closedAt: n.closedAt ? seconds(n.closedAt) : null,
    updatedAt: seconds(n.updatedAt),
    additions: n.additions,
    deletions: n.deletions,
    headRef: n.headRefName ? n.headRefName.slice(0, 250) : null,
    baseRef: n.baseRefName ? n.baseRefName.slice(0, 250) : null,
    draft: n.isDraft ?? null,
    changedFiles: n.changedFiles ?? null,
    commits: n.commits?.totalCount ?? null,
    comments: n.comments?.totalCount ?? null,
    headOwner: n.headRepositoryOwner?.login.toLowerCase() ?? null,
    fromFork: n.isCrossRepository ?? null,
    labels: labelsOf(n.labels?.nodes),
    mergedBy: loginOf(n.mergedBy),
    mergeCommit: n.mergeCommit?.oid ?? null,
  };
}

/** Each reviewer's reviews of the pull requests given, the author's own left out. */
export function reviewRows(repoId: string, nodes: Node[]): (typeof pullReviews.$inferInsert)[] {
  const out: (typeof pullReviews.$inferInsert)[] = [];
  for (const n of nodes) {
    const author = loginOf(n.author);
    const by = new Map<string, ReviewerRow>();
    for (const r of n.reviews.nodes) {
      const reviewer = loginOf(r.author);
      const state = reviewStateOf(r.state);
      if (!reviewer || reviewer === author || !r.submittedAt || (r.state && !state)) continue;
      by.set(reviewer, foldReview(by.get(reviewer), state, seconds(r.submittedAt)));
    }
    for (const [reviewer, r] of by) out.push({ repoId, number: n.number, reviewer, ...r });
  }
  return out;
}

const UPDATED = Object.fromEntries(
  (
    [
      ["author", "author"],
      ["state", "state"],
      ["title", "title"],
      ["mergedAt", "merged_at"],
      ["closedAt", "closed_at"],
      ["updatedAt", "updated_at"],
      ["additions", "additions"],
      ["deletions", "deletions"],
      ["headRef", "head_ref"],
      ["baseRef", "base_ref"],
      ["draft", "draft"],
      ["changedFiles", "changed_files"],
      ["commits", "commits"],
      ["comments", "comments"],
      ["headOwner", "head_owner"],
      ["fromFork", "from_fork"],
      ["labels", "labels"],
      ["mergedBy", "merged_by"],
      ["mergeCommit", "merge_commit"],
    ] as const
  ).map(([key, column]) => [key, sql.raw(`excluded.${column}`)]),
);

async function keep(db: Db, repoId: string, nodes: Node[], after: Partial<typeof repositories.$inferInsert> | null): Promise<void> {
  await db.transaction(async (tx) => {
    if (nodes.length > 0) {
      await tx
        .insert(pullRequests)
        .values(nodes.map((n) => pullRow(repoId, n)))
        .onConflictDoUpdate({ target: [pullRequests.repoId, pullRequests.number], set: UPDATED });
      await tx.delete(pullReviews).where(and(eq(pullReviews.repoId, repoId), inArray(pullReviews.number, nodes.map((n) => n.number))));
      const reviews = reviewRows(repoId, nodes);
      if (reviews.length > 0) await tx.insert(pullReviews).values(reviews);
    }
    if (after) await tx.update(repositories).set(after).where(eq(repositories.id, repoId));
  });
}

type Decisions = { repository: Record<string, { number: number; reviewDecision: string | null } | null> | null };

/** Reads the review decision of the open pull requests given, a few at a time, and keeps it; a decision not read stays as it was. */
export async function keepDecisions(db: Db, gh: GitHubApi, repoId: string, owner: string, name: string, numbers: number[]): Promise<number> {
  let kept = 0;
  for (let i = 0; i < numbers.length; i += DECIDED_AT_ONCE) {
    const part = numbers.slice(i, i + DECIDED_AT_ONCE).filter((n) => Number.isInteger(n) && n > 0);
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${part.map((n) => `p${n}: pullRequest(number: ${n}) { number reviewDecision }`).join(" ")} } }`;
    const data = await graphql<Decisions>(gh, query, { owner, name }).catch(() => null);
    const found = Object.values(data?.repository ?? {}).flatMap((p) => (p ? [{ number: p.number, decision: decisionOf(p.reviewDecision) }] : []));
    if (found.length === 0) continue;
    await db.execute(sql`
      UPDATE pull_requests p SET review_decision = d.decision
      FROM unnest(${sql.param(found.map((f) => f.number))}::int[], ${sql.param(found.map((f) => f.decision))}::text[]) AS d(number, decision)
      WHERE p.repo_id = ${repoId} AND p.number = d.number`);
    kept += found.length;
  }
  return kept;
}

export type PullsOutcome = { pages: number; pulls: number; done: boolean; seconds: number; whole: boolean };

/** Reads a repository's pull requests and reviews into Postgres, newest update first; the first read can stop at its time limit and go on later. */
export async function readPulls(db: Db, gh: GitHubApi, repoId: string, owner: string, name: string, deadline: number): Promise<PullsOutcome> {
  const started = Date.now();
  const [row] = await db
    .select({ pullsAt: repositories.pullsAt, cursor: repositories.pullsCursor, mark: repositories.pullsMark, version: repositories.pullsVersion })
    .from(repositories)
    .where(eq(repositories.id, repoId));
  const whole = (row?.version ?? 0) < PULLS_VERSION;
  const since = whole ? null : (row?.pullsAt ?? null);
  let after: string | null = whole ? (row?.cursor ?? null) : null;
  let mark: string | null = whole && after ? (row?.mark ?? null) : null;
  let newest: string | null = null;
  let pages = 0;
  let pulls = 0;
  const outcome = (done: boolean) => ({ pages, pulls, done, whole, seconds: (Date.now() - started) / 1000 });
  let first = PAGE;
  let fine = 0;
  let tries = 0;
  for (;;) {
    if (Date.now() > deadline) return outcome(false);
    const resumed = pages === 0 && after !== null;
    const data: Page | "smaller" | "restart" = await graphql<Page>(gh, QUERY, { owner, name, after, first }).catch((e: unknown) => {
      if (e instanceof GitHubError && TIMED_OUT.has(e.status) && (first > PAGE_MIN || tries < TRIES)) return "smaller";
      if (resumed && e instanceof GitHubError && e.status === 422) return "restart";
      throw e;
    });
    if (data === "smaller") {
      if (first === PAGE_MIN) {
        tries++;
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
      first = Math.max(PAGE_MIN, Math.floor(first / 2));
      continue;
    }
    tries = 0;
    if (first < PAGE && ++fine % 20 === 0) first = Math.min(PAGE, first * 2);
    if (data === "restart") {
      after = null;
      mark = null;
      continue;
    }
    const list = data.repository?.pullRequests;
    if (!list) break;
    pages++;
    const fresh = list.nodes.filter((n) => !since || n.updatedAt > since);
    newest ??= list.nodes[0]?.updatedAt ?? null;
    if (whole) mark ??= newest;
    const more = fresh.length === list.nodes.length && list.pageInfo.hasNextPage;
    const next = more ? list.pageInfo.endCursor : null;
    await keep(db, repoId, fresh, whole && more ? { pullsCursor: next, pullsMark: mark } : null);
    await keepDecisions(db, gh, repoId, owner, name, fresh.filter((n) => n.state === "OPEN").map((n) => n.number));
    pulls += fresh.length;
    if (!more) break;
    after = next;
  }
  const at = whole ? (mark ?? row?.pullsAt ?? null) : (newest ?? since);
  await db
    .update(repositories)
    .set({ pullsAt: at, pullsReadAt: now(), pullsCursor: null, pullsMark: null, ...(whole ? { pullsVersion: PULLS_VERSION } : {}) })
    .where(eq(repositories.id, repoId));
  if (!whole || Date.now() > deadline) return outcome(true);
  const rest = await readPulls(db, gh, repoId, owner, name, deadline);
  return { ...rest, pages: pages + rest.pages, pulls: pulls + rest.pulls, whole: true, seconds: (Date.now() - started) / 1000 };
}

/** The token for a repository's GitHub reads: its own installation's, which spends that installation's allowance; else the one lent by whoever asked for it; else the Builder's own. A private repository only ever uses its installation's. */
export async function pullsToken(db: Db, app: GitHubApp | null, secret: string | undefined, repo: { id: string; isPrivate: boolean; installationId: number | null; name: string }, own: string | null): Promise<string | null> {
  const installed = repo.installationId && app ? await installationToken(app, repo.installationId, repo.name).catch(() => null) : null;
  if (installed || repo.isPrivate) return installed;
  return (await lentToken(db, secret, repo.id).catch(() => null)) ?? own;
}
