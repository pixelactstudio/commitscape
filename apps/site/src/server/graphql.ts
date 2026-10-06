import "@tanstack/react-start/server-only";
import { SiteError } from "./http";

export type GraphQL = { api: string; token: string | null; fetcher?: typeof fetch; count?: { requests: number } };

/** One request to GitHub's GraphQL API, counted; a missing token or GitHub's refusal is a SiteError. */
export async function graphql<T>(gh: GraphQL, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!gh.token) throw new SiteError(503, "The Site has no GitHub token to read GitHub with. Sign in with GitHub to use your own.");
  if (gh.count) gh.count.requests++;
  const answer = await (gh.fetcher ?? fetch)(`${gh.api.replace(/\/$/, "")}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${gh.token}`, "content-type": "application/json", "user-agent": "commitscape" },
    body: JSON.stringify({ query, variables }),
  });
  if (answer.status === 401) throw new SiteError(401, "GitHub did not accept the token. Sign in again.");
  if (answer.status === 403 || answer.status === 429) throw new SiteError(503, "GitHub's rate limit is reached for now. Try again in a few minutes.");
  if (!answer.ok) throw new SiteError(502, `GitHub answered ${answer.status}.`);
  const body = (await answer.json()) as { data?: T; errors?: { type?: string; message: string }[] };
  if (body.errors?.some((e) => e.type === "RATE_LIMITED")) throw new SiteError(503, "GitHub's rate limit is reached for now. Try again in a few minutes.");
  if (!body.data) throw new SiteError(502, body.errors?.[0]?.message ?? "GitHub sent nothing back.");
  return body.data;
}
