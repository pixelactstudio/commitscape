import "@tanstack/react-start/server-only";
import { cachedGet } from "@commitscape/server";
import { apiOf, GITHUB_TTL, type GitHubDeps } from "./github";

export type Found = {
  people: { login: string; avatar: string; organization: boolean }[];
  repositories: { owner: string; name: string; description: string | null; stars: number; language: string | null }[];
};

const KEPT_FOR = 10 * 60_000;
const kept = new Map<string, { at: number; found: Promise<Found> }>();

type Json = Record<string, unknown>;

const text = (v: unknown) => (typeof v === "string" ? v : null);

async function ask(deps: GitHubDeps, path: string): Promise<Json[]> {
  const answer = await cachedGet<{ items?: unknown }>(deps.db, { url: `${apiOf(deps.github)}${path}`, token: deps.github.token, ttl: GITHUB_TTL.search, fetcher: deps.github.fetcher });
  return answer.status === 200 && Array.isArray(answer.body?.items) ? (answer.body.items as Json[]) : [];
}

/** People and repositories on GitHub whose names start like the words typed, kept for ten minutes. */
export function searchGitHub(deps: GitHubDeps, words: string): Promise<Found> {
  const q = words.trim().toLowerCase().replace(/^@/, "").slice(0, 60);
  if (q.length < 2) return Promise.resolve({ people: [], repositories: [] });
  const hit = kept.get(q);
  if (hit && Date.now() - hit.at < KEPT_FOR) return hit.found;
  const [owner, name] = q.split("/");
  const repoQuery = name !== undefined ? `${name || owner} user:${owner}` : `${q} in:name`;
  const found = Promise.all([
    name === undefined ? ask(deps, `/search/users?per_page=5&q=${encodeURIComponent(`${q} in:login`)}`) : Promise.resolve([]),
    ask(deps, `/search/repositories?per_page=5&sort=stars&q=${encodeURIComponent(repoQuery)}`),
  ]).then(([users, repos]) => ({
    people: users.flatMap((u) => {
      const login = text(u.login);
      return login ? [{ login, avatar: text(u.avatar_url) ?? "", organization: u.type === "Organization" }] : [];
    }),
    repositories: repos.flatMap((r) => {
      const full = text(r.full_name);
      const [o, n] = full?.split("/") ?? [];
      return o && n ? [{ owner: o, name: n, description: text(r.description), stars: typeof r.stargazers_count === "number" ? r.stargazers_count : 0, language: text(r.language) }] : [];
    }),
  }));
  kept.set(q, { at: Date.now(), found: found.catch(() => ({ people: [], repositories: [] })) });
  if (kept.size > 500) kept.delete(kept.keys().next().value as string);
  return kept.get(q)?.found as Promise<Found>;
}
