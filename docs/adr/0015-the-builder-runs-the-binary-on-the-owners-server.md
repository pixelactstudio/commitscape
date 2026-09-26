# The Builder runs the commitscape binary on the owner's server, from partial clones

Reports for repositories on the Site (public lookups, Connected Repositories, leaderboards) are made by the Builder:
1. A small TypeScript job runner on the owner's VPS takes one Build at a time from the Site.
2. It clones the repository.
3. It runs the released `commitscape` binary to write the Report's data.
4. It uploads that to the Site, which stores it in R2.

The analysis stays in Rust and in one place, and it runs as a command, never as a server.

## Status

accepted (2026-09-25, Build Run 4 plan); amended in Phase 27 and in Phases 30 and 31 (below).

## Context

The GitHub API can't supply what commitscape is about: which files change together, who holds which folder, Hotspots, Code Age. It would take one request per commit (21,708 for facebook/react) against a limit of 5,000 an hour. So the Site has to read git history, which needs a machine with git and disk. Cloudflare can't provide one for free (ADR-0014). The owner has a VPS.

Measured on 2026-09-25, on this machine:

| Repository | Commits | Full clone | Partial clone (`--filter=blob:none`, HEAD checked out) | First analysis | Again, cached |
|---|---|---|---|---|---|
| BurntSushi/ripgrep | 2,287 | 6.3 MB | 2.9 MB in 2.9 s | 63 ms | 10 ms |
| facebook/react | 21,708 | 1.1 GB | 62 MB in 14.0 s | 1.39 s | 81 ms |

A bare partial clone fails: the head pass reads the files at HEAD. `commitscape report` also fails on a partial clone: the line-count pass (ADR-0012) reads every old version of every changed file ("failed while reading a blob for its lines"). ripgrep's Report from a full clone took 263 ms and is 1.1 MB, 144 KB gzipped.

## Decision

- **One Rust command writes a Report's data:** `commitscape report --data <file>` writes the JSON a Report page inlines (meta, answers, cards, Commit List), gzipped, without the HTML.
  - It accepts a GitHub URL as `health` does, keeping the clone in the cache directory.
  - It can count lines or leave them out.
  - Where the counts are left out, the Report says so: "lines not counted".
- **Clone policy.** GitHub's API gives a repository's size before cloning:
  - **up to 200 MB:** a full clone, with lines counted
  - **bigger:** a partial clone with HEAD checked out, lines not counted

  The threshold is set from measurements in Phase 27 and recorded in STATE.md.
- **The job runner (`apps/builder`) is TypeScript,** run under Node on the VPS as a systemd service:
  - It accepts a Build over HTTPS, authenticated with an HMAC shared with the Site.
  - It runs one Build at a time (configurable).
  - It enforces a size cap, a time limit and a disk budget, and deletes old clones when the budget is reached.
  - It uploads the Report to the Site's API (`PUT /api/builds/<id>/report`, HMAC-signed), which streams it into R2. The VPS holds no storage credentials, and the whole path runs on one machine under `wrangler dev`.
- **GitHub data inside a Build comes through `gh`, as locally (ADR-0009).** The Site hands the Builder a GitHub token for the Build: the App's installation token for Connected Repositories (ADR-0017), otherwise an installation token from the App's installation on the owner's own account, which can read any public repository (verify this in Phase 27). The Builder sets `GH_TOKEN`. The Rust code doesn't change.
- **Clones and caches stay warm.** A Report older than 24 hours is rebuilt the next time someone asks for it. The old one is shown meanwhile, marked "updating". A rebuild only fetches new commits.
- **While the first Build of a repository runs,** the Site shows what GitHub's API gives instantly (description, stars, languages, contributors with avatars, releases) and the Build's progress.

## Consequences

- **The first visitor to a large repository waits:** about 15 s for React-sized ones. Everyone after gets the stored Report.
- **The VPS is the one piece the owner runs by hand.** `DEPLOY.md` documents it: Node, git, `gh`, the binary, the service, the secrets.
- **The Site works without the Builder,** with GitHub's instant facts and a "Builds are paused" message, so the VPS can be down without taking the Site with it.

## Amendment: the threshold, measured in Phase 27

`commitscape report --data owner/name` from nothing (clone, index, lines,
write), on this machine:

| Repository | GitHub's size | Full clone, lines counted | Partial clone, no lines |
|---|---|---|---|
| BurntSushi/ripgrep | 6 MB | 3.0 s | 4.2 s |
| vitejs/vite | 75 MB | 15.8 s | 8.9 s |
| astral-sh/ruff | 207 MB | 44.8 s | 18.4 s |
| facebook/react | 1,071 MB | 212.5 s | 18.8 s |

A full clone costs about 0.2 s per MB of GitHub's size; a partial one 4 to
19 s whatever the size. **Full clones stop at 100 MB**, not 200: a first
visitor waits about 20 s at most for a Report with lines, rather than 45 s
at 200 MB. The Builder's `FULL_CLONE_UP_TO_MB` changes it.

## Amendment: tokens, the queue, and what a private Build leaves (Phases 30 and 31)

- **Public Builds use no GitHub token.** Hosted Reports are made with
  `--offline` (Phase 27): they read git only, so the installation token
  "from the App's installation on the owner's own account" planned above
  is not needed. One read-only token for public repositories,
  `GITHUB_TOKEN` (a fine-grained personal access token, DEPLOY.md), serves
  the Site's instant facts and, on the Builder, the Leaderboards' seed
  search and `health`'s issue answers. Commands the Builder runs never see
  its own environment's secrets: they get an allow-listed environment,
  and a token only by name where they need one.
- **The queue.** People's Builds go ahead of the night's seeds. The Site
  refuses a new Build while 30 of people's Builds are waiting or running
  ("The Builder has many repositories to read just now"), and the Builder
  refuses past 250 waiting; either way no one can queue hours of work.
- **A private Build leaves nothing.** `commitscape` keeps an index of each
  clone in its cache folder; a Connected Repository's Build gets a cache
  folder of its own (`<work>/private/<build>`), deleted, clone and index,
  when the Build ends. The disk budget counts public indexes as well as
  clones.
