# Deploying the Site and the Builder

How to run commitscape's hosted side for real, from nothing. The
commitscape command itself needs none of this: it works on its own machine.

There are three parts, and they talk to each other like this:

```
 Browser ─► the Site: a Worker on Cloudflare's free plan, with D1 and R2
               │  ▲
     a Build   │  │  the Report, uploaded (every request signed with BUILDER_SECRET)
               ▼  │
            the Builder: Node on a small server, running the commitscape binary

 GitHub ◄─► the Site: facts about public repositories, signing in, the App's webhooks
```

- **The Site** (`apps/site`) serves the pages as static files and answers
  `/api/*` with a Worker. It keeps its data in D1 (a SQLite database) and
  Reports in R2 (file storage). Everything fits Cloudflare's free plan
  (ADR-0014).
- **The Builder** (`apps/builder`) takes one Build at a time from the Site,
  clones the repository, runs `commitscape report --data`, and uploads the
  Report to the Site. It needs a real server with git and some disk
  (ADR-0015).
- **The GitHub App** lets people sign in and choose private repositories.
  It can only read (ADR-0017).

Do the steps in order. Where a step says "your domain", this document uses
`example.com`; the Site is `https://example.com` and the Builder is
`https://builder.example.com`. Nothing here costs money except the domain
and the server.

Every command below runs in the repository's root, unless it says
otherwise, after:

```sh
corepack enable        # pnpm's version is pinned in package.json
pnpm install
```

## 1. Choose the name and the Site's address

The product name and the Site's origin each live in one place,
`packages/data/src/product.ts`:

```ts
export const PRODUCT = "commitscape";
export const SITE_ORIGIN = "https://commitscape.invalid";
```

Set `SITE_ORIGIN` to your domain, `https://example.com`, before building
anything below. The commitscape binary reads it when it is built: it is
where `commitscape share` uploads. (Anyone can point a binary somewhere else
with `COMMITSCAPE_SITE=https://example.com`.)

## 2. Secrets

Make three random secrets now and keep them in a password manager. Each is
64 hexadecimal characters:

```sh
openssl rand -hex 32    # BUILDER_SECRET: the Site and the Builder sign every request to each other with it
openssl rand -hex 32    # SESSION_KEY: locks GitHub tokens kept in D1
openssl rand -hex 32    # GITHUB_WEBHOOK_SECRET: GitHub signs its webhooks with it
```

And one GitHub token, **GITHUB_TOKEN**, which lets the Site and the Builder
ask GitHub's API 5,000 times an hour instead of 60. Make it on GitHub under
Settings → Developer settings → Personal access tokens → Fine-grained
tokens:

- Resource owner: your account.
- Repository access: **Public repositories (read-only)**.
- Permissions: none.
- Expiration: a year; put a reminder in your calendar to replace it.

It can read only what anyone can read. Without it the Site still works, but
GitHub's facts about repositories stop after 60 lookups an hour.

## 3. The GitHub App

