# Deploying commitscape

commitscape runs as three applications, a Postgres database, an R2 bucket and
a static landing page. In Dokploy you create the database and the three
applications from the images CI publishes to GitHub's container registry, so
your servers never build anything; the landing page goes on a Cloudflare Worker.

![Who talks to whom](./docs/diagrams/system.svg)

| Piece | What it does | Who reaches it |
|---|---|---|
| `site` | The website, its API, Cards, Shared Reports, GitHub's webhooks and the MCP server, on port 3000 | Anyone, through your domain |
| `engine` | The engine service: answers the Site's questions about a repository from its pack, on port 4100 | The Site only, over the private network |
| `builder` | Takes Builds from the queue, clones the repository, runs `commitscape build`, loads the Stored Index into Postgres and uploads the pack to R2 | Nobody: it reaches out to Postgres, R2 and GitHub |
| `postgres` | Repositories, Stored Indexes, Builds, Profiles, sign-ins and the Build queue (pg-boss) | The Site and the Builder, over the private network |
| R2 bucket | Packs, file text, pull request diffs, the Universe's Atlas, Cards and Shared Reports | The three applications |
| Landing page | The static page signed-out visitors land on, on a Cloudflare Worker | Anyone |

| Image | Tags |
|---|---|
| `ghcr.io/pixelactstudio/commitscape-site` | `main` (every merge), `latest` and `vX.Y.Z` (every release), `sha-<commit>` |
| `ghcr.io/pixelactstudio/commitscape-builder` | the same |
| `ghcr.io/pixelactstudio/commitscape-engine` | the same |

Use `latest` to move on releases (and to deploy them automatically, see
"Deploying each release"), or `main` to follow every merge. GitHub makes a
new container package private: after CI first pushes each image, open it
under the organisation's Packages, then Package settings, and change its
visibility to Public. Every image reads every setting from its environment
at run time, so the same image runs on any server.

## One server or two

Everything can run on one server, in one Dokploy project, where the
applications reach each other over Dokploy's internal network by their
names.

When it outgrows one server, move the Builder to a second one and keep the
rest together:

- **The Builder apart.** A Build's line pass takes every core it is allowed,
  and a cold clone takes disk and network. On a shared server
  `COMMITSCAPE_THREADS` and `ENGINE_NICE` keep it from slowing pages down;
  apart, it cannot.
- **The engine service beside the Site.** The Site asks it for nearly every
  screen, so it should be one hop away, and Postgres beside both.
- **A private network between them.** Your provider's private network, or
  WireGuard or Tailscale. Publish Postgres's port only on that network and
  allow only the Builder's server to reach it; never open it to the
  internet. The engine service never needs a public port either.

In Dokploy, add the second server under Settings, Remote Servers, as a
deployment server, then create the `builder` application on it. Its
`DATABASE_URL` uses the first server's private address and the port you
published for Postgres. Everything else is as below.

## 1. The R2 bucket

In Cloudflare, create a bucket (for example `commitscape`), with the
location hint nearest your servers, and an R2 API token with "Object Read &
Write" on it. Keep these four values:

| Value | Variable |
|---|---|
| `https://<account id>.r2.cloudflarestorage.com` | `S3_ENDPOINT` |
| The bucket's name | `S3_BUCKET` |
| The token's Access Key ID | `S3_ACCESS_KEY_ID` |
| The token's Secret Access Key | `S3_SECRET_ACCESS_KEY` |

The bucket stays private, with no public access and no custom domain. The
Site serves what is in it through its own routes, which check who may read
what.

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

Without the App nobody can sign in, and the Site shows only Cards and
Shared Reports.

## 3. Postgres

In the project, create a Postgres database. Deploy it, then copy its
internal connection URL from the database's page: the Site and the Builder
use it as `DATABASE_URL`. Turn on its scheduled backups to an S3
destination; the R2 bucket and this database hold everything the Site
keeps.

