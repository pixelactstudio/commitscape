import "@tanstack/react-start/server-only";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { PULL_SIZES, PULL_STALE_DAYS, type GitPullIndex, type PullAsk, type PullAuthor, type PullConversation, type PullDecision, type PullHeader, type PullLabel, type PullList, type PullReview, type PullReviewState, type PullRow, type PullSize, type PullSort, type PullSpan, type PullState } from "@commitscape/data";
import { SPANS } from "@commitscape/data/answers";
import { cachedGet, gitFileKey, now, readGitJson, schema } from "@commitscape/server";
import { apiOf, GITHUB_TTL } from "./github";
import { SiteError } from "./http";
import { readable, type Deps, type Viewer } from "./repos";

const { pullRequests, pullReviews, repoGit } = schema;

export const PULLS_PAGE = 30;
export const DAY = 86_400;
const AUTHORS_SHOWN = 12;
const LABELS_SHOWN = 30;

const stateOf = (db: string): PullState => (db === "MERGED" ? "merged" : db === "OPEN" ? "open" : "closed");

const escaped = (word: string) => word.replace(/[\\%_]/g, (c) => `\\${c}`);

type PullDb = typeof pullRequests.$inferSelect;
type ReviewDb = typeof pullReviews.$inferSelect;

export const rowsOf = <T>(result: unknown): T[] => (result as { rows?: T[] } | null)?.rows ?? [];

/** The Window as seconds: the dates chosen, else the span ending at `at`; no start for all time. */
export function spanOf(ask: { window?: string | undefined; from?: number | undefined; to?: number | undefined }, at: number): PullSpan {
  if (ask.from !== undefined || ask.to !== undefined) return { since: ask.from === undefined ? null : ask.from * DAY, until: ask.to === undefined ? at : (ask.to + 1) * DAY - 1 };
  const days = SPANS[ask.window ?? "all"];
  return { since: days === null || days === undefined ? null : at - days * DAY, until: at };
}

const between = (column: SQL | typeof pullRequests.createdAt, span: PullSpan): SQL => (span.since === null ? sql`${column} <= ${span.until}` : sql`${column} between ${span.since} and ${span.until}`);

export const closedOn = sql`coalesce(${pullRequests.closedAt}, ${pullRequests.mergedAt}, ${pullRequests.updatedAt})`;

export const linesOf = sql`(${pullRequests.additions} + ${pullRequests.deletions})`;

/** A size bucket as a condition on the lines a pull request changed. */
export function sizeWhere(size: PullSize): SQL {
  const at = PULL_SIZES.findIndex((s) => s.id === size);
  const hi = PULL_SIZES[at]?.under ?? null;
  const lo = at > 0 ? (PULL_SIZES[at - 1]?.under ?? 0) : 0;
  return hi === null ? sql`${linesOf} >= ${lo}` : sql`${linesOf} >= ${lo} and ${linesOf} < ${hi}`;
}

const reviewed = sql`exists (select 1 from ${pullReviews} r where r.repo_id = ${pullRequests.repoId} and r.number = ${pullRequests.number})`;

const reviewWhere = (review: NonNullable<PullAsk["review"]>): SQL => {
  switch (review) {
    case "none":
      return sql`not ${reviewed}`;
    case "reviewed":
      return reviewed;
    case "approved":
      return sql`(${pullRequests.reviewDecision} = 'approved' or exists (select 1 from ${pullReviews} r where r.repo_id = ${pullRequests.repoId} and r.number = ${pullRequests.number} and r.state = 'approved'))`;
    case "changes":
      return sql`(${pullRequests.reviewDecision} = 'changes_requested' or exists (select 1 from ${pullReviews} r where r.repo_id = ${pullRequests.repoId} and r.number = ${pullRequests.number} and r.state = 'changes_requested'))`;
  }
};

