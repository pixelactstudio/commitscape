# Deploying commitscape

In one Dokploy project you create a Postgres database and two
applications. The applications run the images CI publishes to GitHub's
container registry, so your servers never build anything:

| Image | Tags |
|---|---|
| `ghcr.io/pixelactstudio/commitscape-site` | `main` (every merge), `latest` and `vX.Y.Z` (every release), `sha-<commit>` |
| `ghcr.io/pixelactstudio/commitscape-builder` | the same |

Use `main` to follow every merge, or `latest` to move only on releases.
GitHub makes a new container package private: after CI first pushes each
image, open it under the organisation's Packages, then Package settings,
and change its visibility to Public.
The images take every setting from the environment, so the same image runs
on any server.

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
| Provider | Docker, image `ghcr.io/pixelactstudio/commitscape-builder:main` |
| Registry | None: the image is public |

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
GITHUB_TOKEN=...                 # a token with no scopes: GitHub's search limits for the Leaderboards, people's logins, and each repository's pull requests
GITHUB_APP_ID=...                # for private repositories
GITHUB_APP_PRIVATE_KEY="..."
```

Optional limits, with their defaults:

| Variable | Default | What |
|---|---|---|
| `CONCURRENCY` | 1 | Builds at a time |
| `MAX_REPOSITORY_MB` | none | Unset, every repository is cloned in full and its lines counted, however big; set, larger repositories are refused |
| `TIME_LIMIT_SECONDS` | 900 | How long a Build's first attempt may take. One that runs out is queued again and goes on from the lines it counted, each attempt given twice the time, four attempts in all |
| `DISK_BUDGET_GB` | 20 | Past this, the least recently built clones in `/work` are deleted |
| `SURVIVING_BUDGET_SECONDS` | 60 | How long one count of a person's Surviving Lines may take at first. A count past it is queued again with twice the budget, up to four hours, and goes on from the files it counted; cloning and loading the repository have `TIME_LIMIT_SECONDS` of their own |
| `PULLS_TIME_LIMIT_SECONDS` | 1800 | How long one read of a repository's pull requests may take; facebook/react's first read took 24 minutes, so a busy repository's first read may need longer, once |
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
| Provider | Docker, image `ghcr.io/pixelactstudio/commitscape-site:main` |
| Registry | None: the image is public |

Environment:

```sh
DATABASE_URL=<the internal connection URL>
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
S3_BUCKET=commitscape-reports
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
BETTER_AUTH_URL=https://example.com
BETTER_AUTH_SECRET=...           # openssl rand -hex 32
GITHUB_TOKEN=...                 # the same token, required: Profiles, Proof of Work, Races and Crews read GitHub's GraphQL API, which needs a token; signed-in people use their own
GITHUB_APP_ID=...
GITHUB_APP_SLUG=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_PRIVATE_KEY="..."
GITHUB_WEBHOOK_SECRET=...
SENTRY_DSN=...                   # optional: the server's errors
```

Browser settings are read at run time too, and the server writes them into
the page:

```sh
PUBLIC_SENTRY_DSN=...            # optional: the browser's errors
PUBLIC_POSTHOG_KEY=phc_...       # optional: page views in PostHog Cloud
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

In Domains, add `example.com` with container port 3000 and HTTPS on. If
Cloudflare proxies the domain, the Site reads the visitor's address from
`cf-connecting-ip`; otherwise it reads the first address in
`x-forwarded-for`, which Traefik sets.

The image has a health check on `/api/health`. For deploys without
downtime, add the same check in Advanced, Swarm Settings, with the update
order "start-first".

Deploy it after the Builder, so the tables exist.

## Deploying every merge

CI publishes new images on every merge to `main`. To have Dokploy pull them
at once, create an API key in Dokploy (Settings, Profile, API/CLI) and, in
this repository's settings on GitHub, add:

| Kind | Name | Value |
|---|---|---|
| Variable | `DOKPLOY_URL` | Your Dokploy panel, like `https://dokploy.example.com` |
| Secret | `DOKPLOY_API_KEY` | The API key |
| Variable | `DOKPLOY_BUILDER_APP_ID` | The builder application's id, from its URL in Dokploy |
| Variable | `DOKPLOY_SITE_APP_ID` | The site application's id |

The Docker images workflow then redeploys the Builder, then the Site, after
it pushes.

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

Before the next CLI release, set `DEFAULT_SITE` in
`crates/commitscape/src/share.rs` to the Site's address, so
`commitscape share` uploads there by default.
