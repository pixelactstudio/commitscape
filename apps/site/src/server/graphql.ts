import "@tanstack/react-start/server-only";
import { githubGraphql, type Db } from "@commitscape/server";
import { GITHUB_TTL } from "./github";
import { SiteError } from "./http";

export type GraphQL = {
  api: string;
  token: string | null;
  fetcher?: typeof fetch;
  count?: { requests: number };
  cache?: { db: Db; scope: string };
};

const LIMITED = "GitHub's rate limit is reached for now. Try again in a few minutes.";

/** One request to GitHub's GraphQL API, counted when it reaches GitHub. Only public data under the Site's token may set `gh.cache`; a `ttl` of zero never touches it. A missing token or GitHub's refusal is a SiteError. */
export async function graphql<T>(gh: GraphQL, query: string, variables: Record<string, unknown> = {}, ttl = GITHUB_TTL.graphql): Promise<T> {
  if (!gh.token) throw new SiteError(503, "The Site has no GitHub token to read GitHub with. Sign in with GitHub to use your own.");
  const kept = gh.cache && ttl > 0 ? gh.cache : undefined;
  const answer = await githubGraphql<T>(kept?.db ?? null, { api: gh.api, query, variables, token: gh.token, scope: kept?.scope, ttl, fetcher: gh.fetcher }).catch((e: unknown) => {
    if (gh.count) gh.count.requests++;
    throw e;
  });
  if (gh.count && !answer.cached) gh.count.requests++;
  if (answer.status === 401) throw new SiteError(401, "GitHub did not accept the token. Sign in again.");
  if (answer.status === 403 || answer.status === 429) throw new SiteError(503, LIMITED);
  if (answer.status !== 200) throw new SiteError(502, `GitHub answered ${answer.status}.`);
  const body = answer.body;
  if (body?.errors?.some((e) => e.type === "RATE_LIMITED")) throw new SiteError(503, LIMITED);
  if (!body?.data) throw new SiteError(502, body?.errors?.[0]?.message ?? "GitHub sent nothing back.");
  return body.data;
}