Each repository's history is kept here as its Stored Index, for the lookups
SQL does well (Commits pages, branches, pull requests): about 30 MB for a
repository the size of facebook/react, indexes included
([ADR-0027](./docs/adr/0027-the-index-is-kept-in-postgres.md),
[ADR-0028](./docs/adr/0028-the-engine-service-answers-from-immutable-packs.md)).
A migration turns on the `btree_gin` extension when the database allows it,
for a faster lookup of a file's commits; without it the Site still works.
The Builder applies every migration when it starts.

## 4. The Builder

Create an application named `builder` (on the second server, if you use
one):

| Setting | Value |
|---|---|
| Provider | Docker, image `ghcr.io/pixelactstudio/commitscape-builder:latest` |
| Registry | None: the image is public |

In Advanced, Volumes, add a volume named `commitscape-builder-work` with
mount path `/work`. It keeps clones and the engine's caches between Builds,
so the next Build of a repository only fetches and reads what is new. A
cold Build clones twice at once (a quick clone without old file contents,
and the full clone), so leave room for both: several GB for a repository
the size of torvalds/linux.

Environment:

```sh
DATABASE_URL=<the internal connection URL, or the private address from the first server>
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
S3_BUCKET=commitscape
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
GITHUB_APP_ID=...                # for private repositories, and the Site's own token
GITHUB_APP_PRIVATE_KEY="..."
GITHUB_APP_INSTALLATION_ID=...   # the Site's own installation, public repositories only
GITHUB_TOKEN=...                 # optional fallback: a token with no scopes, used when the installation's token is missing or refused
TOKEN_SECRET=...                 # the same as the Site's: openssl rand -hex 32
SENTRY_DSN=...                   # optional: errors, a trace per Build continued from the Site's request, logs, metrics, and cron monitors for the reaper and the disk sweep
POSTHOG_KEY=phc_...              # optional: Build events (started, quick published, done, failed)
```

`TOKEN_SECRET` unlocks the token a signed-in person lends to the Build they
asked for, and keys the code PostHog knows that person by (an HMAC of their
account id), so PostHog never sees the account itself. Without it Builds
use only the App's tokens, and their events are sent under the repository.

Optional, with their defaults:

| Variable | Default | What |
|---|---|---|
| `CONCURRENCY` | 1 | Builds at a time, for repositories under `LARGE_REPOSITORY_MB`. Their clones, GitHub reads and Postgres loads overlap; their runs of the engine share `ENGINE_SLOTS` |
| `ENGINE_SLOTS` | 1 | Runs of the engine at once across every Build, small and large; the rest wait their turn. Surviving Lines has its own. With one slot, let the engine use every core (leave `COMMITSCAPE_THREADS` unset) |
| `COMMITSCAPE_THREADS` | every core, up to 16 | Threads one run of the engine may use |
| `ENGINE_NICE` | 10 | The engine runs at this lower priority (0 to 19), so git, the database and the Builder stay responsive |
| `LINES_BUDGET_SECONDS` | 120 | How long a Build's line pass may count Lines Changed, the Mainline first, newest first. Lines show once the Mainline's are counted; the commits left are counted by a quiet Build queued a minute later (three at most), and by the next Build |
| `MORE_LINES_BUDGET_SECONDS` | 600 | How long such a quiet Build may count, kept two minutes inside `TIME_LIMIT_SECONDS`: nobody waits for it, so it counts what is left in one go and publishes once |
| `ATLAS_QUALITY` | 5 | The brotli quality the Builder packs each pack's Universe Atlas with, 1 to 11. On linux 5 takes 4.8 CPU-s for a 7.8 MB map and 11 takes 35 CPU-s for 6.6 MB; the Atlas is made once per pack, in a process of its own that waits for an engine slot |
| `LARGE_REPOSITORY_MB` | 1500 | Repositories larger than this, by GitHub's size, are built in a lane of their own |
| `LARGE_CONCURRENCY` | 1 | Builds at a time in that lane |
| `MAX_REPOSITORY_MB` | none | Unset, every repository is cloned, however big; set, larger repositories are refused |
| `TIME_LIMIT_SECONDS` | 900 | How long one run of the binary may take on a Build's first attempt, the clone not included. One that runs out is queued again, each attempt given twice the time, four attempts in all |
| `CLONE_TIME_LIMIT_SECONDS` | 1800 | How long a clone or fetch may take on the first attempt, doubled with each attempt |
| `LOGINS_ASKED` | 300 | At most this many commit authors a Build asks GitHub for the login of, a hundred to a GraphQL request; each commit's answer is kept for a year, so a rebuild asks only for new ones |
| `DISK_BUDGET_GB` | 20 | Past this, the least recently built clones in `/work/repos` are deleted. A repository whose lines and Surviving Lines are all counted keeps a lean clone (blobless, no files written out: linux 2.4 GB, react 62 MB) instead of a full one (6.6 GB, 1.1 GB) |
| `CACHE_BUDGET_GB` | 5 | Past this, the least recently used caches in `/work/caches` are deleted. A cache holds what a Build read of a repository's history (linux: about 240 MB, react: 11 MB) and lives apart from its clone, so deleting a clone never makes the next Build read the history again |
| `STATE_KEY` | unset | A secret of 32 characters or more that only the Builder holds. Set, every public repository's Repo State (its engine cache) is also kept in R2 under `state/`, sealed with a key made from it (AES-256-GCM, zstd), uploading only the chunks R2 does not hold yet; a Build whose disk lost the State brings it back instead of reading the whole history again. Unset, States live on the disk only, as before. Keep it: a new key makes every State in R2 unreadable, and those Builds start clean |
| `STATE_DISK_DAYS` | 7 | With `STATE_KEY` set, a State unused for this many days leaves the disk even within `CACHE_BUDGET_GB` (R2 still holds it) |
| `STATE_KEEP_DAYS` | 180 | With `STATE_KEY` set, a State no Build has used for this many days is deleted from R2, checked once a day |
| `SURVIVING_BUDGET_SECONDS` | 60 | How long one count of everyone's Surviving Lines may spend working out the head's Ownership of lines at first. A count past it keeps what it did and is queued again with twice the budget, up to four hours, going on from there. Each new Report queues one, after its full publish |
| `PULLS_TIME_LIMIT_SECONDS` | 1800 | How long one read of a repository's pull requests may take; a first read past it goes on from where it stopped a minute later |
| `GIT_DATA` | true | Once a Build's full clone is ready, read the repository's branches, files and pull requests from it with git, beside the line pass, for the Code, Branches and Pull requests screens. They cost no GitHub request; each step fails on its own and leaves the Report published |
| `GIT_TIME_LIMIT_SECONDS` | 300 | How long all of it may take; branches get up to a fifth, files up to four fifths of what is left, pull requests the rest. A Build's job limit grows by this |
| `GIT_BRANCHES_MAX`, `GIT_TAGS_MAX`, `GIT_BRANCH_DETAILS` | 300, 200, 120 | Branches kept (newest tips first), tags kept besides every tag named like a version, and unmerged branches whose commits and files against their parent are kept |
| `GIT_FILE_MAX_KB` | 256 | A text file over this is listed but its text is not shown |
| `GIT_WARM_FILES`, `GIT_REPO_MAX_MB` | 500, 48 | For a private repository only: the files whose text is uploaded ahead (READMEs, then the files changed most often), up to this many and this much in all. The Site reads any other file's text from GitHub the first time someone opens it and keeps it in R2; a public repository's comes from raw.githubusercontent.com, which spends no API allowance, so none is uploaded |
| `GIT_PULLS_OPEN_MAX`, `GIT_PULLS_OTHER_MAX`, `GIT_PULL_DIFF_KB`, `GIT_PULLS_MAX_MB` | 150, 100, 200, 40 | Open pull requests kept, the most recently updated others, each one's diff, and all diffs of a repository |
| `SEED_LANGUAGES`, `SEED_PER_LANGUAGE`, `SEED_BUDGET` | 9 languages, 10, 50 | The nightly seed Builds: the most starred repositories in each language, and how many to queue in a night |
| `GITHUB_API` | https://api.github.com | GitHub's API, for a fake one in tests |
| `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | production, 1 | Sentry's environment, and the share of Builds traced |
| `POSTHOG_HOST` | https://us.i.posthog.com | Where PostHog events go |

The image sets `WORK_DIR=/work`, `MIGRATIONS_DIR` and `COMMITSCAPE_BIN`
itself. Deploy it: it applies the database migrations, then logs
`builder working`.

In Schedules, add two jobs for this application:

| Cron | Command | What it does |
|---|---|---|
| `*/15 * * * *` | `node builder.mjs cleanup` | Deletes expired Shared Reports, old rate-limit counts, expired GitHub answers, ended sessions, and Connected Repositories' Reports unseen for 30 days |
| `0 3 * * *` | `node builder.mjs seed` | Queues the night's seed Builds: a seed whose Report is whole is queued only when its head moved (asked of GitHub's GraphQL API, a hundred repositories to a request) and someone viewed it since its last Build, or when its Report is a week old |

`node builder.mjs rebuild` queues a Build, at the lowest priority, for every
repository whose live Stored Index has no pack. Run it once after upgrading
from a release without the engine service (see "Upgrading" below), in the
application's terminal or as a one-off schedule.

## 5. The engine service

Create an application named `engine`, on the same server as the Site:

| Setting | Value |
|---|---|
| Provider | Docker, image `ghcr.io/pixelactstudio/commitscape-engine:latest` |
| Registry | None: the image is public |

Give it no domain: only the Site asks it anything, over Dokploy's internal
network, on port 4100, with a shared token. In Advanced, Volumes, add a
volume named `commitscape-engine-packs` with mount path `/data/packs`: the
packs it fetches from R2 are kept there, so a restart does not fetch them
again.

Environment:

```sh
ENGINE_TOKEN=...                 # openssl rand -hex 32; the Site sends the same
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
S3_BUCKET=commitscape
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
SENTRY_DSN=...                   # optional: its errors, and a transaction per request in the trace of the Site's request
```

Optional, with their defaults:

| Variable | Default | What |
|---|---|---|
| `PACK_DISK_GB` | 10 | Packs kept on the volume; past this, the least recently used are deleted. Fractions are allowed |
| `PACK_MEMORY_MB` | 512 | Packs kept decoded in memory, the least recently used first to go (facebook/react's is about 17 MB). Its answers are kept besides, up to 128 MB |
| `COMMITSCAPE_THREADS` | every core, up to 16 | Threads working out answers, and answers worked out at once |
| `PORT` | 4100 | The port it listens on |
| `PACK_DIR` | `/data/packs` | Where packs are kept on disk |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | auto, false | For an S3 store other than R2 |
| `PACK_SOURCE` | `s3` | `dir:<path>` copies packs from a folder instead, for development |
| `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | production, 1 | Sentry's environment, and the share of requests traced |
| `RUST_LOG` | info | How much it logs, to stderr |

