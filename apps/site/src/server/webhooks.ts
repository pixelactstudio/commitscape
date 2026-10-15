import "@tanstack/react-start/server-only";
import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Facts } from "@commitscape/data";
import { busy, labelsOf, now, PRIORITY, queueBuild, randomId, removeReports, reviewStateOf, same, schema, type Db, type Queue, type Storage } from "@commitscape/server";

const { account, builds, lentTokens, pullRequests, pullReviews, repoEvents, repositories, user } = schema;

type Who = { login?: string; type?: string } | null | undefined;
type Named = { full_name?: string };
type Repo = Named & { private?: boolean; stargazers_count?: number; forks_count?: number; open_issues_count?: number; default_branch?: string; html_url?: string };
type Side = { ref?: string; user?: Who; repo?: (Named & { owner?: Who }) | null };
type Pull = {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
  comments?: number;
  draft?: boolean;
  user: Who;
  merged_by?: Who;
  merge_commit_sha?: string | null;
  labels?: { name?: string; color?: string }[];
  head?: Side;
  base?: Side;
  html_url?: string;
};

export type Event = {
  action?: string;
  installation?: { id?: number };
  repository?: Repo;
  sender?: Who;
  repositories?: Named[];
  repositories_added?: Named[];
  repositories_removed?: Named[];
  ref?: string;
  ref_type?: string;
  commits?: unknown[];
  head_commit?: { message?: string; url?: string } | null;
  pull_request?: Pull;
  review?: { user: Who; submitted_at?: string | null; state?: string | null };
  release?: { tag_name?: string; name?: string | null; html_url?: string };
  forkee?: { full_name?: string; html_url?: string };
};

export type WebhookDeps = { db: Db; storage: Storage; queue: () => Promise<Queue> };

export type Handled = { removed: number; built: boolean; kept: boolean };

const PUSH_BUILD_AFTER = 30 * 60;

