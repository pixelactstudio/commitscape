# GitHub's API: what we use, what limits it, how to get more room

GitHub has no paid tier for API headroom. Limits come from the kind of token a request carries, so the work is to
make fewer requests, spend the right person's token, and survive running out.

## The limits

| Token | REST | GraphQL | Source |
|---|---|---|---|
| None (per IP address) | 60 / hour | not allowed | [REST limits][rest] |
| A person's token (OAuth, GitHub App user token) | 5,000 / hour per person | 5,000 points / hour per person | [REST][rest], [GraphQL][gql] |
| GitHub App installation token | 5,000 / hour, +50 per repository and +50 per user above 20, up to 12,500 | 5,000 points, with the same bonuses | [REST][rest], [GraphQL][gql] |
| Same, on a GitHub Enterprise Cloud organisation | 15,000 / hour | 10,000 points / hour | [REST][rest], [GraphQL][gql] |
| `GITHUB_TOKEN` in Actions | 1,000 / hour per repository | 1,000 points / hour | [REST][rest] |
| Search endpoints (`/search/...`) | 30 / minute (10 for code search), apart from the above | | [Search][search] |
| Secondary limits (all tokens) | 100 concurrent requests, 900 points / minute (REST), 2,000 points / minute (GraphQL) | | [REST][rest], [GraphQL][gql] |

A conditional request that answers `304 Not Modified` does not count against the primary limit
([best practices][best]). GraphQL has no ETags. A limited REST request answers 403 or 429 with
`x-ratelimit-remaining: 0` or `retry-after`; a limited GraphQL request answers 200 with a `RATE_LIMITED` error.
GitHub asks you to stop until `x-ratelimit-reset` and warns that going on can get an integration banned.

[rest]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[gql]: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
[search]: https://docs.github.com/en/rest/search/search
[best]: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

## What the Site and the Builder ask GitHub

"Site token" is the token minted from the App's own installation (or `GITHUB_TOKEN` without one): one allowance
shared by everyone. "Their token" is the signed-in person's own GitHub App user token, so it spends their allowance.
Every page but Cards, Shared Reports and shared Proof of Work needs a signed-in person, so nobody signed out makes the
Site ask GitHub anything.

| Call | Where | Token | Before | Now |
|---|---|---|---|---|
| A repository's facts: the repository, languages, contributors, releases (4 REST GETs) | `askGitHub`, from `known()` on every repository page, Build request and Report read | Their token first for a public repository, the Site token if GitHub refuses it; their token and scope for a private one | 4 requests per repository every hour it is visited, nothing shared | Cached in Postgres: 6 h for the repository, 24 h for the rest, then revalidated with the stored ETag (304 is free). Private facts are kept per person |
| Does GitHub show this person this repository | `canSee` | Their token | 1 request per session and repository every 5 min | Same cadence, revalidated with an ETag, kept per session |
| Settings: installations and their repositories | `mine()` | Their token | 1 + up to 20 requests on every load | Kept 60 s per person, then ETag revalidation |
| Search box (users and repositories) | `searchGitHub` | Site token | 2 requests per distinct query per 10 min, in one process's memory | Same 10 min, also in Postgres, so restarts and several servers share it; ETag after |
| A Profile: who the person is, then each year's contributions, then pull request search ranges and reviewers (GraphQL) | `lookupProfile`, `readProfile` | Their token, else the Site token for someone signed in whose token GitHub refuses | Once per person per day (the stored Profile), but the identity query ran twice on a cold Profile | Under the Site token each GraphQL answer is also kept 1 h in Postgres and merged when concurrent; their token is never cached. Cards and requests nobody signed in to get the stored copy only |
| When a person commits (REST search) | `fetchClock` | As above | 1 request per full Profile read | Under the Site token kept 1 h, ETag after |
| Proof of Work (GraphQL searches and commit histories) | `workOf` | Their token, else the Site token up to 40 requests a read | In-process, 10 min | Site-token answers also kept 1 h in Postgres; the private-repository listing is never cached |
| Who is signed in | `syncLogin`, at every sign-in | Their token (`GET /user`) | Never worked: Better Auth dropped the login | 1 request per sign-in on their allowance |
| A missing login, for accounts that signed in before | `loginOf` | Their token, else the Site token (`GET /user/{id}`) | n/a | Once per person, then stored |
| Which App installation reads a private repository | `installationOf` (App JWT) | The App | Each time a signed-in viewer who can see an unconnected private repository opens it | Unchanged; low volume |
| A pull request's description, comments and reviews (3 REST GETs: `/pulls/N`, `/issues/N/comments`, `/pulls/N/reviews`) | `pullConversation`, only when a signed-in person opens a pull request's Conversation | Their token, cached for them alone (`scope` `user:<id>`) | n/a | 5 min per person and pull request, then revalidated with the stored ETag. Never shown or read for people signed out |
| A Report's pull requests (GraphQL), the GitHub account behind each author's commits (GraphQL, a hundred commits to a request), the seed list (REST search), installation tokens (App JWT) | Builder | Site token for public repositories, an installation token for connected private ones | Not cached | Each commit's author account is kept a year in `github_cache`, under `public` or the repository's own scope, since a commit's author never changes; a noreply address needs no request |