The image has a health check (`commitscape-engine health`, which asks
`/healthz`). Deploy it before the Site: the Site does not start without
`ENGINE_URL` and `ENGINE_TOKEN`.

## 6. The Site

Create an application named `site`:

| Setting | Value |
|---|---|
| Provider | Docker, image `ghcr.io/pixelactstudio/commitscape-site:latest` |
| Registry | None: the image is public |

Environment:

```sh
DATABASE_URL=<the internal connection URL>
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
S3_BUCKET=commitscape
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
ENGINE_URL=http://<the engine application's name on Dokploy's network>:4100
ENGINE_TOKEN=...                 # the engine's
BETTER_AUTH_URL=https://example.com
BETTER_AUTH_SECRET=...           # openssl rand -hex 32
GITHUB_APP_ID=...
GITHUB_APP_SLUG=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_PRIVATE_KEY="..."
GITHUB_WEBHOOK_SECRET=...
GITHUB_APP_INSTALLATION_ID=...   # the same installation as the Builder's
GITHUB_TOKEN=...                 # optional fallback for the installation's token: a token with no scopes
TOKEN_SECRET=...                 # openssl rand -hex 32, the same on the Builder
MCP_TOKEN=...                    # optional, 32 characters or more: turns on /mcp for clients that send it
SENTRY_DSN=...                   # optional: the server's errors and traces
```

