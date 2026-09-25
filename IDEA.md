# commitscape: the idea

Written 2026-09-25, after Build Run 3 shipped and the repository went on
GitHub (`pixelactstudio/commitscape`). This is the product brief for Build Run
4. It says what commitscape becomes, what changes, and in what order.
`STATE.md` tracks progress against it; `CONTEXT.md` is the glossary;
`docs/adr/` holds the decisions that are hard to reverse. Build Run 3's brief
is in git history (`git show ed40d28:IDEA.md`).

---

## In one sentence

Run one command on any git repository, or paste any GitHub link into the
Site, and see its story: who built it, who knows which part, what is fragile,
what changes together, and what you are about to forget. Every page is good
enough to screenshot.

## Who it is for

- **A developer joining a codebase** who needs to know who to ask and where the
  risk is.
- **A developer about to push** who wants to know what they forgot to change.
- **A maintainer or lead** who wants to see who holds which part of the code
  before someone leaves.
- **Anyone choosing a dependency** who wants to know whether it is alive and
  whether it depends on one person.
- **Anyone curious about their own work**, at the end of the year or before a
  review.
- **Anyone on a headless machine** who wants to see all of this in the
  laptop's browser without setting up Tailscale or port forwarding.

## What it must stay

- **Small.** One person maintains it. Every feature is useful, shareable, or
  both.
- **Local first.** The CLI and its local browser interface stay complete
  without the Site. Nothing about a repository leaves the machine unless the
  user runs `commitscape share` (encrypted, ADR-0016) or asks the Site about
  a repository on GitHub.
- **Honest.** No number the data cannot support. "Unknown" is never 0. A
  limitation is stated next to the number it affects ("lines not counted").
- **Plain.** Every number in words a newcomer understands; `?` explains how
  it was measured.
- **Fast.** Terminal UI first screen under 100 ms warm (ADR-0002). Local
  browser interface usable within a second warm. On the Site, a stored Report
  shows within a second, and commit search updates within a frame.
- **Free to run.** The Site fits Cloudflare's free Workers plan (ADR-0014). The
  only other cost is the owner's existing VPS (ADR-0015).
- **Open source, all of it.** The CLI, the Site and the Builder live in this
  repository under MIT OR Apache-2.0.
- **Built openly with AI.** That is how the project is made, not a feature of
  the product. The product shows nothing AI-related.
- **No scores for people.** No productivity score and no ranking of
  developers. Leaderboards rank repositories.

---

## What changed since Build Run 3

The owner reviewed the finished Build Run 3 on 2026-09-25 and decided to grow
commitscape into something with a future, while keeping the local tool as the
heart of it. The following Build Run 3 decisions are **reversed**:

| Build Run 3 said | Build Run 4 says |
|---|---|
| No hosted service, no accounts, no uploading | A hosted Site with GitHub sign-in; uploading only as an encrypted Shared Report or when the user asks the Site about a GitHub repository |
| No Next.js, TanStack Start or Node server | The Site is TanStack Start on Cloudflare Workers. The local interface is still served by the binary (ADR-0010), and Rust never runs as a web server (ADR-0014) |
| The web UI is hand-rolled CSS | The web UI is built on Astryx (ADR-0018) |
| `web/` is the web app | A monorepo: `apps/local`, `apps/site`, `apps/builder`, `packages/ui`, `packages/data` (ADR-0013) |
| No HTTP client or TLS in the binary (ADR-0009) | `share` uploads over HTTPS (ADR-0016); GitHub is still asked through `gh` |

Kept: the terminal UI stays **frozen** (bug fixes only). All interface work
goes to the browser interface, which the local page and the Site share.

---

## Three ways to use it

1. **Locally.** `commitscape` in a repository opens the browser interface
   served by the binary, or the terminal UI where no browser can open. As
   today, plus the Astryx interface, a Commits screen and a Share button.
2. **Share from a terminal.** `commitscape share` builds the Report locally,
   encrypts it, uploads it, prints a link and **exits**. The terminal is free
   at once. The link works on any browser for 4 hours (1 to 12 with
   `--expires`). The page has a Delete button. The Site can't read what it
   stores (ADR-0016).
3. **On the Site.**
   - **Any public GitHub repository:** paste a link (or go to
     `/gh/<owner>/<repo>`). GitHub's facts show at once; the full Report
     follows when the Builder has read the history (seconds for most, about
     15 s for a React-sized one the first time), and is instant for everyone
     after.
   - **Your repositories:** sign in with GitHub, pick repositories through
     the GitHub App (read-only, ADR-0017), and open any of them.
   - **Leaderboards:** repositories ranked by what commitscape measures.

### How the pieces fit

