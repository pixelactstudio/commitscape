/**
 * GitHub's instant facts (ADR-0015), asked of GitHub's REST API from the
 * Worker: four small requests, answered at once, cached in D1 for an hour.
 * The token (a secret; the GitHub App's, Phase 29) keeps the rate limit
 * the Site's own rather than the shared address's.
 */
import type { Facts } from "@commitscape/data";

export type Asked = { status: "ok"; facts: Facts; githubId: number | null } | { status: "not_found" | "private"; githubId?: undefined };

type Json = Record<string, unknown>;

/** GitHub's facts, asked with the Site's token, or `token` (a signed-in person's, for their private repository). */
export async function askGitHub(env: Env, owner: string, name: string, token?: string, fetcher: typeof fetch = fetch): Promise<Asked> {
  const base = (env.GITHUB_API || "https://api.github.com").replace(/\/$/, "");
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "commitscape-site",
    "x-github-api-version": "2022-11-28",
  };
  const auth = token ?? env.GITHUB_TOKEN;
  if (auth) headers.authorization = `Bearer ${auth}`;
  const get = (path: string) => fetcher(`${base}/repos/${owner}/${name}${path}`, { headers });
  const repo = await get("");
  if (repo.status === 404) return { status: "not_found" };
  if (!repo.ok) throw new Error(`GitHub answered ${repo.status}`);
  const r = (await repo.json()) as Json;
  if ((r.private === true || r.visibility === "private") && !token) return { status: "private" };
  const [languages, contributors, releases] = await Promise.all([
    get("/languages").then((x) => (x.ok ? (x.json() as Promise<Record<string, number>>) : ({} as Record<string, number>))),
    get("/contributors?per_page=12").then((x) => (x.ok && x.status !== 204 ? (x.json() as Promise<Json[]>) : [])),
    get("/releases?per_page=5").then((x) => (x.ok ? (x.json() as Promise<Json[]>) : [])),
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
      contributors: (Array.isArray(contributors) ? contributors : []).map((c) => ({
        login: text(c.login) ?? "",
        avatar: text(c.avatar_url) ?? "",
        contributions: num(c.contributions),
      })),
      releases: (Array.isArray(releases) ? releases : []).map((x) => ({
        name: text(x.name) || (text(x.tag_name) ?? ""),
        tag: text(x.tag_name) ?? "",
        at: text(x.published_at),
      })),
    },
  };
}