const ORDER: Record<PullSort, SQL[]> = {
  created: [desc(pullRequests.createdAt), desc(pullRequests.number)],
  oldest: [sql`${pullRequests.createdAt} asc`, sql`${pullRequests.number} asc`],
  updated: [desc(pullRequests.updatedAt), desc(pullRequests.number)],
  merged: [sql`${pullRequests.mergedAt} desc nulls last`, desc(pullRequests.number)],
  closed: [sql`${closedOn} desc`, desc(pullRequests.updatedAt), desc(pullRequests.number)],
  size: [sql`${linesOf} desc`, desc(pullRequests.number)],
  comments: [sql`${pullRequests.comments} desc nulls last`, desc(pullRequests.number)],
};

const sortOf = (ask: PullAsk): PullSort => ask.sort ?? (ask.state === "merged" ? "merged" : ask.state === "closed" ? "closed" : "created");

const reviewOf = (r: ReviewDb): PullReview => ({ login: r.reviewer, reviews: r.reviews, firstAt: r.firstAt, lastAt: r.lastAt ?? null, state: (r.state as PullReviewState | null) ?? null, approvedAt: r.approvedAt ?? null });

function rowOf(p: PullDb, reviews: ReviewDb[]): PullRow {
  const firsts = reviews.map((r) => r.firstAt);
  const ranked = [...reviews].sort((a, b) => b.reviews - a.reviews || a.reviewer.localeCompare(b.reviewer));
  return {
    number: p.number,
    title: p.title,
    state: stateOf(p.state),
    author: p.author,
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    closedAt: p.closedAt ?? null,
    updatedAt: p.updatedAt,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changedFiles ?? null,
    commits: p.commits ?? null,
    comments: p.comments ?? null,
    draft: p.draft ?? null,
    head: p.headRef,
    headOwner: p.headOwner ?? null,
    fork: p.fromFork ?? null,
    base: p.baseRef ?? null,
    labels: p.labels ?? [],
    decision: (p.reviewDecision as PullDecision | null) ?? null,
    mergedBy: p.mergedBy ?? null,
    mergeCommit: p.mergeCommit ?? null,
    reviewers: ranked.map((r) => r.reviewer),
    reviewStates: ranked.map((r) => (r.state as PullReviewState | null) ?? null),
    firstReviewAt: firsts.length > 0 ? Math.min(...firsts) : null,
  };
}

