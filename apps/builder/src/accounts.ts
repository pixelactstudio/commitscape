import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { githubGraphql, keepAnswers, keptAnswers, sha256, type Db } from "@commitscape/server";
import type { GitHubApi } from "./github";
import type { run as runCommand } from "./run";

export type Signature = { email: string; name: string; commits: number; sha: string };

export const AUTHOR_FOR = 365 * 24 * 3600;
export const COMMITS_PER_QUERY = 100;
const OID = /^[0-9a-f]{40}$/;
const NOREPLY = /^(?:\d+\+)?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?)@users\.noreply\.github\.com$/i;

/** Parses what `commitscape signatures` wrote: one entry per author email, with its newest commit. */
export function signaturesOf(text: string): Signature[] {
  const list = JSON.parse(text) as unknown;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s): s is Signature => !!s && typeof s.email === "string" && typeof s.sha === "string" && typeof s.commits === "number" && typeof s.name === "string",
  );
}

/** The GitHub login a noreply address names, which needs no request. */
export function noreplyLogin(email: string): string | null {
  return NOREPLY.exec(email)?.[1] ?? null;
}

type Author = { login: string | null };
type Authored = { author?: { user?: { login?: string } | null } | null } | null;

/** The GraphQL query for the authors of up to a hundred commits of one repository at once. */
export function authorsQuery(shas: string[]): string {
  const fields = shas.map((sha, i) => `c${i}: object(oid: "${sha}") { ... on Commit { author { user { login } } } }`).join(" ");
  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
}

/** Each email's GitHub login, from the account GitHub links to its newest commit: asked for the emails with most commits, a hundred commits to a GraphQL query, and each commit's answer kept in Postgres a year since a commit's author never changes. */
export async function accountsFor(
  db: Db,
  gh: GitHubApi,
  repo: { owner: string; name: string; scope: string },
  signatures: Signature[],
  most: number,
): Promise<{ accounts: Record<string, string>; asked: number; requests: number }> {
  const accounts: Record<string, string> = {};
  const wanted: Signature[] = [];
  for (const s of [...signatures].sort((a, b) => b.commits - a.commits)) {
    const login = noreplyLogin(s.email);
    if (login) accounts[s.email] = login;
    else if (OID.test(s.sha) && wanted.length < most) wanted.push(s);
  }
  const api = gh.api.replace(/\/$/, "");
  const keyOf = (sha: string) => sha256(`${repo.scope}\n${api}/graphql#author/${repo.owner}/${repo.name}/${sha}`);
  const kept = await keptAnswers<Author>(db, wanted.map((s) => keyOf(s.sha)));
  const found = (s: Signature, a: Author | undefined) => {
    if (a?.login) accounts[s.email] = a.login;
  };
  const unknown: Signature[] = [];
  for (const s of wanted) {
    const a = kept.get(keyOf(s.sha));
    if (a) found(s, a);
    else unknown.push(s);
  }
  let asked = 0;
  let requests = 0;
  if (!gh.token) return { accounts, asked, requests };
  for (let i = 0; i < unknown.length; i += COMMITS_PER_QUERY) {
    const batch = unknown.slice(i, i + COMMITS_PER_QUERY);
    requests++;
    asked += batch.length;
    const answer = await githubGraphql<{ repository: Record<string, Authored> | null }>(null, {
      api,
      query: authorsQuery(batch.map((s) => s.sha)),
      variables: { owner: repo.owner, name: repo.name },
      token: gh.token,
      scope: repo.scope,
      ttl: 0,
      ...(gh.fetcher ? { fetcher: gh.fetcher } : {}),
    }).catch(() => null);
    const fields = answer?.status === 200 ? answer.body?.data?.repository : null;
    if (!fields) break;
    const keep: { key: string; body: Author }[] = [];
    batch.forEach((s, at) => {
      const commit = fields[`c${at}`];
      if (!commit) return;
      const a = { login: commit.author?.user?.login ?? null };
      found(s, a);
      keep.push({ key: keyOf(s.sha), body: a });
    });
    await keepAnswers(db, keep, AUTHOR_FOR);
  }
  return { accounts, asked, requests };
}

/** Runs `commitscape signatures` on a clone and reads what it wrote, deleting the file at once; null when it could not. */
export async function readSignatures(
  run: typeof runCommand,
  how: { bin: string; dir: string; scratch: string; cache?: string[]; env: NodeJS.ProcessEnv; timeoutMs: number; nice?: number; memoryMb?: number; events?: string; log?: (line: string) => void },
): Promise<Signature[] | null> {
  const file = join(how.scratch, "signatures.json");
  try {
    const args = ["signatures", ...(how.cache ?? []), ...(how.events ? ["--events", how.events] : []), "--out", file, "--", how.dir];
    const ran = await run(how.bin, args, how.env, how.timeoutMs, { ...(how.nice === undefined ? {} : { nice: how.nice }), ...(how.memoryMb === undefined ? {} : { memoryMb: how.memoryMb }) });
    if (ran.code !== 0) {
      how.log?.(`signatures: ${ran.timedOut ? "timed out" : (ran.stderr.trim().split("\n").at(-1) ?? "failed")}`);
      return null;
    }
    return signaturesOf(await readFile(file, "utf8"));
  } catch (e) {
    how.log?.(`signatures: ${(e as Error).message}`);
    return null;
  } finally {
    await rm(file, { force: true });
  }
}

/** Writes accounts.json into `scratch` for commitscape's `--accounts`: the emails never leave anywhere but that file. */
export async function writeAccountsFile(scratch: string, accounts: Record<string, string>): Promise<string> {
  const path = join(scratch, "accounts.json");
  await writeFile(path, JSON.stringify(accounts), { mode: 0o600 });
  return path;
}

/** Runs `commitscape signatures` on a clone, resolves the logins, and writes accounts.json into `scratch` for commitscape's `--accounts`; null when it could not. */
export async function writeAccounts(
  run: typeof runCommand,
  how: { bin: string; dir: string; scratch: string; cache?: string[]; env: NodeJS.ProcessEnv; timeoutMs: number; nice?: number; memoryMb?: number; log?: (line: string) => void },
  resolve: (signatures: Signature[]) => Promise<Record<string, string>>,
): Promise<string | null> {
  const signatures = await readSignatures(run, how);
  if (!signatures) return null;
  try {
    return await writeAccountsFile(how.scratch, await resolve(signatures));
  } catch (e) {
    how.log?.(`accounts: ${(e as Error).message}`);
    return null;
  }
}