The Code, Branches and Pull requests screens cost no request at all. The Builder reads branches, tags, the files at HEAD with their history, and pull
requests' commits, files and diffs from its kept clone with git: `git ls-remote` lists `refs/pull/N/head` and `git fetch` takes the heads, which GitHub
serves as git, not through the API. Pull request titles, states and reviewers still come from the GraphQL read and the webhooks above.

Webhooks cost nothing: GitHub calls the Site (`/api/github/webhooks`) for repositories the App is installed on.
`onWebhook` (`apps/site/src/server/webhooks.ts`) keeps pull requests, reviews and counts from the payloads, rebuilds
after a push to the default branch, follows renames and visibility, records an activity feed, and deletes a person's
tokens when they revoke the App. DEPLOY.md lists the events.

## Whose token pays

| Work | Token, first that exists |
|---|---|
| A Build, its pull requests, its author accounts | The repository's own installation (its own allowance); the token the signed-in person who asked for it lent (sealed in `lent_tokens` with `TOKEN_SECRET`, six hours); the Site token |
| A private repository | Its installation only |
| Anything a signed-in person opens | Their token first, the Site token if GitHub refuses it |
| Anything someone signed out opens | Nothing: Cards draw from stored rows (a person nobody has read yet gets the pending Card), and every other page asks them to sign in |

The Site token is minted from the App's own installation (`GITHUB_APP_INSTALLATION_ID`) and renewed every hour
(`siteToken` in `packages/server/src/github-app.ts`). It is refused if that installation can read anything private.
Pooling other people's tokens or installations to serve unrelated visitors is never done: GitHub treats it as getting
around the limits.

## What needs a signed-in person

Everything but a short list. `gate` (`apps/site/src/server/gate.ts`) runs before any page, API route or server
function: Cards, Shared Reports, shared Proof of Work, `/privacy`, the sign-in page, Better Auth, the webhooks,
`/api/health`, PostHog's `/ingest` and `/mcp` (which checks its own `MCP_TOKEN`) are open; anything else sends a page to
`/sign-in` and answers the API with 401. A signed-in person whose GitHub token is gone reads through the Site token,
within the per-address limits; Proof of Work reads through it at most 40 requests at a time, then asks them to sign in
again.

## What was done to use less

- **One cache, `github_cache`.** `cachedGet` (REST) and `githubGraphql` (GraphQL) in `packages/server/src/github-cache.ts`
  answer from Postgres while an answer is fresh. The key is a hash of scope and request, so an answer made for one
  person is never given to another. `scope` defaults to `public`: pass `user:<id>` or `session:<id>` whenever the token
  is a person's. Cleanup deletes answers a day after they expire.
- **ETags.** Past its time to live a REST answer is asked again with `If-None-Match`; a 304 renews it without using
  the allowance. GraphQL is by time to live alone.
- **Their own token first.** Anything a signed-in person triggers is read with their token where the answer is the
  same for everyone (public repository facts), so their allowance is spent, not the Site's. If GitHub refuses their
  token the Site token follows.