/** Lists a readable repository's pull requests from Postgres, a page at a time, with the filters, sort and per-state counts. */
export async function listPulls(deps: Deps, viewer: Viewer, owner: string, name: string, ask: PullAsk = {}, at: number = now()): Promise<PullList> {
  const row = await readable(deps, viewer, owner, name);
  const span = spanOf(ask, at);
  const words = (ask.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const numbered = words.some((w) => /^#\d{1,9}$/.test(w));
  const where: SQL[] = [eq(pullRequests.repoId, row.id)];
  if (ask.author) where.push(eq(pullRequests.author, ask.author.toLowerCase()));
  if (ask.label) where.push(sql`${pullRequests.labels} @> ${JSON.stringify([{ name: ask.label }])}::jsonb`);
  if (ask.base) where.push(eq(pullRequests.baseRef, ask.base));
  if (ask.draft !== undefined) where.push(eq(pullRequests.draft, ask.draft));
  if (ask.size) where.push(sizeWhere(ask.size));
  if (ask.review) where.push(reviewWhere(ask.review));
  if (ask.stale) where.push(sql`${pullRequests.state} = 'OPEN' and ${pullRequests.updatedAt} < ${at - PULL_STALE_DAYS * DAY}`);
  for (const word of words) {
    const number = /^#?(\d{1,9})$/.exec(word)?.[1];
    const title = ilike(pullRequests.title, `%${escaped(word)}%`);
    where.push(number ? (or(title, eq(pullRequests.number, Number(number))) as SQL) : title);
  }
  const windowed = !numbered;
  const merged = windowed ? sql`${pullRequests.state} = 'MERGED' and ${between(sql`${pullRequests.mergedAt}`, span)}` : sql`${pullRequests.state} = 'MERGED'`;
  const closed = windowed ? sql`${pullRequests.state} = 'CLOSED' and ${between(closedOn, span)}` : sql`${pullRequests.state} = 'CLOSED'`;
  const opened = windowed ? between(sql`${pullRequests.createdAt}`, span) : sql`true`;
  const stated: Record<PullState | "all", SQL> = { open: sql`${pullRequests.state} = 'OPEN'`, merged, closed, all: sql`(${opened})` };
  const which = ask.state ?? "all";
  const filter = and(...where, stated[which]);
  const page = (n: number) => deps.db.select().from(pullRequests).where(filter).orderBy(...ORDER[sortOf(ask)]).limit(PULLS_PAGE).offset((n - 1) * PULLS_PAGE);
  const asked = Math.max(1, Math.floor(ask.page ?? 1));
  const [[tally], [shown], first] = await Promise.all([
    deps.db
      .select({
        open: sql<number>`(count(*) filter (where ${stated.open}))::int`,
        merged: sql<number>`(count(*) filter (where ${stated.merged}))::int`,
        closed: sql<number>`(count(*) filter (where ${stated.closed}))::int`,
      })
      .from(pullRequests)
      .where(and(...where)),
    which === "all" ? deps.db.select({ n: count() }).from(pullRequests).where(filter) : Promise.resolve([{ n: 0 }]),
    page(asked),
  ]);
  const counts: PullList["counts"] = { open: tally?.open ?? 0, merged: tally?.merged ?? 0, closed: tally?.closed ?? 0 };
  const total = which === "all" ? (shown?.n ?? 0) : counts[which];
  const pages = Math.max(1, Math.ceil(total / PULLS_PAGE));
  const place = Math.min(asked, pages);
  const found = place === asked ? first : await page(place);
  const reviews = found.length === 0 ? [] : await deps.db.select().from(pullReviews).where(and(eq(pullReviews.repoId, row.id), inArray(pullReviews.number, found.map((p) => p.number))));
  const by = new Map<number, ReviewDb[]>();
  for (const r of reviews) by.set(r.number, [...(by.get(r.number) ?? []), r]);
  return { total, counts, span, page: place, pages, read: row.pullsReadAt !== null, rows: found.map((p) => rowOf(p, by.get(p.number) ?? [])) };
}

/** The people who opened the most pull requests, or, for some letters of a login, those whose login holds them, the best match first. */
export async function pullAuthors(deps: Deps, viewer: Viewer, owner: string, name: string, q = ""): Promise<PullAuthor[]> {
  const row = await readable(deps, viewer, owner, name);
  const word = q.trim().replace(/^@/, "").toLowerCase().slice(0, 60);
  const where = [eq(pullRequests.repoId, row.id), sql`${pullRequests.author} is not null`, ...(word ? [ilike(pullRequests.author, `%${escaped(word)}%`)] : [])];
  const rows = await deps.db
    .select({ login: pullRequests.author, pulls: count() })
    .from(pullRequests)
    .where(and(...where))
    .groupBy(pullRequests.author)
    .orderBy(...(word ? [sql`(${pullRequests.author} like ${`${escaped(word)}%`}) desc`] : []), desc(count()), pullRequests.author)
    .limit(AUTHORS_SHOWN);
  return rows.flatMap((r) => (r.login ? [{ login: r.login, pulls: r.pulls }] : []));
}

/** The labels pull requests carry most, with how many carry each. */
export async function pullLabels(deps: Deps, viewer: Viewer, owner: string, name: string): Promise<(PullLabel & { pulls: number })[]> {
  const row = await readable(deps, viewer, owner, name);
  const rows = rowsOf<{ name: string; colour: string | null; pulls: number | string }>(
    await deps.db.execute(sql`
      SELECT l->>'name' AS name, max(l->>'colour') AS colour, count(*)::int AS pulls
      FROM ${pullRequests}, jsonb_array_elements(coalesce(${pullRequests.labels}, '[]'::jsonb)) AS l
      WHERE ${pullRequests.repoId} = ${row.id}
      GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT ${LABELS_SHOWN}`),
  );
  return rows.map((l) => ({ name: l.name, colour: l.colour ?? "", pulls: Number(l.pulls) }));
}

/** One pull request's header from Postgres with each reviewer's reviews, and whether its commits, files and diff were kept from git. */
export async function pullHeader(deps: Deps, viewer: Viewer, owner: string, name: string, number: number): Promise<PullHeader> {
  if (!Number.isInteger(number) || number < 1) throw new SiteError(400, "That is not a pull request's number.");
  const row = await readable(deps, viewer, owner, name);
  const [[pull], reviews, [git]] = await Promise.all([
    deps.db.select().from(pullRequests).where(and(eq(pullRequests.repoId, row.id), eq(pullRequests.number, number))),
    deps.db
      .select()
      .from(pullReviews)
      .where(and(eq(pullReviews.repoId, row.id), eq(pullReviews.number, number)))
      .orderBy(desc(pullReviews.reviews), pullReviews.reviewer),
    deps.db.select({ prefix: repoGit.prefix }).from(repoGit).where(eq(repoGit.repoId, row.id)),
  ]);
  if (!pull) throw new SiteError(404, "No such pull request.");
  const index = git ? await readGitJson<GitPullIndex>(deps.storage, gitFileKey(git.prefix, "pulls")).catch(() => null) : null;
  return { ...rowOf(pull, reviews), reviews: reviews.map(reviewOf), git: !!index?.pulls[String(number)]?.stored };
}

type Gh = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const who = (v: unknown) => (typeof (v as Gh | null)?.login === "string" ? ((v as Gh).login as string) : null);

/** A pull request's description, comments and reviews, read from GitHub with the signed-in person's own token and kept for them alone for five minutes. */
export async function pullConversation(deps: Deps, viewer: Viewer, owner: string, name: string, number: number): Promise<PullConversation> {
  const row = await readable(deps, viewer, owner, name);
  const s = await viewer.session();
  const token = s ? await viewer.token() : null;
  if (!s || !token) throw new SiteError(401, "Sign in to read the conversation.", { gate: "pr" });
  const base = `${apiOf(deps.github)}/repos/${row.owner}/${row.name}`;
  const get = <T>(path: string) => cachedGet<T>(deps.db, { url: `${base}${path}`, token, scope: `user:${s.userId}`, ttl: GITHUB_TTL.pull, fetcher: deps.github.fetcher });
  const [pull, comments, reviews] = await Promise.all([get<Gh>(`/pulls/${number}`), get<Gh[]>(`/issues/${number}/comments?per_page=50`), get<Gh[]>(`/pulls/${number}/reviews?per_page=50`)]);
  if (pull.status === 404 || pull.status === 403 || pull.status === 401) throw new SiteError(502, "GitHub did not let your token read this pull request.");
  if (pull.status < 200 || pull.status >= 300 || !pull.body) throw new SiteError(502, "GitHub could not be asked just now. Try again in a moment.");
  const p = pull.body;
  const list = (r: { status: number; body: Gh[] | null }) => (r.status >= 200 && r.status < 300 && Array.isArray(r.body) ? r.body : []);
  return {
    state: text(p.state),
    draft: p.draft === true,
    merged: p.merged === true || typeof p.merged_at === "string",
    body: text(p.body),
    login: who(p.user),
    at: text(p.created_at),
    head: text((p.head as Gh | undefined)?.ref),
    base: text((p.base as Gh | undefined)?.ref),
    labels: ((p.labels as Gh[] | undefined) ?? []).map((l) => ({ name: text(l.name), colour: text(l.color) })),
    comments: list(comments).map((c) => ({ id: Number(c.id), login: who(c.user), at: text(c.created_at), body: text(c.body), url: text(c.html_url) })),
    reviews: list(reviews)
      .filter((r) => text(r.state) !== "PENDING")
      .map((r) => ({ id: Number(r.id), login: who(r.user), state: text(r.state), at: typeof r.submitted_at === "string" ? r.submitted_at : null, body: text(r.body), url: text(r.html_url) })),
    url: text(p.html_url) || `https://github.com/${row.owner}/${row.name}/pull/${number}`,
  };
}


