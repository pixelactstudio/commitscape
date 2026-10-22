import "@tanstack/react-start/server-only";
import { sql, type SQL } from "drizzle-orm";
import { PULL_SIZES, PULL_STALE_DAYS, type PullSize, type PullSpan, type PullStats, type PullStatsAsk } from "@commitscape/data";
import { now, schema } from "@commitscape/server";
import { closedOn, DAY, rowsOf, spanOf } from "./pulls";
import { readable, type Deps, type Viewer } from "./repos";

const { pullRequests, pullReviews } = schema;

const REVIEWERS_SHOWN = 10;
const WEEKLY_UNDER = 120;
const HOUR = 3600;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const inSpan = (column: SQL, span: PullSpan): SQL => (span.since === null ? sql`${column} <= ${span.until}` : sql`${column} between ${span.since} and ${span.until}`);

const sizeCase = sql.raw(`CASE ${PULL_SIZES.map((s) => (s.under === null ? `ELSE '${s.id}'` : `WHEN (additions + deletions) < ${s.under} THEN '${s.id}'`)).join(" ")} END`);

function periodStart(at: number, unit: "week" | "month"): number {
  const d = new Date(at * 1000);
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) / 1000;
}

const nextStart = (at: number, unit: "week" | "month"): number => {
  if (unit === "week") return at + 7 * DAY;
  const d = new Date(at * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
};

/** Adds up a repository's pull requests over the Window in SQL: counts, time to merge and to first review, backlog, throughput, sizes and reviewers. */
export async function pullStats(deps: Deps, viewer: Viewer, owner: string, name: string, ask: PullStatsAsk = {}, at: number = now()): Promise<PullStats> {
  const row = await readable(deps, viewer, owner, name);
  const span = spanOf(ask, at);
  const repo = sql`${pullRequests.repoId} = ${row.id}`;
  const created = inSpan(sql`${pullRequests.createdAt}`, span);
  const mergedIn = sql`${pullRequests.state} = 'MERGED' and ${inSpan(sql`${pullRequests.mergedAt}`, span)}`;
  const closedIn = sql`${pullRequests.state} = 'CLOSED' and ${inSpan(closedOn, span)}`;
  const stale = sql`${pullRequests.state} = 'OPEN' and ${pullRequests.updatedAt} < ${at - PULL_STALE_DAYS * DAY}`;
  const firsts = sql`(select repo_id, number, min(first_at) as first_at from ${pullReviews} where repo_id = ${row.id} group by repo_id, number)`;
  const days = span.since === null ? Infinity : (span.until - span.since) / DAY;
  const unit: "week" | "month" = days <= WEEKLY_UNDER ? "week" : "month";
  const trunc = (column: SQL) => sql`extract(epoch from date_trunc(${sql.raw(`'${unit}'`)}, to_timestamp(${column}) at time zone 'UTC'))::bigint`;
  const series = (on: SQL, column: SQL) =>
    deps.db.execute(sql`select ${trunc(column)} as m, count(*)::int as n from ${pullRequests} where ${repo} and ${on} group by 1`);

  const [totals, counted, merging, reviewing, unreviewed, opens, merges, closes, sizes, reviewers] = await Promise.all([
    deps.db.execute(sql`
      select count(*)::int as total, (count(*) filter (where changed_files is null))::int as unread,
        (count(*) filter (where state = 'OPEN'))::int as open, (count(*) filter (where ${stale}))::int as idle
      from ${pullRequests} where ${repo}`),
    deps.db.execute(sql`
      select (count(*) filter (where ${created}))::int as opened, (count(*) filter (where ${mergedIn}))::int as merged, (count(*) filter (where ${closedIn}))::int as closed
      from ${pullRequests} where ${repo}`),
    deps.db.execute(sql`
      select count(*)::int as n,
        percentile_cont(0.5) within group (order by merged_at - created_at) as median,
        percentile_cont(0.9) within group (order by merged_at - created_at) as p90,
        (count(*) filter (where merged_at - created_at < ${HOUR}))::int as b0,
        (count(*) filter (where merged_at - created_at >= ${HOUR} and merged_at - created_at < ${DAY}))::int as b1,
        (count(*) filter (where merged_at - created_at >= ${DAY} and merged_at - created_at < ${7 * DAY}))::int as b2,
        (count(*) filter (where merged_at - created_at >= ${7 * DAY} and merged_at - created_at < ${30 * DAY}))::int as b3,
        (count(*) filter (where merged_at - created_at >= ${30 * DAY}))::int as b4
      from ${pullRequests} where ${repo} and ${mergedIn}`),
    deps.db.execute(sql`
      select count(*)::int as of, (count(f.first_at))::int as n,
        percentile_cont(0.5) within group (order by case when f.first_at is not null then greatest(f.first_at - p.created_at, 0) end) as median
      from ${pullRequests} p left join ${firsts} f on f.repo_id = p.repo_id and f.number = p.number
      where p.repo_id = ${row.id} and ${inSpan(sql`p.created_at`, span)}`),
    deps.db.execute(sql`
      select count(*)::int as of,
        (count(*) filter (where not exists (select 1 from ${pullReviews} r where r.repo_id = ${pullRequests.repoId} and r.number = ${pullRequests.number})))::int as n
      from ${pullRequests} where ${repo} and ${mergedIn}`),
    series(created, sql`created_at`),
    series(mergedIn, sql`merged_at`),
    series(closedIn, closedOn),
    deps.db.execute(sql`
      select ${sizeCase} as size, (count(*) filter (where ${created}))::int as opened, (count(*) filter (where ${mergedIn}))::int as merged, (count(*) filter (where ${closedIn}))::int as closed
      from ${pullRequests} where ${repo} group by 1`),
    deps.db.execute(sql`
      select r.reviewer as login, count(*)::int as pulls, sum(r.reviews)::int as reviews,
        percentile_cont(0.5) within group (order by case when r.first_at >= p.created_at then r.first_at - p.created_at end) as median
      from ${pullReviews} r join ${pullRequests} p on p.repo_id = r.repo_id and p.number = r.number
      where r.repo_id = ${row.id} and ${inSpan(sql`r.first_at`, span)}
      group by r.reviewer order by pulls desc, reviews desc, login limit ${REVIEWERS_SHOWN}`),
  ]);

  const t = rowsOf<Record<string, unknown>>(totals)[0] ?? {};
  const c = rowsOf<Record<string, unknown>>(counted)[0] ?? {};
  const m = rowsOf<Record<string, unknown>>(merging)[0] ?? {};
  const f = rowsOf<Record<string, unknown>>(reviewing)[0] ?? {};
  const u = rowsOf<Record<string, unknown>>(unreviewed)[0] ?? {};

  const found = [opens, merges, closes].map((r) => rowsOf<{ m: number | string; n: number }>(r).map((x) => ({ m: Number(x.m), n: num(x.n) })));
  const every = found.flat();
  let months: PullStats["months"] = null;
  if (every.length > 0) {
    const first = span.since === null ? Math.min(...every.map((x) => x.m)) : periodStart(span.since, unit);
    const last = periodStart(Math.max(span.until, ...every.map((x) => x.m)), unit);
    const starts: number[] = [];
    for (let s = first; s <= last && starts.length < 2000; s = nextStart(s, unit)) starts.push(s);
    const at = new Map(starts.map((s, i) => [s, i]));
    const dense = (list: { m: number; n: number }[]) => {
      const out = starts.map(() => 0);
      for (const x of list) out[at.get(x.m) ?? -1] = (out[at.get(x.m) ?? -1] ?? 0) + x.n;
      return out;
    };
    months = { unit, from: first, opened: dense(found[0] ?? []), merged: dense(found[1] ?? []), closed: dense(found[2] ?? []) };
  }

  const bySize = new Map(rowsOf<{ size: PullSize; opened: number; merged: number; closed: number }>(sizes).map((x) => [x.size, x]));
  return {
    span,
    total: num(t.total),
    unread: num(t.unread),
    opened: num(c.opened),
    merged: num(c.merged),
    closed: num(c.closed),
    open: num(t.open),
    idle: num(t.idle),
    mergeTime: { n: num(m.n), median: maybe(m.median), p90: maybe(m.p90), bands: [num(m.b0), num(m.b1), num(m.b2), num(m.b3), num(m.b4)] },
    firstReview: { n: num(f.n), of: num(f.of), median: maybe(f.median) },
    unreviewed: { n: num(u.n), of: num(u.of) },
    months,
    sizes: PULL_SIZES.map((s) => ({ size: s.id, opened: num(bySize.get(s.id)?.opened), merged: num(bySize.get(s.id)?.merged), closed: num(bySize.get(s.id)?.closed) })),
    reviewers: rowsOf<{ login: string; pulls: number; reviews: number; median: number | string | null }>(reviewers).map((r) => ({ login: r.login, pulls: num(r.pulls), reviews: num(r.reviews), median: maybe(r.median) })),
  };
}