- **Public and private never mix.** GraphQL answers are cached only under the Site token (`GITHUB_TOKEN` should be a
  token with no scopes, which sees public data only). A repository a visitor's token can see but the Site's cannot
  is treated as not found, and nothing about it is stored under `public`.
- **One request for identical concurrent requests,** inside a process.
- **Stale rather than failing.** When GitHub answers 403/429/5xx, a `RATE_LIMITED` error, or cannot be reached, the
  expired answer is served. Each token's `x-ratelimit-*` headers (REST and GraphQL) are remembered: at 5% left or
  less (at least 5) expired answers are served without asking, and at 0 nothing is sent until the window resets.
  Without a stored answer the request fails as before ("rate limit is reached for now").
- **Short memory of refusals.** A 404 is kept 10 min, other refusals like 403 "list too large" 5 min to 1 h,
  so a missing repository or giant contributor list is not asked again every visit. Failures are never kept.

## Watching usage

- Any process that goes through the cache (the Site; the Builder where it uses `cachedGet`) logs one line when a token falls to 5% of its window, once per token, resource and window:

  ```
  github rate limit low: public core 212/5000 left, resets 2026-10-08T21:00:00.000Z
  ```

  The first word after "low:" is the scope (`public` is the Site token, `user` a person, `session` a signed-in
  session), then the resource (`core`, `graphql`, `search`). `docker logs <site> | grep "github rate limit"`.
- `githubLimits()` returns the same numbers from memory.
- GitHub will tell you directly, without spending anything:
  `curl -s -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/rate_limit`.
- The `github_cache` table shows what is kept: rows by `status`, and `until` for when each goes stale.

## Getting more headroom

There is no paid add-on. The real options:

1. **Spend more people's tokens.** Every signed-in person brings 5,000 requests an hour. The more the Site does with
   their token (it already reads their Profile, Proof of Work, Versus and public repository facts that way), the less
   the shared Site token carries.
2. **Use App installation tokens where a repository is connected.** Their allowance grows with the repositories and
   users of the installation, up to 12,500 an hour.
3. **GitHub Enterprise Cloud** raises an App owned by or installed on such an organisation to 15,000 an hour (REST).
4. **Webhooks instead of polling.** Subscribe the App to `push`, `repository` and `installation_repositories` events
   and refresh a repository when it changes rather than when its facts get old. GitHub's own guidance is to prefer
   webhooks to polling.
5. **Ask GitHub.** GitHub documents no way to request higher limits. For a free, open-source project the only route
   is asking GitHub support, mainly about secondary limits; there is no promise.

## Working with it

Environment variables, all read at run time (`apps/site/src/server/env.ts`, `apps/builder/src/config.ts`):

| Variable | Who | What |
|---|---|---|
| `GITHUB_API` | Site, Builder | API base, default `https://api.github.com`. Point it at a fake for tests |
| `GITHUB_TOKEN` | Site, Builder | The Site token when there is no installation to mint one from, or a fallback when the installation's is refused. A token with no scopes: public data only |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | Site, Builder | The App's identity, for installation lookups and tokens |
| `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | Site | Sign in with GitHub, and the install link |
| `GITHUB_WEBHOOK_SECRET` | Site | Checks webhook signatures |
| `GITHUB_APP_INSTALLATION_ID` | Site, Builder | The installation the Site token is minted from; public repositories only |
| `TOKEN_SECRET` | Site, Builder | Seals the tokens people lend to their Builds, and keys the code PostHog counts a person under; the same on both |

Testing:

- `pnpm --filter @commitscape/server test` covers the cache (`github-cache.test.ts`: ETags, scopes, stale on limit,
  single flight, pruning) on PGlite.
- `pnpm --filter @commitscape/site test` covers who is called with what token (`github.test.ts`, `graphql.test.ts`,
  `repos.test.ts`, `me.test.ts`), the login kept at sign-in and backfilled (`sign-in.test.ts`, `logins.test.ts`).
- `pnpm e2e` runs the Site against a fake GitHub.
- By hand: put a `GITHUB_TOKEN` in `apps/site/.env`, run `pnpm services` and `pnpm dev:site`, open a few Profiles and
  repositories twice, and watch `github_cache` grow while the second visit sends nothing. Lower the numbers by
  deleting its rows to see a cold start.
