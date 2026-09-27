import "@tanstack/react-start/server-only";
import type { Facts } from "@commitscape/data";

export type GitHubConfig = { api: string; token?: string };

export type Asked = { status: "ok"; facts: Facts; githubId: number | null } | { status: "not_found" | "private"; githubId?: undefined };

type Json = Record<string, unknown>;

const headers = (token?: string): Record<string, string> => ({
  accept: "application/vnd.github+json",
  "user-agent": "commitscape",
  "x-github-api-version": "2022-11-28",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

export function asUser(gh: GitHubConfig, token: string, path: string): Promise<Response> {
  return fetch(`${gh.api.replace(/\/$/, "")}${path}`, { headers: headers(token) });
}

/** GitHub's public facts about a repository. */
export async function askGitHub(gh: GitHubConfig, owner: string, name: string, userToken?: string, fetcher: typeof fetch = fetch): Promise<Asked> {
  const base = gh.api.replace(/\/$/, "");
  const h = headers(userToken ?? gh.token);
  const get = (path: string) => fetcher(`${base}/repos/${owner}/${name}${path}`, { headers: h });
  const repo = await get("");
  if (repo.status === 404) return { status: "not_found" };
  if (!repo.ok) throw new Error(`GitHub answered ${repo.status}`);
  const r = (await repo.json()) as Json;
  if ((r.private === true || r.visibility === "private") && !userToken) return { status: "private" };
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
