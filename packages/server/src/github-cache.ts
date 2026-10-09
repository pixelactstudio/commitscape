import { eq, lt } from "drizzle-orm";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { sha256 } from "./random";
import { now } from "./time";

export type GitHubGet = {
  url: string;
  token?: string | null;
  scope?: string;
  ttl: number;
  fetcher?: typeof fetch;
  keep?: (body: unknown, status: number) => boolean;
};

export type GitHubQuery = {
  api: string;
  query: string;
  variables?: Record<string, unknown>;
  token?: string | null;
  scope?: string;
  ttl: number;
  fetcher?: typeof fetch;
};

export type Cached<T = unknown> = { status: number; body: T | null; cached: boolean; stale: boolean };

export type GraphqlBody<T> = { data?: T | null; errors?: { type?: string; message: string }[] };

export type GitHubLimit = { label: string; resource: string; limit: number; remaining: number; resetAt: number };

type Verdict = "store" | "limited" | "plain";
type Raw = { status: number; text: string | null; cached: boolean; stale: boolean };
type Ask = {
  key: string;
  ttl: number;
  token?: string | null;
  label: string;
  resource: string;
  etag: boolean;
  send: (etag: string | null) => Promise<Response>;
  judge: (answer: Response, text: string) => Verdict;
  failed: Raw;
};

const NEGATIVE_FOR: Record<number, number> = { 403: 300, 404: 600, 410: 3600, 451: 3600 };
const LOW_SHARE = 0.05;
const LOW_FLOOR = 5;
const KEPT_AFTER_EXPIRY = 86_400;

const limits = new Map<string, GitHubLimit>();
const warned = new Set<string>();
const flights = new Map<string, Promise<Raw>>();

const tokenId = (token: string | null | undefined) => (token ? sha256(token).slice(0, 16) : "anonymous");
const bucketOf = (token: string | null | undefined, resource: string) => `${tokenId(token)}:${resource}`;
const parse = (text: string | null) => {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function resourceOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path.startsWith("/search") ? "search" : path.endsWith("/graphql") ? "graphql" : "core";
  } catch {
    return "core";
  }
}

function standing(token: string | null | undefined, resource: string): GitHubLimit | undefined {
  const known = limits.get(bucketOf(token, resource));
  return known && known.resetAt > now() ? known : undefined;
}

const isLow = (l: GitHubLimit) => l.remaining <= Math.max(LOW_FLOOR, Math.floor(l.limit * LOW_SHARE));

/** What GitHub last said each token has left, per resource, in windows that have not reset. */
export function githubLimits(): GitHubLimit[] {
  return [...limits.values()].filter((l) => l.resetAt > now());
}

/** Forgets every remembered rate limit. */
export function forgetGitHubLimits(): void {
  limits.clear();
  warned.clear();
}

function noteLimit(token: string | null | undefined, label: string, resource: string, seen: { limit: number; remaining: number; resetAt: number }) {
  const bucket = bucketOf(token, resource);
  const entry: GitHubLimit = { label, resource, limit: seen.limit, remaining: seen.remaining, resetAt: seen.resetAt };
  limits.set(bucket, entry);
  if (limits.size > 500) limits.delete(limits.keys().next().value as string);
  const mark = `${bucket}:${seen.resetAt}`;
  if (isLow(entry) && !warned.has(mark)) {
    warned.add(mark);
    if (warned.size > 500) warned.delete(warned.values().next().value as string);
    console.warn(`github rate limit low: ${label} ${resource} ${seen.remaining}/${seen.limit} left, resets ${new Date(seen.resetAt * 1000).toISOString()}`);
  }
}

function readHeaders(headers: Headers): { limit: number; remaining: number; resetAt: number; resource: string | null } | null {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (limit === null || remaining === null || reset === null) return null;
  const seen = { limit: Number(limit), remaining: Number(remaining), resetAt: Number(reset) };
  return Number.isFinite(seen.limit) && Number.isFinite(seen.remaining) && Number.isFinite(seen.resetAt) ? { ...seen, resource: headers.get("x-ratelimit-resource") } : null;
}

function once(key: string, run: () => Promise<Raw>): Promise<Raw> {
  const running = flights.get(key);
  if (running) return running;
  const started = run().finally(() => flights.delete(key));
  flights.set(key, started);
  return started;
}

async function settle(db: Db | null, ask: Ask): Promise<Raw> {
  const [kept] = db ? await db.select().from(schema.githubCache).where(eq(schema.githubCache.key, ask.key)) : [];
  const at = now();
  const fromKept = (stale: boolean): Raw => ({ status: kept?.status ?? 0, text: kept?.body ?? null, cached: true, stale });
  if (kept && kept.until > at) return fromKept(false);
  const left = standing(ask.token, ask.resource);
  if (left && left.remaining <= 0) return kept ? fromKept(true) : ask.failed;
  if (kept && left && isLow(left)) return fromKept(true);
  let answer: Response;
  try {
    answer = await ask.send(ask.etag ? (kept?.etag ?? null) : null);
  } catch (e) {
    if (kept) return fromKept(true);
    throw e;
  }
  const seen = readHeaders(answer.headers);
  if (seen) noteLimit(ask.token, ask.label, seen.resource ?? ask.resource, seen);
  if (answer.status === 304 && kept && db) {
    await db.update(schema.githubCache).set({ fetchedAt: at, until: at + ask.ttl }).where(eq(schema.githubCache.key, ask.key));
    return fromKept(false);
  }
  const text = await answer.text().catch(() => "");
  const verdict = ask.judge(answer, text);
  if (verdict === "limited" || answer.status >= 500) return kept ? fromKept(true) : { status: answer.status === 200 ? 429 : answer.status, text: null, cached: false, stale: false };
  if (verdict === "store" && db) {
    const row = {
      etag: ask.etag ? answer.headers.get("etag") : null,
      status: answer.status,
      body: text || null,
      fetchedAt: at,
      until: at + (answer.ok ? ask.ttl : Math.min(ask.ttl, NEGATIVE_FOR[answer.status] ?? 0)),
    };
    await db.insert(schema.githubCache).values({ key: ask.key, ...row }).onConflictDoUpdate({ target: schema.githubCache.key, set: row });
  }
  return { status: answer.status, text: answer.ok || verdict === "store" ? text || null : null, cached: false, stale: false };
}

