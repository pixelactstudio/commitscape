/**
 * The GitHub App itself (ADR-0017): its JWT, which installation can read a
 * repository, and a one-hour installation token for a Build, which goes to
 * the Builder and is never stored.
 */
import { appJwt } from "./crypto";

const api = (env: Env) => (env.GITHUB_API || "https://api.github.com").replace(/\/$/, "");

/**
 * The App's JWT, kept in this isolate's memory for five of its nine
 * minutes: signing one is the most CPU the Worker spends (RS256, about 3
 * ms). It is not an installation token, which is never kept (ADR-0017).
 */
let kept: { jwt: string; until: number; app: string } | null = null;

async function jwtFor(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (kept && kept.until > now && kept.app === env.GITHUB_APP_ID) return kept.jwt;
  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, now);
  kept = { jwt, until: now + 300, app: env.GITHUB_APP_ID };
  return jwt;
}

async function asApp(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const jwt = await jwtFor(env);
  return fetch(`${api(env)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "user-agent": "commitscape-site", "x-github-api-version": "2022-11-28" },
  });
}

/** The installation that lets the App read a repository, if any. */
export async function installationOf(env: Env, owner: string, name: string): Promise<number | null> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return null;
  const answer = await asApp(env, `/repos/${owner}/${name}/installation`);
  if (!answer.ok) return null;
  return ((await answer.json()) as { id?: number }).id ?? null;
}

/** An installation token for one repository, good for an hour. */
export async function installationToken(env: Env, installation: number, name: string): Promise<string | null> {
  const answer = await asApp(env, `/app/installations/${installation}/access_tokens`, {
    method: "POST",
    body: JSON.stringify({ repositories: [name], permissions: { contents: "read", metadata: "read" } }),
  });
  if (!answer.ok) return null;
  return ((await answer.json()) as { token?: string }).token ?? null;
}
