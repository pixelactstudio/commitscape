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

export type SiteToken = { current(): string | undefined; ready(): Promise<string | undefined> };

type Minted = { token: string; until: number };

const REMINT_BEFORE = 35 * 60;
const RETRY_AFTER = 5 * 60;

async function mintPublic(app: GitHubApp, installation: number): Promise<Minted | null> {
  const answer = await asApp(app, `/app/installations/${installation}/access_tokens`, { method: "POST", body: JSON.stringify({ permissions: { metadata: "read" } }) });
  if (!answer.ok) return null;
  const body = (await answer.json()) as { token?: string; expires_at?: string };
  if (!body.token) return null;
  const until = body.expires_at ? Math.floor(Date.parse(body.expires_at) / 1000) : Math.floor(Date.now() / 1000) + 3600;
  for (let page = 1; page <= 10; page++) {
    const listed = await fetch(`${app.api.replace(/\/$/, "")}/installation/repositories?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${body.token}`, accept: "application/vnd.github+json", "user-agent": "commitscape" },
    });
    if (!listed.ok) return null;
    const { repositories = [] } = (await listed.json()) as { repositories?: { private?: boolean }[] };
    if (repositories.some((r) => r.private)) throw new Error("the Site's installation can read a private repository; give it public repositories only");
    if (repositories.length < 100) break;
  }
  return { token: body.token, until };
}

/** The Site's own GitHub token: minted from the App's home installation and renewed before it expires, refused if that installation can read anything private; `fallback` (a token with no scopes) when there is no installation. */
export function siteToken(app: GitHubApp | null, installation: number | null, fallback: string | undefined, log: (line: string) => void = console.log): SiteToken {
  if (!app || !installation) return { current: () => fallback, ready: async () => fallback };
  let minted: Minted | null = null;
  let minting: Promise<void> | null = null;
  let failedAt = 0;
  const nowS = () => Math.floor(Date.now() / 1000);
  const fresh = () => (!!minted && minted.until - nowS() > REMINT_BEFORE) || nowS() - failedAt < RETRY_AFTER;
  const failed = (line: string) => {
    failedAt = nowS();
    log(`site token: ${line}`);
  };
  const mint = () =>
    (minting ??= mintPublic(app, installation)
      .then((m) => {
        if (m) minted = m;
        else failed("GitHub refused to mint the installation token");
      })
      .catch((e: unknown) => failed((e as Error).message))
      .finally(() => {
        minting = null;
      }));
  const usable = () => (minted && minted.until - nowS() > 60 ? minted.token : fallback);
  return {
    current: () => {
      if (!fresh()) void mint();
      return usable();
    },
    ready: async () => {
      if (!fresh()) await mint();
      return usable();
    },
  };
}

const REPO_TOKEN_FOR = 50 * 60;
const repoTokens = new Map<string, Minted>();

/** An installation token for one repository, reused until ten minutes before it expires. */
export async function repoToken(app: GitHubApp, installation: number, name: string): Promise<string | null> {
  const key = `${app.appId}:${installation}:${name}`;
  const nowS = Math.floor(Date.now() / 1000);
  const kept = repoTokens.get(key);
  if (kept && kept.until > nowS) return kept.token;
  const token = await installationToken(app, installation, name);
  if (token) {
    if (repoTokens.size > 1000) repoTokens.clear();
    repoTokens.set(key, { token, until: nowS + REPO_TOKEN_FOR });
  } else repoTokens.delete(key);
  return token;
}
