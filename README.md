<div align="center">
  <img src="./.github/logo.svg" alt="commitscape" width="64" height="64" />
  <h1>commitscape</h1>
  <p>What you have built, how you stand next to the people you work with, and cards to share it.</p>
</div>

<p align="center">
  <a href="https://github.com/pixelactstudio/commitscape/actions/workflows/ci.yml">
    <img src="https://github.com/pixelactstudio/commitscape/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://github.com/pixelactstudio/commitscape/actions/workflows/docker.yml">
    <img src="https://github.com/pixelactstudio/commitscape/actions/workflows/docker.yml/badge.svg" alt="Docker images" />
  </a>
  <a href="#license">
    <img src="https://img.shields.io/badge/license-MIT%20or%20Apache--2.0-blue" alt="MIT or Apache-2.0 license" />
  </a>
</p>

commitscape shows a developer what they have built: pull requests merged,
reviews given, and the lines of theirs that still run, counted from each
repository's own history with blame. It shows how they stand next to the
people they work with, view by view and never by one score, and turns it
into Cards for a README, a self-review or a post. On your machine it reads
the whole history of a large repository in seconds, from git's own data.

![commitscape's own story, drawn by commitscape](.github/commitscape-card.svg)

There are three ways to use it:

1. **In your terminal.** Run `npx commitscape` in any git repository.
   Nothing leaves your machine.
2. **Shared from a terminal.** `commitscape share` builds the Report on
   your machine, encrypts it, uploads it and prints a link. The link opens
   in any browser for 4 hours, and the Site cannot read what it stores.
3. **On the Site.** Type any GitHub username for their Profile: totals,
   Surviving Lines, Archetype and Achievements, where their work is, Cards
   to embed, Proof of Work for a period, Versus, Rivals, Races, Crews and
   Wrapped. Paste a repository link for its Report and Standings, sign in
   with GitHub to see your own private work, or browse the Leaderboards.
   Anyone can stay out of comparisons.

The project is in early development. The CLI and the Site work end to end;
the first release is next.

## Getting started

```sh
npx commitscape
```

The first run reads the whole history (about 25 seconds for a repository
the size of rust-lang/rust). After that it opens in well under a second.

![The terminal interface on ripgrep](docs/media/terminal.gif)

## Install

| How | Command |
|---|---|
| npm | `npx commitscape`, `pnpm dlx commitscape`, or `npm install -g commitscape` |
| Homebrew | `brew install pixelactstudio/commitscape/commitscape` |
| winget | `winget install DevTalan.Commitscape` |
| Scoop | `scoop bucket add pixelactstudio https://github.com/pixelactstudio/scoop-bucket`, then `scoop install commitscape` |
| Arch (AUR) | `yay -S commitscape-bin` |
| Debian, Ubuntu | the `.deb` from the [latest release](https://github.com/pixelactstudio/commitscape/releases/latest): `sudo apt install ./commitscape_*_amd64.deb` |
| Fedora, RHEL | the `.rpm` from the latest release: `sudo dnf install ./commitscape-*.x86_64.rpm` |
| Cargo | `cargo install commitscape` |
| Nix | `nix run github:pixelactstudio/commitscape` |
| A binary | the archive for your platform from the latest release |

Prebuilt binaries cover Linux on x64 and ARM (glibc or musl), macOS on
Intel and Apple silicon, and Windows on x64. The npm package installs only
your platform's binary, runs nothing at install time, and needs no Node
once it runs.

## Commands

| Command | What it does |
|---|---|
| `commitscape [path]` | The terminal interface: five screens over any Window of history |
| `commitscape check` | The files that nearly always change with the ones you staged, and did not |
| `commitscape who <path>` | Who to ask about a file or folder, and whether they still commit |
| `commitscape health <owner/name>` | Whether a GitHub project is alive and whether it depends on one person |
| `commitscape wrapped [folder]` | Your year across every repository under a folder, as a card |
| `commitscape card [path]` | The repository's story as an SVG card, like the one above |
| `commitscape surviving [path] --person <id>` | A person's Surviving Lines: the lines at the head that blame gives them, reformats passed through |
| `commitscape share` | An encrypted link to this repository's Report, for any browser |
| `commitscape report [path]` | The Report as gzipped JSON, as the Site stores it |
| `commitscape github [path]` | Fetch pull requests, issues and releases through the `gh` CLI |

`commitscape --summary` prints a plain-text summary, `--json` every metric
as one document, `--window 30d|90d|1y|all` picks the Window, and `--help`
lists every option.

## What it shows

| Screen | Shows |
|---|---|
| Overview | The project's story on a line (its first commit, releases, people joining and leaving, the busiest day, quiet stretches), commits over time, who writes the code, and what is worth a look |
| Activity | Commits over time by person with releases marked, pull requests and issues a week, the hours of the week, and what kind of work it was |
| People | A column per measure and no single score: commits, active days, lines added and removed, folders that depend on them, pull requests and reviews, with a profile for each person |
| Map | The code as nested blocks sized by lines, coloured by how often, when last, or who changes it. Open a file to see what changes with it |
| Risk | Hotspots (files changed often and deeply nested), files that change together, and folders one person holds, with who could take each over |
| Commits | Every commit, searched in your browser as you type (on the Site) |

Every number is explained on screen. Press `?` for what each screen means
and every key.

## Questions it answers

**What did I forget?** Before you commit, `commitscape check` names the
files that nearly always change with the ones you staged, with the
evidence, and says nothing when the evidence is weak:

```text
$ commitscape check
Probably forgotten:
  You changed src/schema.ts. 9 of the last 10 commits that did also changed a file in migrations/.
```

`--branch main` checks a branch, `--pr 123` a pull request, and `--strict`
exits with 1 when something looks forgotten. The
[`actions/check`](actions/check/README.md) GitHub Action comments the same
on pull requests.

**Who do I ask?** `commitscape who src/api` lists who worked on a file or
folder most and most recently, flags anyone who has stopped committing,
and names who to ask instead.

**Can I rely on this project?** `commitscape health owner/name` says
whether a GitHub project is alive: its maintainers in the last 90 days,
its bus factor, how often it releases, how fast issues get a first answer,
and whether it is getting busier or quieter.

**What did I do this year?** `commitscape wrapped ~/code` keeps only your
commits across every repository under a folder, under every address you
commit with, and draws your year as a card. Private repositories are
included, and nothing is uploaded.

## On the Site

- **Any public GitHub repository.** Go to `/gh/<owner>/<name>`. GitHub's
  facts show at once, and the Report follows when its history is read:
  seconds for most repositories.
- **Your own repositories.** Sign in with GitHub and choose repositories
  through commitscape's GitHub App, which can only read. A private
  repository's Report is shown only to people GitHub says can see it.
- **Leaderboards.** Popular repositories ranked by what commitscape
  measures: resting on one person, most maintainers, most active, fastest
  to answer issues, and oldest code still running. Repositories only,
  never people.
- **For AI agents.** An MCP server at `/mcp` lets an agent look up a
  repository and read its Report.

`/privacy` on the Site says what it keeps, where, for how long, and who can
read it.

## Privacy

On your machine, commitscape sends nothing anywhere unless you ask:

- With the [GitHub CLI](https://cli.github.com) signed in, it asks GitHub
  about pull requests, issues, reviews and releases. `--offline` never
  asks.
- `share` uploads the Report encrypted with AES-256-GCM. The key is only in
  the link, after the `#`, which browsers never send, so the Site stores
  what it cannot read. No email address is ever included.
- No analytics, no update checks, and nothing runs at install time.

## Self-hosting

The Site is a TanStack Start app and the Builder a small Node worker, both
published as Docker images on every merge. [DEPLOY.md](./DEPLOY.md) runs
them in Dokploy with Postgres and a Cloudflare R2 bucket.

## Development

Requirements: Rust (stable), Node.js 24, pnpm 12 and Docker.

```sh
git clone git@github.com:pixelactstudio/commitscape.git
cd commitscape
pnpm install
pnpm services
cargo xtask fixtures --force
cp apps/site/.env.example apps/site/.env
cp apps/builder/.env.example apps/builder/.env
pnpm dev:builder
pnpm dev:site
```

`pnpm services` starts Postgres and an S3 stand-in in Docker. Set
`BETTER_AUTH_SECRET` in `apps/site/.env` (`openssl rand -hex 32`). The Site
runs at [http://localhost:3100](http://localhost:3100). GitHub sign-in,
Sentry and PostHog stay off while their keys are empty.

| Command | Purpose |
|---|---|
| `cargo run -p commitscape -- <path>` | Run the CLI on a repository |
| `cargo test --workspace` | Every Rust test |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust lints |
| `cargo xtask check-layering` | Check that the crates depend on each other only as designed |
| `pnpm check` | Typecheck, lint, test and build every TypeScript package |
| `pnpm e2e` | The Site and the Builder end to end in Chromium, with accessibility checks |
| `pnpm db:generate` | Write the migration for a schema change |
| `cargo xtask bench` | Timings on large repositories |

## Architecture

| Folder | What |
|---|---|
| `crates/` | Rust: the engine that reads git, the metrics, the terminal interface, the Report and the CLI |
| `apps/site/` | The Site: TanStack Start on Node, server-rendered, with Better Auth |
| `apps/builder/` | The Builder: takes Builds from a Postgres queue, runs `commitscape report`, stores the Report in R2 |
| `packages/server/` | The database schema and migrations, R2 storage, the queue and stored Reports |
| `packages/ui/` | Every screen and chart the Site shows |
| `packages/data/` | The Report's types, generated from Rust |

- [Domain language](./CONTEXT.md)
- [Architecture decisions](./docs/adr)
- [Deploying](./DEPLOY.md)
- [Releasing](./RELEASING.md)
- [Agent guide](./CLAUDE.md)

## Stack

- Rust, gix, ratatui
- TanStack Start, React 19, TypeScript and Vite
- Astryx and Tailwind CSS
- PostgreSQL, Drizzle ORM, pg-boss and Cloudflare R2
- Better Auth, PostHog and Sentry
- Turborepo, oxlint, Vitest and Playwright

## Commit workflow

Commits and pull request titles use
[Conventional Commits](https://www.conventionalcommits.org/). Releases,
version numbers and the changelog are generated from them
([RELEASING.md](./RELEASING.md)):

```text
feat: count lines changed per person
fix: keep the Window when opening a file
chore: update dependencies
```

## License

commitscape is open-source software, licensed under either the
[MIT License](./LICENSE-MIT) or the [Apache License 2.0](./LICENSE-APACHE),
at your option.

An open-source project by [Pixelact Studio](https://pixelactstudio.com).
