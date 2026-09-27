# Deploying commitscape

The Site runs as three Docker services on one server, set up in Dokploy
from `compose.yaml`:

| Service | What it does |
|---|---|
| `postgres` | The database: repositories, Builds, Shared Reports, sign-ins, and the Build queue (pg-boss) |
| `site` | The website, API and MCP server: TanStack Start on Node, port 3000 |
| `builder` | Takes Builds from the queue, clones the repository, runs `commitscape report`, and stores the Report in R2 |

Reports, cards and Shared Reports live in a Cloudflare R2 bucket, which the
Site and the Builder reach through R2's S3 API.

## 1. The R2 bucket

In Cloudflare, create a bucket (for example `commitscape-reports`). Then
create an R2 API token with "Object Read & Write" on that bucket. Note:

| Value | Setting |
|---|---|
| `https://<account id>.r2.cloudflarestorage.com` | `S3_ENDPOINT` |
| The bucket's name | `S3_BUCKET` |
| The token's Access Key ID | `S3_ACCESS_KEY_ID` |
| The token's Secret Access Key | `S3_SECRET_ACCESS_KEY` |

The bucket stays private. The Site serves everything in it through its own
routes, which check who may read what.

## 2. The GitHub App

Signing in and private repositories go through a GitHub App. On GitHub,
open Settings, Developer settings, GitHub Apps, New GitHub App (for an
organisation, the same under its settings).

| Field | Value |
|---|---|
| Homepage URL | `https://example.com` |
| Callback URL | `https://example.com/api/auth/callback/github` |
| Expire user authorization tokens | On. Better Auth refreshes them. |
| Request user authorization (OAuth) during installation | Off. People sign in first, then install. |
| Setup URL | `https://example.com/me`, with "Redirect on update" on |
| Webhook URL | `https://example.com/api/github/webhooks` |
| Webhook secret | A random string: `GITHUB_WEBHOOK_SECRET` |
| Where can this GitHub App be installed? | Any account |

Repository permissions, all read-only: Metadata, Contents, Pull requests,
Issues. Under account permissions, give "Email addresses" read-only if you
want people's real address on their account; without it the Site stores
their GitHub noreply address. Nothing needs write access.

Create the App, then note its App ID (`GITHUB_APP_ID`), Client ID
(`GITHUB_APP_CLIENT_ID`), a new client secret (`GITHUB_APP_CLIENT_SECRET`),
the slug in `github.com/apps/<slug>` (`GITHUB_APP_SLUG`), and a new private
key. The private key goes in `GITHUB_APP_PRIVATE_KEY`, either as the PEM
file's text or base64-encoded on one line (`base64 -w0 key.pem`).

Without the App, the Site still shows public repositories. Signing in and
private repositories are off.

## 3. The Compose service in Dokploy

Create a Compose service from this repository, with `compose.yaml` as its
file. Keep Dokploy's own project name: its scheduled jobs find the
containers by it. Set these environment variables:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `SITE_URL` | `https://example.com` |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | From step 1 |
| `GITHUB_TOKEN` | A GitHub token with no scopes. It raises GitHub's API limits for lookups and the Leaderboards' search. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | From step 2 |
| `SENTRY_DSN` | Optional. The server's errors go to this Sentry project. |
| `VITE_SENTRY_DSN` | Optional. The browser's errors. It is built into the page, so redeploy after changing it. |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | Optional. PostHog Cloud's project key and host (`https://us.i.posthog.com` or `https://eu.i.posthog.com`). Built into the page. |
| `CLIENT_IP_HEADER` | The header your proxy puts the visitor's address in. `x-forwarded-for` for Traefik. Behind Cloudflare's proxy the Site reads `cf-connecting-ip` first. |

In the Domains tab, add `example.com` to the `site` service on port 3000.

Deploy. The Builder applies the database migrations when it starts, then
waits for Builds. The Site answers `/api/health` once it can reach Postgres.

## 4. Scheduled jobs

In Dokploy's Schedules, add two Compose jobs on the `builder` service:

| Cron | Command | What it does |
|---|---|---|
| `*/15 * * * *` | `node builder.mjs cleanup` | Removes expired Shared Reports, old rate-limit counts, ended sessions, and Connected Repositories' Reports unseen for 30 days |
| `0 3 * * *` | `node builder.mjs seed` | Queues the night's Leaderboard Builds: the most starred repositories per language, within `SEED_BUDGET` (50) |

## 5. Check it

1. Open `https://example.com/gh/BurntSushi/ripgrep`. GitHub's facts show at
   once, and the Report follows within a minute.
2. Run `COMMITSCAPE_SITE=https://example.com npx commitscape share --yes`
   in any repository and open the link it prints.
3. Sign in with GitHub, install the App on a private repository, and open
   it from `/me`.
4. Point an MCP client at `https://example.com/mcp` and call
   `lookup_repository`.

Set `SITE_ORIGIN` in `packages/data/src/product.ts` to the Site's address
before the next CLI release, so `commitscape share` uploads there by
default.

## The Builder's limits

Set these on the `builder` service to change them:

| Variable | Default | What |
|---|---|---|
| `CONCURRENCY` | 1 | Builds at a time |
| `FULL_CLONE_UP_TO_MB` | 100 | Larger repositories are cloned without old file contents, and their lines are not counted |
| `MAX_REPOSITORY_MB` | 3000 | Larger repositories are refused |
| `TIME_LIMIT_SECONDS` | 900 | A Build is stopped after this long |
| `DISK_BUDGET_GB` | 20 | Past this, the least recently built clones in `/work` are deleted |
| `SEED_LANGUAGES`, `SEED_PER_LANGUAGE`, `SEED_BUDGET` | 9 languages, 10, 50 | The nightly Leaderboard Builds |

## Backups

Everything the Site needs to rebuild lives in Postgres and the R2 bucket.
Back up the `postgres` volume with Dokploy's database backups or
`pg_dump`. The Builder's `/work` volume holds only clones, which it
recreates.
