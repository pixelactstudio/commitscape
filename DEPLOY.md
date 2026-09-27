# Deploying commitscape

In one Dokploy project you create a Postgres database and two
applications from this repository. Both applications build from a
Dockerfile.

| Service | Type | What it does |
|---|---|---|
| `postgres` | Database | Repositories, Builds, Shared Reports, sign-ins, and the Build queue (pg-boss) |
| `builder` | Application | Takes Builds from the queue, clones the repository, runs `commitscape report`, stores the Report in R2. No domain. |
| `site` | Application | The website, its API and the MCP server, on port 3000 |

Reports, cards and Shared Reports live in a Cloudflare R2 bucket.

## 1. The R2 bucket

In Cloudflare, create a bucket (for example `commitscape-reports`) and an
R2 API token with "Object Read & Write" on it. Keep these four values:

| Value | Variable |
|---|---|
| `https://<account id>.r2.cloudflarestorage.com` | `S3_ENDPOINT` |
| The bucket's name | `S3_BUCKET` |
| The token's Access Key ID | `S3_ACCESS_KEY_ID` |
| The token's Secret Access Key | `S3_SECRET_ACCESS_KEY` |

The bucket stays private. The Site serves what is in it through its own
routes, which check who may read what.

## 2. The GitHub App

Signing in and private repositories go through a GitHub App. On GitHub,
open Settings, Developer settings, GitHub Apps, New GitHub App.

| Field | Value |
|---|---|
| Homepage URL | `https://example.com` |
| Callback URL | `https://example.com/api/auth/callback/github` |
| Expire user authorization tokens | On |
| Request user authorization (OAuth) during installation | Off |
| Setup URL | `https://example.com/me`, with "Redirect on update" on |
| Webhook URL | `https://example.com/api/github/webhooks` |
| Webhook secret | A random string: `GITHUB_WEBHOOK_SECRET` |
| Where can this GitHub App be installed? | Any account |

Repository permissions, all read-only: Metadata, Contents, Pull requests,
Issues. Add the account permission "Email addresses" (read-only) to store
people's real address; without it the Site stores their GitHub noreply
address.

Keep the App ID (`GITHUB_APP_ID`), the slug from `github.com/apps/<slug>`
(`GITHUB_APP_SLUG`), the Client ID (`GITHUB_APP_CLIENT_ID`), a new client
secret (`GITHUB_APP_CLIENT_SECRET`) and a new private key. Put the private
key in `GITHUB_APP_PRIVATE_KEY` as the PEM file's text in quotes, or as one
line from `base64 -w0 key.pem`.

Without the App, the Site still shows public repositories, but signing in
and private repositories are off.

## 3. Postgres

In the project, create a Postgres database. Deploy it, then copy its
internal connection URL from the database's page. Both applications use
it as `DATABASE_URL`. Turn on its scheduled backups to an S3 destination;
the R2 bucket and this database hold everything the Site keeps.

## 4. The Builder

Create an application named `builder`:

| Setting | Value |
|---|---|
| Provider | GitHub, this repository, branch `main`, build path `/` |
| Build Type | Dockerfile |
| Dockerfile Path | `apps/builder/Dockerfile` |
| Docker Context Path | `.` |
| Watch Paths | `crates/**`, `xtask/**`, `Cargo.lock`, `apps/builder/**`, `packages/server/**`, `packages/data/**`, `pnpm-lock.yaml` |

In Advanced, Volumes, add a volume named `commitscape-builder-work` with
mount path `/work`. It keeps clones between Builds so the next Build of a
repository only fetches what is new.

Environment:

```sh
DATABASE_URL=<the internal connection URL>
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
S3_BUCKET=commitscape-reports
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
GITHUB_TOKEN=...                 # a token with no scopes: GitHub's search limits for the Leaderboards
GITHUB_APP_ID=...                # for private repositories
GITHUB_APP_PRIVATE_KEY="..."
```

Optional limits, with their defaults:

| Variable | Default | What |
|---|---|---|
| `CONCURRENCY` | 1 | Builds at a time |
| `FULL_CLONE_UP_TO_MB` | 100 | Larger repositories are cloned without old file contents, and their lines are not counted |
| `MAX_REPOSITORY_MB` | 3000 | Larger repositories are refused |
| `TIME_LIMIT_SECONDS` | 900 | A Build stops after this long |
| `DISK_BUDGET_GB` | 20 | Past this, the least recently built clones in `/work` are deleted |
| `SEED_LANGUAGES`, `SEED_PER_LANGUAGE`, `SEED_BUDGET` | 9 languages, 10, 50 | The nightly Leaderboard Builds |

Deploy it. It applies the database migrations, then logs `builder working`.

In Schedules, add two jobs for this application:

| Cron | Command | What it does |
|---|---|---|
| `*/15 * * * *` | `node builder.mjs cleanup` | Deletes expired Shared Reports, old rate-limit counts, ended sessions, and Connected Repositories' Reports unseen for 30 days |
| `0 3 * * *` | `node builder.mjs seed` | Queues the night's Leaderboard Builds |

## 5. The Site

Create an application named `site`:

| Setting | Value |
|---|---|
| Provider | GitHub, this repository, branch `main`, build path `/` |
| Build Type | Dockerfile |
| Dockerfile Path | `apps/site/Dockerfile` |
| Docker Context Path | `.` |
| Watch Paths | `apps/site/**`, `packages/**`, `pnpm-lock.yaml` |

Environment:

```sh
DATABASE_URL=<the internal connection URL>
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
S3_BUCKET=commitscape-reports
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
BETTER_AUTH_URL=https://example.com
BETTER_AUTH_SECRET=...           # openssl rand -hex 32
GITHUB_TOKEN=...                 # the same token: GitHub's API limits for lookups
GITHUB_APP_ID=...
GITHUB_APP_SLUG=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_PRIVATE_KEY="..."
GITHUB_WEBHOOK_SECRET=...
SENTRY_DSN=...                   # optional: the server's errors
```

Build Time Arguments are built into the page, so change them with a
redeploy:

```sh
VITE_SENTRY_DSN=...              # optional: the browser's errors
VITE_POSTHOG_KEY=phc_...         # optional: page views in PostHog Cloud
VITE_POSTHOG_HOST=https://us.i.posthog.com
SENTRY_ORG=...                   # optional, with the secret below: source maps
SENTRY_PROJECT=...
```

To upload source maps to Sentry, add a Build-time Secret named
`SENTRY_AUTH_TOKEN`. Without it the build skips the upload.

In Domains, add `example.com` with container port 3000 and HTTPS on. If
Cloudflare proxies the domain, the Site reads the visitor's address from
`cf-connecting-ip`; otherwise it reads the first address in
`x-forwarded-for`, which Traefik sets.

The image has a health check on `/api/health`. For deploys without
downtime, add the same check in Advanced, Swarm Settings, with the update
order "start-first".

Deploy it after the Builder, so the tables exist.

## 6. Check it

1. Open `https://example.com/gh/BurntSushi/ripgrep`. GitHub's facts show at
   once and the Report follows within a minute. The Builder's logs show
   the Build.
2. In any repository, run
   `COMMITSCAPE_SITE=https://example.com npx commitscape share --yes` and
   open the link it prints.
3. Sign in with GitHub, install the App on a private repository, and open
   it from `/me`.
4. Point an MCP client at `https://example.com/mcp` and call
   `lookup_repository`.

Before the next CLI release, set `SITE_ORIGIN` in
`packages/data/src/product.ts` to the Site's address, so
`commitscape share` uploads there by default.
