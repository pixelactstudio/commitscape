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

Subscribe to these events. Each one costs nothing: GitHub sends it, the Site
asks GitHub nothing back, and only repositories the App is installed on send
them.

| Event | What the Site does |
|---|---|
| Installation, Installation repositories | Links or removes the repositories |
| Push | Rebuilds after a push to the default branch, at most every 30 minutes |
| Pull request, Pull request review | Keeps pull requests and reviews without reading them all again |
| Repository | Deleted: removes the Report. Made private or public: follows. Renamed or moved: follows on the next visit |
| Release | Reads the repository's facts again on the next visit |
| Star, Fork | Keeps the counts |
| Create, Delete | Records new and deleted branches and tags |

Every event also keeps the star, fork and issue counts it carries, and most
are recorded for the activity feed for 30 days. GitHub sends "GitHub App
authorization" on its own: when someone revokes the App, their stored tokens
are deleted.

### The Site's own token

The Site and the Builder read public data with a token they mint from one
installation of the App, renewed every hour, instead of a person's token.
Install the App on an account (or an organisation of your own) and choose
"Only select repositories" with public repositories only; then put that
installation's id, the number at the end of its settings page's address, in
`GITHUB_APP_INSTALLATION_ID`. If that installation can read any private
repository the Site refuses its token, logs why, and falls back to
`GITHUB_TOKEN`, so private data is never kept as public.

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

Each repository's history is kept here as its Stored Index: about 30 MB for
a repository the size of facebook/react, indexes included
([ADR-0027](./docs/adr/0027-the-index-is-kept-in-postgres.md)). A migration
turns on the `btree_gin` extension when the database allows it, for a faster
lookup of a file's commits; without it the Site still works. The Stored Index's
tables have no foreign keys, so a load does not check one per row; a trigger
on `stored_indexes` deletes a Stored Index's rows with it.

A repository built before Stored Indexes keeps showing its old Report until
its next Build, which loads its Stored Index; its Commits screen waits for
that Build, since the old `commits` table is dropped. The same release reads every
repository's pull requests once more, to learn the branch each came from.

A release that keeps more of each pull request (who merged it, its base and
head, labels, draft, review state and the rest) reads each repository's pull
requests once more after its next Build, all of them; a read that reaches its
time limit goes on from where it stopped a minute later, until it is done.

## 4. The Builder

Create an application named `builder`:

| Setting | Value |
|---|---|
| Provider | Docker, image `ghcr.io/pixelactstudio/commitscape-builder:main` |
| Registry | None: the image is public |

In Advanced, Volumes, add a volume named `commitscape-builder-work` with
mount path `/work`. It keeps clones between Builds so the next Build of a
repository only fetches what is new. A cold Build clones twice at once (a
quick clone without old file contents, and the full clone), so leave room
for both: several GB for a repository the size of torvalds/linux.

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
GITHUB_APP_INSTALLATION_ID=...   # the Site's own installation, public repositories only; GITHUB_TOKEN is then only a fallback
TOKEN_SECRET=...                 # the same as the Site's; openssl rand -hex 32
```

Optional limits, with their defaults:

| Variable | Default | What |
|---|---|---|
| `CONCURRENCY` | 1 | Builds at a time, for repositories under `LARGE_REPOSITORY_MB` |
| `LARGE_REPOSITORY_MB` | 1500 | Repositories larger than this, by GitHub's size, are built in a lane of their own |
| `LARGE_CONCURRENCY` | 1 | Builds at a time in that lane |
| `MAX_REPOSITORY_MB` | none | Unset, every repository is cloned in full and its lines counted, however big; set, larger repositories are refused |
| `TIME_LIMIT_SECONDS` | 900 | How long one run of the binary may take on a Build's first attempt, the clone not included. One that runs out is queued again and goes on from the lines it counted, each attempt given twice the time, four attempts in all |
| `CLONE_TIME_LIMIT_SECONDS` | 1800 | How long a clone or fetch may take on the first attempt, doubled with each attempt |
| `LOGINS_ASKED` | 300 | At most this many commit authors a Build asks GitHub for the login of; each answer is kept for a year, so a rebuild asks only for new ones |
| `DISK_BUDGET_GB` | 20 | Past this, the least recently built clones in `/work` are deleted |
| `SURVIVING_BUDGET_SECONDS` | 60 | How long one count of a person's Surviving Lines may take at first. A count past it is queued again with twice the budget, up to four hours, and goes on from the files it counted; it reuses the Build's full clone when it is still there |
| `PULLS_TIME_LIMIT_SECONDS` | 1800 | How long one read of a repository's pull requests may take; a first read past it goes on from where it stopped in the next one, queued a minute later |
| `GIT_DATA` | true | After a Build's Report is published, read the repository's branches, files and pull requests from the kept clone with git, for the Code, Branches and Pull requests screens. They cost no GitHub request; each step fails on its own and leaves the Report published |
| `GIT_TIME_LIMIT_SECONDS` | 300 | How long all of it may take; branches get up to a fifth, files up to four fifths of what is left, pull requests the rest. A Build's job limit grows by this |
| `GIT_BRANCHES_MAX`, `GIT_TAGS_MAX`, `GIT_BRANCH_DETAILS` | 300, 200, 120 | Branches kept (newest tips first), tags kept besides every tag named like a version, and unmerged branches whose commits and files against their parent are kept |
| `GIT_FILE_MAX_KB` | 256 | A text file over this is listed but its text is not shown |
| `GIT_WARM_FILES`, `GIT_REPO_MAX_MB` | 500, 48 | For a private repository only: the files whose text is uploaded ahead (READMEs, then the files changed most often), up to this many and this much in all. The Site reads any other file's text from GitHub the first time someone opens it, with the repository's installation token or the viewer's own, and keeps it in R2; a public repository's comes from raw.githubusercontent.com, which spends no API allowance, so none is uploaded |
| `GIT_PULLS_OPEN_MAX`, `GIT_PULLS_OTHER_MAX`, `GIT_PULL_DIFF_KB`, `GIT_PULLS_MAX_MB` | 150, 100, 200, 40 | Open pull requests kept, the most recently updated others, each one's diff, and all diffs of a repository |
| `SEED_LANGUAGES`, `SEED_PER_LANGUAGE`, `SEED_BUDGET` | 9 languages, 10, 50 | The nightly Leaderboard Builds |

Deploy it. It applies the database migrations, then logs `builder working`.
The Builder runs git itself and no longer needs the `gh` CLI. When this
release replaces an older Builder, Builds waiting in the old queues are
sent again by the Builder's reaper within five minutes.

In Schedules, add two jobs for this application:

| Cron | Command | What it does |
|---|---|---|
| `*/15 * * * *` | `node builder.mjs cleanup` | Deletes expired Shared Reports, old rate-limit counts, expired GitHub answers, ended sessions, and Connected Repositories' Reports unseen for 30 days |
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
GITHUB_APP_INSTALLATION_ID=...   # the same installation as the Builder's
TOKEN_SECRET=...                 # openssl rand -hex 32, the same on the Builder: seals the token a signed-in person lends to the Build they asked for
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