On GitHub: Settings → Developer settings → GitHub Apps → New GitHub App.
(For an organisation, the same under the organisation's settings.)

| Field | Value |
|---|---|
| GitHub App name | The product's name, for example `commitscape`. Its URL name (the "slug", as in `github.com/apps/<slug>`) becomes `GITHUB_APP_SLUG` |
| Homepage URL | `https://example.com` |
| Callback URL | `https://example.com/api/auth/callback` |
| Expire user authorization tokens | **On** (the Site refreshes them) |
| Request user authorization (OAuth) during installation | **Off**: people sign in first, then install |
| Enable Device Flow | Off |
| Setup URL | `https://example.com/me`, with "Redirect on update" **on** |
| Webhook: Active | **On** |
| Webhook URL | `https://example.com/api/github/webhooks` |
| Webhook secret | `GITHUB_WEBHOOK_SECRET` from step 2 |
| Where can this GitHub App be installed? | Any account |

**Permissions**, under "Repository permissions", every one **Read-only**:

| Permission | Why |
|---|---|
| Metadata | Required by GitHub for every App |
| Contents | To clone the repository for its Build |
| Pull requests | The Report's pull requests and reviews |
| Issues | The Report's issues and how fast they are answered |

No account or organisation permissions, and nothing with write access.

**Events.** GitHub always sends an App its `installation` and
`installation_repositories` events; those are the two the Site acts on
(removing the App from a repository deletes its Report). If the form lists
them as boxes, tick them. Subscribe to nothing else.

Create the App, then on its page:

1. Note the **App ID** (a number): `GITHUB_APP_ID`.
2. Note the **Client ID** (starts `Iv`): `GITHUB_APP_CLIENT_ID`.
3. "Generate a new client secret": `GITHUB_APP_CLIENT_SECRET`. It is shown
   once.
4. "Generate a private key": a `.pem` file downloads. This is
   `GITHUB_APP_PRIVATE_KEY`. GitHub writes it as PKCS#1 (`-----BEGIN RSA
   PRIVATE KEY-----`); the Site converts it itself, so don't convert it.
   Keep the file somewhere safe and delete the downloaded copy after step 4.

## 4. The Site, on Cloudflare

You need a Cloudflare account (the free plan) with your domain added to it
(Websites → Add a domain, then change the nameservers where you bought the
domain).

Sign Wrangler, Cloudflare's command, in to it:

```sh
cd apps/site
pnpm exec wrangler login
```

**The database and the storage.**

```sh
pnpm exec wrangler d1 create commitscape
pnpm exec wrangler r2 bucket create commitscape-reports
```

`d1 create` prints a `database_id`. Put it in `apps/site/wrangler.jsonc`,
in place of `00000000-0000-0000-0000-000000000000`. Then make the tables:

```sh
pnpm exec wrangler d1 migrations apply commitscape --remote
```

Optional backstop: in the Cloudflare dashboard, R2 → `commitscape-reports`
→ Settings → Object lifecycle rules, add a rule that deletes objects with
the prefix `shares/` after 1 day. The Site already deletes expired Shared
Reports every 15 minutes; this only catches anything it missed.

**Settings that are not secret.** In `apps/site/wrangler.jsonc`, under
`vars`:

```jsonc
"BUILDER_URL": "https://builder.example.com",
"GITHUB_APP_ID": "123456",
"GITHUB_APP_CLIENT_ID": "Iv23li…",
"GITHUB_APP_SLUG": "commitscape"
```

Leave `GITHUB_API` and `GITHUB_OAUTH` as they are.

**Secrets.** Each command asks for the value (the first may ask whether
to create the Worker: yes):

```sh
pnpm exec wrangler secret put BUILDER_SECRET
pnpm exec wrangler secret put SESSION_KEY
pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler secret put GITHUB_WEBHOOK_SECRET
pnpm exec wrangler secret put GITHUB_APP_CLIENT_SECRET
base64 -w0 ~/Downloads/your-app.private-key.pem | pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY
```

The private key goes in as one line of base64 (on macOS, `base64 -i
your-app.private-key.pem`); the Site also reads the PEM as it is, where a
secret can hold several lines.

**Build and deploy.**

```sh
pnpm build                         # from the root: every package, the Site among them
cd apps/site
pnpm exec wrangler deploy
```

Wrangler deploys what `pnpm build` wrote (the Cloudflare Vite plugin
points it there). Then in the dashboard, Workers & Pages →
`commitscape-site` → Settings → Domains & Routes → Add → Custom domain:
`example.com`.

The Cron Trigger (every 15 minutes: expired Shared Reports, old sessions,
Reports of Connected Repositories unseen for 30 days, the Leaderboards once
a day) comes with the deploy, from `wrangler.jsonc`.

The Site works now, before the Builder exists: GitHub's facts show at once,
and Builds say "Builds are paused".

## 5. The Builder, on a server

Any small Linux server works. Two CPUs, 4 GB of memory and 40 GB of disk
build a repository the size of facebook/react in about 25 seconds from
nothing, with room for the clones. These steps are for Ubuntu 24.04 or
Debian 12; run them as root.

**Software.**

```sh
apt update && apt install -y git curl fonts-dejavu-core caddy
# Node 24, from NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs
# The GitHub CLI, which `commitscape health` asks GitHub through (for the Leaderboards)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
apt update && apt install -y gh
```

(If Caddy isn't in your distribution's packages, its site,
caddyserver.com, has the one-line install.)

**The commitscape binary.** From a release, for the server's platform
(`commitscape-linux-x64-gnu.tar.gz` on most servers,
`commitscape-linux-arm64.tar.gz` on ARM), or built on your own machine with
`cargo build --release` after step 1:

```sh
tar -xzf commitscape-linux-x64-gnu.tar.gz
install -m 755 commitscape /usr/local/bin/commitscape
commitscape --version
```

**The Builder.** On your own machine, build it and copy it over:

```sh
pnpm --filter @commitscape/builder build     # writes apps/builder/dist/builder.mjs
scp apps/builder/dist/builder.mjs root@builder.example.com:/opt/commitscape-builder/
```

On the server:

```sh
useradd --system --home /var/lib/commitscape-builder --create-home commitscape
mkdir -p /opt/commitscape-builder && cd /opt/commitscape-builder
npm install @resvg/resvg-js@2.6.2    # draws cards as PNGs for social previews; without it they stay SVG
```

**Its settings,** in `/etc/commitscape-builder.env`, readable only by root:

```sh
# The same two values as the Site's.
BUILDER_SECRET=0123…
GITHUB_TOKEN=github_pat_…
SITE_URL=https://example.com
COMMITSCAPE_BIN=/usr/local/bin/commitscape
WORK_DIR=/var/lib/commitscape-builder/work
HOME=/var/lib/commitscape-builder
```

```sh
chmod 600 /etc/commitscape-builder.env
```

Every other setting has a default that suits this server:

| Setting | Default | What |
|---|---|---|
| `PORT`, `HOST` | `8788`, `127.0.0.1` | Where it listens: only this machine; Caddy is in front |
| `CONCURRENCY` | `1` | Builds at a time |
| `FULL_CLONE_UP_TO_MB` | `100` | Up to this size (as GitHub counts it), a full clone with lines counted; above, a partial clone without |
| `MAX_REPOSITORY_MB` | `3000` | Bigger repositories are refused, and say so |
| `TIME_LIMIT_SECONDS` | `900` | A Build is stopped after this long |
| `DISK_BUDGET_GB` | `20` | Past this, the clones built longest ago are deleted |
| `SEED_HOUR` | `3` | The hour (UTC) of the Leaderboards' nightly Builds; `off` for never |
| `SEED_LANGUAGES` | `JavaScript,TypeScript,Python,Go,Rust,Java,C,C++,Ruby` | The languages GitHub's search is asked about |
| `SEED_PER_LANGUAGE` | `10` | The most starred repositories taken from each |
| `SEED_BUDGET` | `50` | Builds a night at most: those never built first, then the oldest |

`GITHUB_TOKEN` is used for GitHub's search (the Leaderboards' seed list)
and by `gh` inside `commitscape health`. Builds of public repositories
don't use it; a private repository's Build gets its own one-hour token
from the Site, which is never written down.

**The service,** `/etc/systemd/system/commitscape-builder.service`:

```ini
[Unit]
Description=commitscape Builder
After=network-online.target
Wants=network-online.target

[Service]
User=commitscape
EnvironmentFile=/etc/commitscape-builder.env
WorkingDirectory=/opt/commitscape-builder
ExecStart=/usr/bin/node /opt/commitscape-builder/builder.mjs
Restart=always
RestartSec=5
# It needs only its own folder.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/commitscape-builder

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload
systemctl enable --now commitscape-builder
journalctl -u commitscape-builder -f     # "builder listening on http://127.0.0.1:8788, one Build at a time"
```

**HTTPS in front.** Point `builder.example.com` at the server (a DNS A
record, in Cloudflare's dashboard; "DNS only", not proxied), then
`/etc/caddy/Caddyfile`:

```
builder.example.com {
	reverse_proxy 127.0.0.1:8788
}
```

```sh
systemctl reload caddy
curl https://builder.example.com/health   # {"ok":true,"running":0,"queued":0,…}
```

Caddy gets and renews the certificate itself. Open only ports 22, 80 and
443 on the server's firewall. The Builder refuses any Build not signed with
`BUILDER_SECRET`, so being reachable is safe.

## 6. Check it

1. `https://example.com` opens. Paste `https://github.com/BurntSushi/ripgrep`:
   its description and stars show at once, and its Report within about ten
   seconds. `journalctl -u commitscape-builder` shows the Build.
2. `https://example.com/gh/BurntSushi/ripgrep` shared in a chat shows its
   card as the preview.
3. On your own machine, with a binary built after step 1:
   `commitscape share` in any repository prints a link; it opens in a
   browser; the page's Delete button removes it.
4. "Sign in with GitHub" on the Site, then "Add repositories", choose one
   private repository: it appears under "Your repositories" and opens.
   Remove the App from it on GitHub: its Report is gone from the Site.
5. The Leaderboards: wait for the night at `SEED_HOUR`, or start one now
   from the server:

   ```sh
   cd /opt/commitscape-builder
   (set -a; . /etc/commitscape-builder.env; node builder.mjs seed)
   ```

   It only asks the running Builder, signed with `BUILDER_SECRET`, and says
   "seeding"; the Builder's log then says how many seeds GitHub's search
   gave, each Build, and when "the boards are written".
   `https://example.com/leaderboards` shows them.

## 7. Running it

- **Updating the Site:** pull, `pnpm install && pnpm build`, then in
  `apps/site` `pnpm exec wrangler d1 migrations apply commitscape --remote`
  (it applies only new migrations) and `pnpm exec wrangler deploy`.
- **Updating the Builder:** copy the new `builder.mjs` and the new binary
  over, then `systemctl restart commitscape-builder`. A Build running at
  that moment fails and can be asked for again.
- **Replacing a secret:** `wrangler secret put` it on the Site, change
  `/etc/commitscape-builder.env` if the Builder has it too, and restart the
  Builder. A new `SESSION_KEY` signs everyone out. A new `BUILDER_SECRET`
  fails Builds running at that moment.
- **When the Builder is down** the Site keeps working: pages, stored
  Reports, Shared Reports and signing in all go on, and new Builds say
  "Builds are paused".
- **Backups:** D1 keeps 7 days of history on the free plan (Time Travel:
  `wrangler d1 time-travel restore`); `wrangler d1 export commitscape
  --remote --output backup.sql` takes a copy whenever you like. Reports in R2 can be rebuilt; Shared
  Reports last hours.
- **Logs:** the Worker's in the dashboard (Workers → `commitscape-site` →
  Logs); the Builder's with `journalctl -u commitscape-builder`.
- **The free plan's limits,** for when traffic grows: 100,000 Worker
  requests a day (pages are static files and don't count), 10 ms of CPU per
  request (every handler measured under that, STATE.md), D1's 5 GB and R2's
  10 GB. Each handler's measured CPU time is in `STATE.md`.

## Trying all of it on one machine first

Everything above runs locally without any account, with local D1 and R2 and
a stand-in for GitHub; this is what the end-to-end tests do:

```sh
cargo build --release && cargo xtask fixtures --force
pnpm build
cd apps/site && pnpm e2e    # the Site under `wrangler dev`, the real Builder, a stand-in GitHub
```

To try it against the real GitHub, copy `apps/site/.dev.vars.example` to
`apps/site/.dev.vars`, fill it in, and run:

```sh
cd apps/site
pnpm exec wrangler d1 migrations apply commitscape --local
pnpm exec wrangler dev --port 8787
# in another terminal, from the root:
BUILDER_SECRET=… SITE_URL=http://127.0.0.1:8787 COMMITSCAPE_BIN=$PWD/target/release/commitscape \
  WORK_DIR=$PWD/target/builder-work SEED_HOUR=off node apps/builder/dist/builder.mjs
```
