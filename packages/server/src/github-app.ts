import { createPrivateKey, createSign } from "node:crypto";

export type GitHubApp = { appId: string; privateKey: string; api: string };

function privateKey(key: string) {
  const pem = key.includes("-----BEGIN") ? key : Buffer.from(key.trim(), "base64").toString("utf8");
  return createPrivateKey(pem);
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

let kept: { jwt: string; until: number; app: string } | null = null;

/** The GitHub App's JWT, reused for five minutes. */
export function appJwt(app: GitHubApp, now = Math.floor(Date.now() / 1000)): string {
  if (kept && kept.until > now && kept.app === app.appId) return kept.jwt;
  const head = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: app.appId })}`;
  const jwt = `${head}.${createSign("RSA-SHA256").update(head).sign(privateKey(app.privateKey)).toString("base64url")}`;
  kept = { jwt, until: now + 300, app: app.appId };
  return jwt;
}

function asApp(app: GitHubApp, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${app.api.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${appJwt(app)}`,
      accept: "application/vnd.github+json",
      "user-agent": "commitscape",
      "x-github-api-version": "2022-11-28",
    },
  });
}

/** The GitHub App installation that may read a repository, if any. */
export async function installationOf(app: GitHubApp | null, owner: string, name: string): Promise<number | null> {
  if (!app?.appId || !app.privateKey) return null;
  const answer = await asApp(app, `/repos/${owner}/${name}/installation`);
  if (!answer.ok) return null;
  return ((await answer.json()) as { id?: number }).id ?? null;
}

/** A one-hour token that can only read one repository. */
export async function installationToken(app: GitHubApp, installation: number, name: string): Promise<string | null> {
  const answer = await asApp(app, `/app/installations/${installation}/access_tokens`, {
    method: "POST",
    body: JSON.stringify({ repositories: [name], permissions: { contents: "read", metadata: "read" } }),
  });
  if (!answer.ok) return null;
  return ((await answer.json()) as { token?: string }).token ?? null;
}