/** Whether a webhook body carries GitHub's signature under the secret. */
export function githubSigned(secret: string | undefined, header: string | null, body: string): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  return same(header, `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
}

const idOf = (r?: Named) => (r?.full_name ?? "").toLowerCase();
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** A login as the pull request tables keep it: lower case, a Bot's with GitHub's `[bot]` suffix. */
export function loginOf(who: Who): string | null {
  if (!who?.login) return null;
  const login = who.login.toLowerCase();
  return who.type === "Bot" && !login.endsWith("[bot]") ? `${login}[bot]` : login;
}

async function keepCounts(db: Db, row: typeof repositories.$inferSelect, r: Repo) {
  if (r.stargazers_count === undefined) return;
  const facts = row.facts ? (JSON.parse(row.facts) as Facts) : null;
  const next = facts ? { ...facts, stars: r.stargazers_count, forks: r.forks_count ?? facts.forks, openIssues: r.open_issues_count ?? facts.openIssues } : null;
  await db
    .update(repositories)
    .set({ stars: r.stargazers_count, ...(next ? { facts: JSON.stringify(next) } : {}) })
    .where(eq(repositories.id, row.id));
}

async function record(db: Db, delivery: string | undefined, repoId: string, e: { kind: string; actor?: string | null; title?: string | null; url?: string | null; count?: number | null }) {
  await db
    .insert(repoEvents)
    .values({ id: delivery ?? randomId(), repoId, kind: e.kind, actor: e.actor ?? null, title: e.title?.slice(0, 300) ?? null, url: e.url ?? null, count: e.count ?? null, at: now() })
    .onConflictDoNothing();
}

const PULL_SET = {
  author: sql.raw("excluded.author"),
  state: sql.raw("excluded.state"),
  title: sql.raw("excluded.title"),
  mergedAt: sql.raw("excluded.merged_at"),
  updatedAt: sql.raw("excluded.updated_at"),
  additions: sql.raw("excluded.additions"),
  deletions: sql.raw("excluded.deletions"),
  headRef: sql.raw("coalesce(excluded.head_ref, pull_requests.head_ref)"),
  baseRef: sql.raw("coalesce(excluded.base_ref, pull_requests.base_ref)"),
  draft: sql.raw("coalesce(excluded.draft, pull_requests.draft)"),
  changedFiles: sql.raw("coalesce(excluded.changed_files, pull_requests.changed_files)"),
  commits: sql.raw("coalesce(excluded.commits, pull_requests.commits)"),
  comments: sql.raw("coalesce(excluded.comments, pull_requests.comments)"),
  headOwner: sql.raw("coalesce(excluded.head_owner, pull_requests.head_owner)"),
  fromFork: sql.raw("coalesce(excluded.from_fork, pull_requests.from_fork)"),
  labels: sql.raw("coalesce(excluded.labels, pull_requests.labels)"),
  mergedBy: sql.raw("coalesce(excluded.merged_by, pull_requests.merged_by)"),
  mergeCommit: sql.raw("coalesce(excluded.merge_commit, pull_requests.merge_commit)"),
};

/** A pull request as its row keeps it, from a webhook's payload; what the payload lacks is left as it was. */
export function pullRowOf(repoId: string, p: Pull): typeof pullRequests.$inferInsert {
  const head = p.head;
  const fork = head === undefined ? null : head.repo === null ? true : head.repo?.full_name && p.base?.repo?.full_name ? idOf(head.repo) !== idOf(p.base.repo) : null;
  return {
    repoId,
    number: p.number,
    author: loginOf(p.user),
    state: p.merged_at ? "MERGED" : p.state.toUpperCase(),
    title: p.title.slice(0, 300),
    createdAt: seconds(p.created_at),
    mergedAt: p.merged_at ? seconds(p.merged_at) : null,
    closedAt: p.closed_at ? seconds(p.closed_at) : null,
    updatedAt: seconds(p.updated_at),
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    headRef: head?.ref ? head.ref.slice(0, 250) : null,
    baseRef: p.base?.ref ? p.base.ref.slice(0, 250) : null,
    draft: p.draft ?? null,
    changedFiles: p.changed_files ?? null,
    commits: p.commits ?? null,
    comments: p.comments ?? null,
    headOwner: (head?.repo?.owner?.login ?? head?.user?.login)?.toLowerCase() ?? null,
    fromFork: fork,
    labels: p.labels ? labelsOf(p.labels) : null,
    mergedBy: p.merged_at ? loginOf(p.merged_by) : null,
    mergeCommit: p.merged_at ? (p.merge_commit_sha ?? null) : null,
  };
}

async function keepPull(db: Db, repoId: string, p: Pull) {
  await db
    .insert(pullRequests)
    .values(pullRowOf(repoId, p))
    .onConflictDoUpdate({ target: [pullRequests.repoId, pullRequests.number], set: p.closed_at === undefined ? PULL_SET : { ...PULL_SET, closedAt: sql.raw("excluded.closed_at") } });
}

async function keepReview(db: Db, repoId: string, p: Pull, who: Who, at: string | null | undefined, raw: string | null | undefined) {
  const reviewer = loginOf(who);
  const state = reviewStateOf(raw);
  if (!reviewer || !at || reviewer === loginOf(p.user) || (raw && !state)) return;
  const when = seconds(at);
  const decisive = state === "approved" || state === "changes_requested" || state === "dismissed";
  await db
    .insert(pullReviews)
    .values({ repoId, number: p.number, reviewer, reviews: 1, firstAt: when, lastAt: when, state, approvedAt: state === "approved" ? when : null })
    .onConflictDoUpdate({
      target: [pullReviews.repoId, pullReviews.number, pullReviews.reviewer],
      set: {
        reviews: sql`${pullReviews.reviews} + 1`,
        firstAt: sql`least(${pullReviews.firstAt}, ${when})`,
        lastAt: sql`greatest(coalesce(${pullReviews.lastAt}, ${pullReviews.firstAt}), ${when})`,
        state: decisive
          ? sql`case when ${when} >= coalesce(${pullReviews.lastAt}, ${pullReviews.firstAt}) or ${pullReviews.state} is null or ${pullReviews.state} = 'commented' then ${state} else ${pullReviews.state} end`
          : sql`coalesce(${pullReviews.state}, ${state})`,
        approvedAt: state === "approved" ? sql`least(coalesce(${pullReviews.approvedAt}, ${when}), ${when})` : sql`${pullReviews.approvedAt}`,
      },
    });
}

async function rebuildAfterPush(deps: WebhookDeps, row: typeof repositories.$inferSelect): Promise<boolean> {
  if (!row.reportKey) return false;
  const [last] = await deps.db.select().from(builds).where(eq(builds.repoId, row.id)).orderBy(desc(builds.requestedAt)).limit(1);
  if (last && (busy(last) || last.requestedAt > now() - PUSH_BUILD_AFTER)) return false;
  const queue = await deps.queue().catch(() => null);
  if (!queue) return false;
  await queueBuild(deps.db, queue, row.id, row.seed ? PRIORITY.seed : PRIORITY.person);
  return true;
}

async function onInstallation(db: Db, storage: Storage, kind: string, event: Event, installation: number): Promise<number> {
  if (kind === "installation" && event.action === "deleted") {
    const gone = await db.select().from(repositories).where(eq(repositories.installationId, installation));
    await removeReports(db, storage, gone);
    return gone.length;
  }
  if (kind === "installation_repositories" && event.action === "removed") {
    const names = (event.repositories_removed ?? []).map(idOf).filter(Boolean);
    if (names.length === 0) return 0;
    const gone = await db.select().from(repositories).where(and(eq(repositories.installationId, installation), inArray(repositories.id, names)));
    await removeReports(db, storage, gone);
    return gone.length;
  }
  const added = kind === "installation" && event.action === "created" ? event.repositories : kind === "installation_repositories" && event.action === "added" ? event.repositories_added : undefined;
  const names = (added ?? []).map(idOf).filter(Boolean);
  if (names.length > 0) await db.update(repositories).set({ installationId: installation }).where(inArray(repositories.id, names));
  return 0;
}

/** Keeps the Site in step with GitHub from the App's webhooks, asking GitHub nothing: removes Reports the App lost or that went away, follows renames and visibility, rebuilds after a push to the default branch, keeps pull requests, reviews and counts, and records what happened for the activity feed. */
export async function onWebhook(deps: WebhookDeps, kind: string | null, event: Event, delivery?: string): Promise<Handled> {
  const { db } = deps;
  const handled: Handled = { removed: 0, built: false, kept: false };
  if (!kind) return handled;
  if (kind === "github_app_authorization" && event.action === "revoked") {
    const login = event.sender?.login?.toLowerCase();
    if (!login) return handled;
    const people = await db.select({ id: user.id }).from(user).where(eq(sql`lower(${user.login})`, login));
    const ids = people.map((p) => p.id);
    if (ids.length > 0) {
      await db.update(account).set({ accessToken: null, refreshToken: null }).where(inArray(account.userId, ids));
      await db.delete(lentTokens).where(inArray(lentTokens.userId, ids));
    }
    return { ...handled, kept: ids.length > 0 };
  }
  const installation = event.installation?.id;
  if (installation && (kind === "installation" || kind === "installation_repositories")) return { ...handled, removed: await onInstallation(db, deps.storage, kind, event, installation) };
  const id = idOf(event.repository);
  if (!id) return handled;
  const [row] = await db.select().from(repositories).where(eq(repositories.id, id));
  if (!row) return handled;
  if (event.repository) await keepCounts(db, row, event.repository);
  const actor = loginOf(event.sender);
  switch (kind) {
    case "repository": {
      if (event.action === "deleted") {
        await removeReports(db, deps.storage, [row]);
        return { ...handled, removed: 1 };
      }
      if (event.action === "privatized" || event.action === "publicized") await db.update(repositories).set({ isPrivate: event.action === "privatized" }).where(eq(repositories.id, id));
      if (event.action === "renamed" || event.action === "transferred") await db.update(repositories).set({ factsAt: 0 }).where(eq(repositories.id, id));
      return { ...handled, kept: true };
    }
    case "push": {
      const branch = event.repository?.default_branch;
      const commits = event.commits?.length ?? 0;
      if (!branch || event.ref !== `refs/heads/${branch}` || commits === 0) return handled;
      await record(db, delivery, id, { kind: "push", actor, title: event.head_commit?.message?.split("\n")[0] ?? null, url: event.head_commit?.url ?? null, count: commits });
      return { ...handled, built: await rebuildAfterPush(deps, row), kept: true };
    }
    case "pull_request": {
      const p = event.pull_request;
      if (!p) return handled;
      await keepPull(db, id, p);
      if (event.action === "opened" || event.action === "closed" || event.action === "reopened")
        await record(db, delivery, id, { kind: event.action === "closed" ? (p.merged_at ? "pr_merged" : "pr_closed") : `pr_${event.action}`, actor: loginOf(p.user), title: `#${p.number} ${p.title}`, url: p.html_url ?? null });
      return { ...handled, kept: true };
    }
    case "pull_request_review": {
      const p = event.pull_request;
      if (!p || event.action !== "submitted") return handled;
      await keepReview(db, id, p, event.review?.user, event.review?.submitted_at, event.review?.state);
      await record(db, delivery, id, { kind: "review", actor: loginOf(event.review?.user), title: `#${p.number} ${p.title}`, url: p.html_url ?? null });
      return { ...handled, kept: true };
    }
    case "release": {
      if (event.action !== "published") return handled;
      await db.update(repositories).set({ factsAt: 0 }).where(eq(repositories.id, id));
      await record(db, delivery, id, { kind: "release", actor, title: event.release?.name || event.release?.tag_name || null, url: event.release?.html_url ?? null });
      return { ...handled, kept: true };
    }
    case "star": {
      if (event.action === "created") await record(db, delivery, id, { kind: "star", actor, count: event.repository?.stargazers_count ?? null });
      return { ...handled, kept: true };
    }
    case "fork": {
      await record(db, delivery, id, { kind: "fork", actor, title: event.forkee?.full_name ?? null, url: event.forkee?.html_url ?? null });
      return { ...handled, kept: true };
    }
    case "create":
    case "delete": {
      if (event.ref_type !== "branch" && event.ref_type !== "tag") return handled;
      await record(db, delivery, id, { kind: `${event.ref_type}_${kind === "create" ? "created" : "deleted"}`, actor, title: event.ref ?? null });
      return { ...handled, kept: true };
    }
    default:
      return { ...handled, kept: true };
  }
}