function shaped<T>(raw: Raw): Cached<T> {
  return { status: raw.status, body: parse(raw.text) as T | null, cached: raw.cached, stale: raw.stale };
}

/** A GET to GitHub's REST API, answered from Postgres while fresh, then revalidated with its ETag (a 304 is free) and, when GitHub is limited or failing, served stale. Give a `scope` whenever the token is a person's: the default, public, is shared by everyone. */
export async function cachedGet<T = unknown>(db: Db | null, get: GitHubGet): Promise<Cached<T>> {
  const scope = get.scope ?? (db ? "public" : `token:${tokenId(get.token)}`);
  const key = sha256(`${scope}\n${get.url}`);
  const fetcher = get.fetcher ?? fetch;
  const raw = await once(key, () =>
    settle(db, {
      key,
      ttl: get.ttl,
      token: get.token,
      label: scope.split(":")[0] ?? scope,
      resource: resourceOf(get.url),
      etag: true,
      send: (etag) =>
        fetcher(get.url, {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "commitscape",
            "x-github-api-version": "2022-11-28",
            ...(get.token ? { authorization: `Bearer ${get.token}` } : {}),
            ...(etag ? { "if-none-match": etag } : {}),
          },
        }),
      judge: (answer, text) => {
        const limited = answer.status === 429 || (answer.status === 403 && (answer.headers.get("x-ratelimit-remaining") === "0" || answer.headers.has("retry-after") || /rate limit/i.test(text)));
        if (limited) return "limited";
        if (!answer.ok && !(answer.status in NEGATIVE_FOR)) return "plain";
        if (answer.ok && text && !isJson(text)) return "plain";
        return get.keep && !get.keep(parse(text || null), answer.status) ? "plain" : "store";
      },
      failed: { status: 429, text: null, cached: false, stale: false },
    }),
  );
  return shaped<T>(raw);
}

const SELECTION = "rateLimit { limit remaining resetAt }";

function withRateLimit(query: string): string {
  return query.includes("rateLimit") ? query : query.replace(/\s*\}\s*$/, ` ${SELECTION} }`);
}

/** One request to GitHub's GraphQL API, answered from Postgres while fresh (no ETags, by ttl alone) and served stale when GitHub is limited or failing. Keep only public answers under the `public` scope. */
export async function githubGraphql<T = unknown>(db: Db | null, q: GitHubQuery): Promise<Cached<GraphqlBody<T>>> {
  const url = `${q.api.replace(/\/$/, "")}/graphql`;
  const scope = q.scope ?? (db ? "public" : `token:${tokenId(q.token)}`);
  const key = sha256(`${scope}\n${url}\n${q.query}\n${JSON.stringify(q.variables ?? {})}`);
  const fetcher = q.fetcher ?? fetch;
  const label = scope.split(":")[0] ?? scope;
  const raw = await once(key, () =>
    settle(db, {
      key,
      ttl: q.ttl,
      token: q.token,
      label,
      resource: "graphql",
      etag: false,
      send: () =>
        fetcher(url, {
          method: "POST",
          headers: { ...(q.token ? { authorization: `Bearer ${q.token}` } : {}), "content-type": "application/json", "user-agent": "commitscape" },
          body: JSON.stringify({ query: withRateLimit(q.query), variables: q.variables ?? {} }),
        }),
      judge: (answer, text) => {
        if (answer.status === 429 || answer.status === 403) return "limited";
        if (answer.status !== 200) return "plain";
        const body = parse(text) as (GraphqlBody<{ rateLimit?: { limit: number; remaining: number; resetAt: string } }>) | null;
        if (body?.errors?.some((e) => e.type === "RATE_LIMITED")) return "limited";
        const field = body?.data?.rateLimit;
        if (field && !answer.headers.has("x-ratelimit-remaining")) {
          const resetAt = Math.floor(Date.parse(field.resetAt) / 1000);
          if (Number.isFinite(resetAt)) noteLimit(q.token, label, "graphql", { limit: field.limit, remaining: field.remaining, resetAt });
        }
        if (!body?.data || (body.errors && !body.errors.every((e) => e.type === "NOT_FOUND"))) return "plain";
        return "store";
      },
      failed: { status: 429, text: null, cached: false, stale: false },
    }),
  );
  return shaped<GraphqlBody<T>>(raw);
}

/** Deletes cached GitHub answers that expired more than a day ago. */
export async function pruneGitHubCache(db: Db): Promise<number> {
  const gone = await db
    .delete(schema.githubCache)
    .where(lt(schema.githubCache.until, now() - KEPT_AFTER_EXPIRY))
    .returning({ key: schema.githubCache.key });
  return gone.length;
}
