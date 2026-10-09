import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cachedGet, type Db } from "@commitscape/server";
import type { GitHubApi } from "./github";
import type { run as runCommand } from "./run";

export type Signature = { email: string; name: string; commits: number; sha: string };

export const AUTHOR_FOR = 365 * 24 * 3600;
const AT_ONCE = 8;
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

type Listed = { sha?: string; author?: { login?: string } | null }[];

/** Each email's GitHub login, from the account GitHub links to its newest commit, asked for the emails with most commits and kept in Postgres a year since a commit's author never changes. */
export async function accountsFor(
  db: Db,
  gh: GitHubApi,
  repo: { owner: string; name: string; scope: string },
  signatures: Signature[],
  most: number,
): Promise<{ accounts: Record<string, string>; asked: number }> {
  const accounts: Record<string, string> = {};
  const wanted: Signature[] = [];
  for (const s of [...signatures].sort((a, b) => b.commits - a.commits)) {
    const login = noreplyLogin(s.email);
    if (login) accounts[s.email] = login;
    else if (OID.test(s.sha) && wanted.length < most) wanted.push(s);
  }
  const api = gh.api.replace(/\/$/, "");
  let asked = 0;
  let stopped = false;
  const ask = async (s: Signature) => {
    if (stopped) return;
    asked++;
    const answer = await cachedGet<Listed>(db, {
      url: `${api}/repos/${repo.owner}/${repo.name}/commits?sha=${s.sha}&per_page=1`,
      token: gh.token,
      scope: repo.scope,
      ttl: AUTHOR_FOR,
      ...(gh.fetcher ? { fetcher: gh.fetcher } : {}),
    });
    if (answer.status === 403 || answer.status === 429 || answer.status === 401) stopped = true;
    const first = answer.body?.[0];
    if (first?.sha === s.sha && first.author?.login) accounts[s.email] = first.author.login;
  };
  const settle = (s: Signature) =>
    ask(s).catch(() => {
      stopped = true;
    });
  for (let i = 0; i < wanted.length && !stopped; i += AT_ONCE) await Promise.all(wanted.slice(i, i + AT_ONCE).map(settle));
  return { accounts, asked };
}

/** Runs `commitscape signatures` on a clone, resolves the logins, and writes accounts.json into `scratch` for commitscape's `--accounts`; null when it could not, the emails never left anywhere but that file. */
export async function writeAccounts(
  run: typeof runCommand,
  how: { bin: string; dir: string; scratch: string; env: NodeJS.ProcessEnv; timeoutMs: number; log?: (line: string) => void },
  resolve: (signatures: Signature[]) => Promise<Record<string, string>>,
): Promise<string | null> {
  const file = join(how.scratch, "signatures.json");
  try {
    const ran = await run(how.bin, ["signatures", "--out", file, "--", how.dir], how.env, how.timeoutMs);
    if (ran.code !== 0) {
      how.log?.(`signatures: ${ran.timedOut ? "timed out" : (ran.stderr.trim().split("\n").at(-1) ?? "failed")}`);
      return null;
    }
    const accounts = await resolve(signaturesOf(await readFile(file, "utf8")));
    const path = join(how.scratch, "accounts.json");
    await writeFile(path, JSON.stringify(accounts), { mode: 0o600 });
    return path;
  } catch (e) {
    how.log?.(`accounts: ${(e as Error).message}`);
    return null;
  } finally {
    await rm(file, { force: true });
  }
}
