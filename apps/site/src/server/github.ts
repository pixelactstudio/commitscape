import "@tanstack/react-start/server-only";
import { cachedGet, type Db } from "@commitscape/server";
import type { Facts } from "@commitscape/data";

export type GitHubConfig = { api: string; token?: string; fetcher?: typeof fetch };

export type GitHubDeps = { db: Db; github: GitHubConfig };

export type Asked = { status: "ok"; facts: Facts; githubId: number | null } | { status: "not_found" | "private"; githubId?: undefined };

export type Reader = { token?: string | null; scope?: string };

export const GITHUB_TTL = {
  repository: 6 * 3600,
  details: 24 * 3600,
  access: 0,
  installations: 60,
  search: 600,
  commits: 3600,
  graphql: 3600,
};

type Json = Record<string, unknown>;

export const apiOf = (gh: GitHubConfig) => gh.api.replace(/\/$/, "");

const ok = (status: number) => status >= 200 && status < 300;

/** GitHub's facts about a repository, from the cache while fresh. A visitor's token (`as.token`) is spent first and the Site's follows if GitHub refuses it; without `as.scope` nothing private is kept or told, with a person's scope private facts are kept for that scope only. */
export async function askGitHub(deps: GitHubDeps, owner: string, name: string, as: Reader = {}): Promise<Asked> {
  const base = `${apiOf(deps.github)}/repos/${owner}/${name}`;
  const own = as.scope !== undefined;
  const scope = as.scope ?? "public";
  const lent = [...new Set([as.token, own ? undefined : deps.github.token])].filter((t): t is string => !!t);
  const tokens: (string | undefined)[] = lent.length > 0 ? lent : [undefined];
  const isPrivate = (r: Json | null) => r?.private === true || r?.visibility === "private";
  const get = <T,>(token: string | undefined, path: string, ttl: number) =>
    cachedGet<T>(deps.db, {
      url: `${base}${path}`,
      token,
      scope,
      ttl,
      fetcher: deps.github.fetcher,
      keep: path === "" && !own ? (body) => !isPrivate(body as Json | null) : undefined,
    });
  let repo = await get<Json>(tokens[0], "", GITHUB_TTL.repository);
  let used = tokens[0];
  for (const token of tokens.slice(1)) {
    if (![401, 403, 429].includes(repo.status)) break;
    repo = await get<Json>(token, "", GITHUB_TTL.repository);
    used = token;
  }
  if (repo.status === 404) return { status: "not_found" };
  if (!ok(repo.status) || !repo.body) throw new Error(`GitHub answered ${repo.status}`);
  const r = repo.body;
  if (isPrivate(r) && !own) return used === deps.github.token ? { status: "private" } : { status: "not_found" };
  const [languages, contributors, releases] = await Promise.all([
    get<Record<string, number>>(used, "/languages", GITHUB_TTL.details).then((x) => (ok(x.status) && x.body ? x.body : {})),
    get<Json[]>(used, "/contributors?per_page=12", GITHUB_TTL.details).then((x) => (ok(x.status) && x.status !== 204 && Array.isArray(x.body) ? x.body : [])),
    get<Json[]>(used, "/releases?per_page=5", GITHUB_TTL.details).then((x) => (ok(x.status) && Array.isArray(x.body) ? x.body : [])),
  ]);
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    status: "ok",
    githubId: typeof r.id === "number" ? r.id : null,
    facts: {
      fullName: text(r.full_name) ?? `${owner}/${name}`,
      description: text(r.description),
      homepage: text(r.homepage) || null,
      stars: num(r.stargazers_count),
      forks: num(r.forks_count),
      openIssues: num(r.open_issues_count),
      sizeKb: num(r.size),
      defaultBranch: text(r.default_branch) ?? "main",
      license: text((r.license as Json | null)?.spdx_id),
      topics: Array.isArray(r.topics) ? (r.topics as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 10) : [],
      archived: r.archived === true,
      createdAt: text(r.created_at) ?? "",
      pushedAt: text(r.pushed_at),
      languages: Object.entries(languages)
        .map(([n, bytes]) => ({ name: n, bytes }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 8),
      contributors: contributors.map((c) => ({
        login: text(c.login) ?? "",
        avatar: text(c.avatar_url) ?? "",
        contributions: num(c.contributions),
      })),
      releases: releases.map((x) => ({
        name: text(x.name) || (text(x.tag_name) ?? ""),
        tag: text(x.tag_name) ?? "",
        at: text(x.published_at),
      })),
    },
  };
}