`TOKEN_SECRET` seals the token a signed-in person lends to the Build they
asked for, and keys the code PostHog counts them under; without it, the
Site's PostHog events carry a fresh id each time. `MCP_TOKEN` unset, `/mcp`
answers 404; set, it answers only requests that send
`authorization: Bearer <MCP_TOKEN>`, and only reads.

Browser settings are read at run time too, and the server writes them into
the page:

```sh
PUBLIC_LANDING_URL=https://example.org   # optional: where / sends people who are signed out; else to /sign-in
PUBLIC_SENTRY_DSN=...                    # optional: the browser's errors
PUBLIC_POSTHOG_KEY=phc_...               # optional: usage data from the browser, the server and the command
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

What is collected, from whom, is `packages/data/src/analytics.ts`, shared with the landing page:
each feature, and for each region of countries what runs before the visitor
chooses (`before`) and what Only basic and Allow all turn on. The privacy
page is drawn from it. The browser sends PostHog's events to the Site's own
`/ingest`, which passes them on to `PUBLIC_POSTHOG_HOST` without cookies or
sign-in, and with as much of the visitor's address as their level allows:
all of it at Allow all, the first three parts at basic. A browser that sends
`DNT` or `Sec-GPC` starts at basic. The region comes from Cloudflare's
`cf-ipcountry`; without it, a visitor is in the region that asks first.

In PostHog's project settings, turn on cookieless server hash mode (basic
counting is dropped without it), session replay with canvas recording,
console logs and network capture, heatmaps, Web Vitals, and set recordings
to be kept for 30 days, as the privacy page says. Turn exception
autocapture off: Sentry has errors.

```sh
POSTHOG_PERSONAL_API_KEY=phx_...         # optional, with person:write: "Delete my data" also deletes the person in PostHog
POSTHOG_PROJECT_ID=...                   # the project the key deletes in
```

The privacy page says "Delete my data" deletes what PostHog holds about the
person, so set both wherever `PUBLIC_POSTHOG_KEY` is set.

Optional, with their defaults:

| Variable | Default | What |
|---|---|---|
| `CLIENT_IP_HEADER` | `x-forwarded-for` | Where the visitor's address is read from, for rate limits and PostHog, when there is no `cf-connecting-ip` |
| `COUNTRY_HEADER` | `cf-ipcountry` | Where the visitor's country is read from, for their analytics region |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | auto, false | For an S3 store other than R2 |
| `GITHUB_API` | https://api.github.com | GitHub's API, for a fake one in tests |
| `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` | production, 0.1 | Sentry's environment, and the share of requests traced |

In Domains, add `example.com` with container port 3000 and HTTPS on. Every
page needs a signed-in person, except the sign-in page, `/privacy`, Shared
Reports and shared Proof of Work; Cards, the webhooks, `/api/health`,
`/api/telemetry` (the command's usage counts) and `/ingest` answer anyone.

The image has a health check on `/api/health`. For deploys without
downtime, add the same check in Advanced, Swarm Settings, with the update
order "start-first".

Deploy it after the Builder, so the tables exist, and after the engine
service.

## 7. The landing page

`apps/landing` is drawn to static HTML at build time and served by a small
Cloudflare Worker (`apps/landing/wrangler.jsonc`, `apps/landing/worker/`):
every file comes straight from the Worker's static assets, and the Worker
runs only for the page itself, to write in the visitor's analytics region
and choice, and for `/ingest/*`, which passes PostHog's requests on the
same way the Site's `/ingest` does. Without `POSTHOG_KEY` it serves the
page as it is.

Create it from this repository (Workers & Pages, Create, Import a
repository), with Workers Builds:

| Setting | Value |
|---|---|
| Project name | `commitscape-landing`, the `name` in `wrangler.jsonc` |
| Production branch | `main` |
| Build command | `pnpm install --frozen-lockfile --filter @commitscape/landing... && pnpm --filter @commitscape/landing build` |
| Deploy command | `pnpm --filter @commitscape/landing exec wrangler deploy` |
| Path (root directory) | `/`, the repository's root |
| Build watch paths, include | `apps/landing/*`, `packages/ui/*`, `packages/data/*`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |

Build variables:

| Variable | Value |
|---|---|
| `NODE_VERSION` | `24` |
| `PNPM_VERSION` | `12.6.0` |
| `SKIP_DEPENDENCY_INSTALL` | `1`, so the build leaves the install to the build command |
| `PUBLIC_APP_URL` | The Site's address, like `https://example.com`: where "Sign in", "Open the app", the lookup, the examples and the hero's Cards go |
| `PUBLIC_LANDING_URL` | The page's own address, like `https://example.org`: its canonical link, Open Graph image, `robots.txt` and sitemap |

Both `PUBLIC_*` values default to the project's own addresses and are read
at build time, so after changing one, retry the latest build.

The Worker's own variables (Settings, Variables and Secrets; `keep_vars`
keeps them across deploys):

| Variable | Value |
|---|---|
| `POSTHOG_KEY` | The same project key as the Site's `PUBLIC_POSTHOG_KEY`; unset, the page sends nothing |
| `POSTHOG_HOST` | Optional, `https://us.i.posthog.com` by default |

In the Worker's Settings, Domains & Routes, add the page's address as a
custom domain. Then set the Site's `PUBLIC_LANDING_URL` to it: signed-out
visitors to the Site's `/` go there, and a visitor's analytics choice is
kept for both when they share a parent domain (`commitscape.com` and
`app.commitscape.com`). `apps/landing/public/og.png` is the preview image
shared links show; for your own address, save the Site's
`https://example.com/api/cards/site/preview.png` over it.

## 8. Cloudflare in front of the Site

Optional, and free. With the domain's DNS on Cloudflare and the Site's
record proxied, the Site reads the visitor's address from
`cf-connecting-ip`. Useful settings on the free plan:

- **Cache rules** for `/api/cards/*` and `/api/work/s/*` (shared Proof of
  Work files): eligible for cache, edge TTL from the origin's
  `cache-control`. Cards say how long they keep; Shared Reports answer
  `no-store` and are never cached.
- **Block AI bots**, under Security, Settings.
- **Bot Fight Mode** cannot be skipped for a path on the free plan; if you
  turn it on, check that README Cards still load, since GitHub fetches them
  through its image proxy.

## Deploying each release

When a release is made, the Docker images workflow pushes `latest` and
`vX.Y.Z` and then calls a Dokploy deploy webhook for each application, in
this order: Builder, engine service, Site. In each application's
Deployments tab in Dokploy, copy its webhook URL into this repository's
secrets on GitHub:

| Secret | Application |
|---|---|
| `DOKPLOY_BUILDER_WEBHOOK` | `builder` |
| `DOKPLOY_ENGINE_WEBHOOK` | `engine` |
| `DOKPLOY_SITE_WEBHOOK` | `site` |

An application whose secret is not set is skipped with a notice. The
applications must use the `latest` tag for the webhook to bring the new
release.

## Upgrading to the engine service

The release that adds the engine service changes what each application
needs. In this order:

1. Create the `engine` application (section 5) and deploy it.
2. Deploy the Builder. Its migrations drop the daily summary tables, the
   Races, Crews, Rivals and Season tables and the repository columns only
   the Leaderboards read, and add the columns for packs and the Report's
   meta.
3. On the Site, add `ENGINE_URL` and `ENGINE_TOKEN`, and if you want them
   `PUBLIC_LANDING_URL` and `MCP_TOKEN` (`/mcp` is off without it). Remove
   `BOARDS_CACHE_SECONDS`, which nothing reads. Deploy it.
4. Run `node builder.mjs rebuild` once. Until a repository's Build is done
   it shows the Report stored for it before, and its Code window, history
   and Universe say they are read at the next Build.
5. Set up the landing page (section 7).

## Upgrading to the Repo State

The release that keeps each repository's Repo State (ADR-0030) deploys in
the usual order, and works without new settings. In this order:

1. Deploy the Builder. Its migrations add `repositories.checked_at` and
   the `repo_states` table. From then on it ends a Build early when the
   head has not moved, makes each pack's Atlas itself, counts everyone's
   Surviving Lines once per new Report, and moves a repository to a lean
   clone once its lines and Surviving Lines are counted. The first Build of
   each repository makes its commit graph once (linux: 2.6 s).
2. To keep Repo States in R2 as well, set `STATE_KEY` on the Builder (a
   secret of 32 characters or more, kept only there, never changed after)
   before or with this deploy. Without it the States live on its disk only.
3. Deploy the engine service: it adds `/v1/commits/search` and matches
   words in `/v1/commits/under`.
4. Deploy the Site: it searches the Commit List's words through the engine
   service, counts a Report found unchanged as current, and no longer
   serves `git/log.json`.
5. Seeds' Surviving Lines rows of older Reports stay; each repository's
   next Report gets everyone's. The first count of a large repository
   (linux: about 45 minutes of both cores, in budgeted runs) shows
   "counting" until it is whole.

## Moving to a new R2 bucket

A bucket's location cannot change, so moving to another location is a new
bucket and a copy. Object keys stay the same, so nothing else changes, and
the engine service's disk copies stay valid.

1. Create the new bucket and give the R2 token access to it as well.
2. Copy every object from the old bucket into the new one: with Cloudflare's
   Super Slurper (R2, Data Migration, with the old bucket as an S3-compatible
   source), or with rclone and the same keys:
   `rclone copy r2:<old bucket> r2:<new bucket> --transfers 32`.
3. Set `S3_BUCKET` to the new bucket on the Builder, the engine service and
   the Site, and deploy them.
4. Copy again: rclone copies only what is missing, which catches anything
   written to the old bucket between the first copy and the switch.
5. Once everything reads well for a few days, empty and delete the old
   bucket.

## Check it

1. Open `https://example.com/` signed out: it sends you to the landing page,
   or to `/sign-in` without one. Sign in with GitHub.
2. Open `https://example.com/gh/BurntSushi/ripgrep`. GitHub's facts show at
   once and the Report follows within a minute; the Builder's logs show the
   Build, and the Code window and Universe answer once it is done.
3. In any repository, run
   `COMMITSCAPE_SITE=https://example.com npx commitscape share --yes` and
   open the link it prints in a browser where you are signed out.
4. Install the App on a private repository and open it from `/me`.
5. With `MCP_TOKEN` set, point an MCP client at `https://example.com/mcp`
   with that token and call `lookup_repository`.

To have `commitscape share` upload to your Site without `COMMITSCAPE_SITE`,
set `DEFAULT_SITE` in `crates/commitscape/src/share.rs` before building the
CLI.