```
 Browser ──────────────► Site: TanStack Start on Cloudflare Workers (free plan)
   │                       pages: static assets
   │ decrypts Shared       /api/*: auth, Reports, Shares, Builds, webhooks
   │ Reports; searches     D1: users, sessions, repositories, Builds, Shares
   │ commits               R2: Reports (gzip), encrypted Shared Reports
   │                           │ a Build (HTTPS + HMAC)
   │                           ▼
   │                     Builder on the owner's VPS: TypeScript job runner
   │                       git clone → `commitscape report --data` → the Site → R2
   │
 A user's machine: `commitscape` (local page, TUI, `share`, `check`, …)
```

Every screen, in all three ways, is the same code (`packages/ui`), reading
through a Data Source (ADR-0013): the local server, an inlined Report, or a
fetched Report.

---

## The browser interface, on Astryx

- **Astryx for every component** (ADR-0018): app shell and top navigation,
  tabs, tables for people, files and hotspots, tooltips and hover cards,
  dialogs, toasts, avatars, a ⌘K command palette ("Jump to": a screen, a
  person, a folder, a file, a commit). One commitscape theme in light and
  dark, plus "system".
- **Charts stay ours,** restyled with Astryx's tokens. Astryx's canary
  charts replace bar or line charts only if a side-by-side screenshot shows
  they're better; Recharts is the fallback.
- **Keyboard first,** as npmx.dev does it: `/` focuses search, `1`–`6` pick a
  screen, `?` shows every shortcut and highlights the keys on screen,
  shortcuts off while typing.
- **Avatars.** People linked to a GitHub login show their GitHub avatar.
  Locally the browser fetches it from GitHub unless `--offline`. README's
  "What leaves your machine" says so.
- **Six screens:** Overview, Activity, People, Map, Risk and **Commits**
  (ADR-0019): search every commit by message, person, date and kind,
  instantly, with a link to GitHub. The terminal UI doesn't get it.
- **Share button** on the local page: the same as `commitscape share`, with
  the link to copy.

## The Site

Few pages, each doing one thing well. npmx.dev is the reference for feel:
a big search box, instant response, keyboard shortcuts, calm layout.

| Page | What it is |
|---|---|
| `/` | Landing page: one line on what commitscape is; a box to paste a GitHub link (with suggestions); the three ways to use it, each with its command or button; a few leaderboard highlights; install commands |
| `/gh/<owner>/<repo>` | A repository's Report: the six screens, with GitHub's instant facts first and "updating" while a newer Build runs. Private ones only for signed-in users who can see them on GitHub |
| `/s/<id>#<key>` | A Shared Report, decrypted in the browser, with its expiry and a Delete button |
| `/me` | Signed in: your repositories through the GitHub App, "Add repositories", "Delete my data" |
| `/leaderboards` | Repository rankings, rebuilt daily as static pages |
| `/privacy` | Exactly what is stored, where, for how long, and who can read it |

The top navigation has the command palette and a **Connect** menu:
"Share from your terminal" (shows the `share` command) and "Sign in with
GitHub".

**Social previews.** Every repository page has an Open Graph image: its
Card, written as a PNG or SVG when its Report is built and served from R2.

## Leaderboards

Repositories only, never people. Built by the Builder from a seed list of
popular repositories per language (from GitHub search: most stars), a
budgeted number per night, so the VPS isn't overrun. First boards:

- **Resting on one person:** popular projects with a Bus Factor of 1.
- **Most maintainers active** in the last 90 days.
- **Most active this month** by commits and by people.
- **Fastest to answer issues** (from `health`'s numbers).
- **Oldest code still running:** the largest share of lines untouched for five
  years.

Each row links to the repository's page. Boards say when they were built and
from how many repositories.

## Security, in one place

- **Shared Reports:** AES-256-GCM, key only in the link's fragment, removed
  from the address bar on load; Delete Token derived from the key and stored
  hashed; IDs of 128 random bits; 4 hours by default, 12 at most; 25 MB cap;
  per-IP limits (ADR-0016).
- **GitHub:** one GitHub App, read-only permissions; installation tokens live
  an hour and are never stored; access re-checked on every view; webhooks
  verified; uninstall and "Delete my data" delete everything (ADR-0017).
- **Builder:** HMAC-authenticated Builds, one at a time, size and time caps,
  clones deleted after private Builds (ADR-0015).
- **Hosted Commit Lists carry no email addresses** (ADR-0019).
- **The local server** keeps ADR-0010's token and `Host` checks.

## The name

`commitscape` may be renamed before the first npm release. Nothing is
published and no domain is bought during this build run. The product name
and the Site's origin each live in one constant in `packages/data` (ADR-0014);
the CLI's Site origin is overridable with `COMMITSCAPE_SITE`. Code and docs
use `commitscape` until the owner decides.

---

## Build Run 4: the plan

Phases continue from Build Run 3. Each phase ends with every check passing
(Rust on Linux, macOS and Windows; the TypeScript workspace; Playwright) and
`STATE.md` updated with its measured numbers and findings. **The agent
doing the work never commits, pushes, publishes or deploys; the owner
commits.**

| Phase | What | Gate |
|---|---|---|
| 23 | Monorepo (ADR-0013): pnpm + Turborepo; `web/` → `apps/local`; `packages/ui` and `packages/data`; the Data Source seam; every path that named `web/` (build.rs, assets.rs, flake, CI, release, scripts, README) | Every existing test passes from the new layout (Rust, vitest, Playwright); `cargo build` embeds the app; `nix build` builds; actionlint passes on both workflows |
| 24 | Astryx (ADR-0018): theme, app shell, every screen's components, command palette, keyboard shortcuts, avatars; charts restyled; canary charts tried side by side | Playwright tests pass; screenshots of every screen in both themes on ripgrep in `target/preview/web/`; size of the embedded app before and after; a keyboard-only walk through every screen |
| 25 | Commit search (ADR-0019): subjects in the index (cache version bump), `/api/commits`, the Commit List in Reports, the Commits screen | Hand-worked fixture values; goldens and the generated types updated; search time and list size measured on facebook/react and rust-lang/rust |
| 26 | The Site's foundation (ADR-0014): `apps/site`, landing page, repository page reading a stored Report, the fetched-Report Data Source, D1 schema and migrations, rate limiting, `/privacy` | Under `wrangler dev`, Playwright passes on the landing page and on a repository page from a fixture's Report; CPU time of every API handler recorded (under 10 ms) |
| 27 | Builder and public lookup (ADR-0015): `commitscape report --data`, clone policy and threshold, `apps/builder`, instant GitHub facts, refresh after 24 hours, Open Graph Cards | End to end on this machine (`wrangler dev` + the Builder): ripgrep and facebook/react built and shown, times recorded; not-found, private, too-big and timed-out repositories each show a plain message |
| 28 | Sharing (ADR-0016): `commitscape share` (with `--expires`, `--delete`, `--list`, `--yes`), the Share button, the `/s/` page, expiry via Cron Trigger | End to end on this machine, CLI to browser; the key never appears in any request (checked in Playwright); a tampered ciphertext fails; expired answers 410; CI green on all three operating systems with the new crates |
| 29 | GitHub sign-in (ADR-0017): the App's user sign-in, `/me`, installations, access checks, webhooks, retention, "Delete my data" | Tests against GitHub responses recorded by hand (as `commitscape-forge` does) and, if the owner has created a test App, against GitHub itself; webhook signatures and access checks covered |
| 30 | Leaderboards: seed list, nightly budget, the five boards as static pages | 50 or more seed repositories built on this machine; boards rendered and screenshotted |
| 31 | Ready to launch: README for all three ways, "What leaves your machine" rewritten, `DEPLOY.md` (Cloudflare, the VPS, the GitHub App, secrets), a security pass over every endpoint | Every CI job green; `DEPLOY.md` followed from scratch against local stand-ins; nothing is left for the owner but the steps listed under "Needs the owner" |

### Needs the owner

These can't be done by an agent and aren't part of any gate:
- choosing the name, buying the domain, publishing to npm and Homebrew
- creating the Cloudflare account, D1 database, R2 bucket and secrets, and
  deploying
- setting up the VPS from `DEPLOY.md`
- creating the GitHub App (a test one earlier helps Phase 29)
- GitHub Sponsors (`.github/FUNDING.yml` once the account exists)

## Later, not in this run

- A live mode for Shared Reports, if people ask for it.
- A paid team plan: private-repository dashboards, weekly emails ("the only
  person who knows `payments/` hasn't committed in 60 days"), `check` as a
  bot on private pull requests. Public repositories stay free.
- Sponsor slots on the landing page and leaderboards, once there is traffic.
- `commitscape ssh host:path`, the replay video, GitLab, blame-based
  surviving lines, replacing `bincode`.

## Launch

Unchanged in spirit: aim for early December 2026, Wrapped season. The post
shows the owner's Wrapped, a repository card, and the Site's "paste any
GitHub link", and says plainly that the project was built with AI agents.

## Not doing

- A live relay or tunnel between a user's machine and the Site (ADR-0016).
- A Rust web server anywhere (ADR-0014).
- Anything that needs Cloudflare's paid plan.
- Scores or rankings of people.
- AI attribution of any kind.
- New features in the terminal UI.
- Email addresses on the Site.
- Publishing, deploying or buying anything during the build run.
