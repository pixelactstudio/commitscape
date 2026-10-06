export type GitHubApi = { api: string; token: string | null; fetcher?: typeof fetch };

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One GraphQL request to GitHub; throws on an HTTP failure or when GitHub answers only errors. */
export async function graphql<T>(gh: GitHubApi, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!gh.token) throw new GitHubError(401, "GitHub's GraphQL API needs a token");
  const answer = await (gh.fetcher ?? fetch)(`${gh.api.replace(/\/$/, "")}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${gh.token}`, "content-type": "application/json", "user-agent": "commitscape" },
    body: JSON.stringify({ query, variables }),
  });
  if (!answer.ok) throw new GitHubError(answer.status, `GitHub answered ${answer.status}`);
  const body = (await answer.json()) as { data?: T; errors?: { message: string }[] };
  if (!body.data) throw new GitHubError(502, body.errors?.[0]?.message ?? "GitHub sent no data");
  return body.data;
}
