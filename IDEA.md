# commitscape: the idea

Written 2026-09-24, after the owner used the Build Run 2 release on their own
repositories and reviewed it. This is the product brief for Build Run 3. It
says what commitscape is for, what changes, what goes, and in what order.
`STATE.md` tracks progress against it; `CONTEXT.md` is the glossary;
`docs/adr/` holds the decisions that are hard to reverse.

---

## In one sentence

Run one command on any git repository and see its story: who built it, who
knows which part, what is fragile, what changes together, and what you are
about to forget. The page it opens is good enough to screenshot.

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

## What it must stay

- **Small.** A fun project one person can maintain, not a platform. Every
  feature has to be useful, shareable, or both, and must not grow the
  codebase out of proportion.
- **Local.** Nothing about a repository leaves the machine. No accounts, no
  hosted service. GitHub data comes through the user's own `gh` CLI
  (ADR-0009). "Your code never leaves your machine" is a selling point.
- **Honest.** No number is shown that the data cannot support. "Unknown" is
  never shown as 0. A limitation is stated next to the number it affects.
- **Plain.** Every number is in words a newcomer understands, and `?` explains
  how it was measured.
- **Fast.** The terminal UI's first screen stays under 100 ms on a warm cache
  (ADR-0002). The browser UI is usable within a second on a warm cache.
- **Built openly with AI.** The owner builds this with AI agents and says so.
  That's how the project is made, not a feature of the product (see
  "Removed").

---

## What spreads, and what that means for us

GitHub stars for tools in this space, checked 2026-09-24:

| Tool | What it is | Stars |
|---|---|---|
| git-truck | `npx` opens a browser dashboard: a map of the repo and who wrote what | 774 |
| git-of-theseus | one chart of how long code survives | 3.0k |
| onefetch | one terminal screenshot | 12k |
| Gource | an animated video of a repository's history | 13k |
| github-readme-stats | stats cards people embed in their READMEs | 80k |

Dashboards don't spread on their own. Pictures and videos that people post
somewhere else do. So:

- **The browser UI is where people dig in.** It has to be the best-looking
  version of the product, but it is not the growth engine.
- **The growth engine is what people share:** the card, a year in review
  ("Wrapped"), a card that lives in a README and updates itself, and later a
  replay video of the Map growing.
- **git-truck already does "npx, then a browser map of authorship".** We win
  on:
  - speed on huge repositories (53 ms first screen on rust-lang/rust, 78 ms on
    Linux)
  - plain-language findings rather than raw charts
  - problem-solving commands
  - the shareable artifacts
  - a terminal mode for headless machines

---

## The owner's review of Build Run 2 (2026-09-24)

Everything below was checked against the code and the repositories' history.

**Liked, keep it:**
- The Map and its drill-down.
- "Worth a look" ("app/marketing: 86% of commits by Dev Talan").
- Hours of the week, which show a real working pattern.
- The calendar.
- The file detail with "why it is a hotspot".
- The age screen.
- The `.mailmap` hint.
- The card.

**Wrong or broken:**

1. **One person appears several times.** People are grouped by email.
   - pixelactstudio: "Dev Talan" appears twice, 1,044 commits from a Gmail
     address and 25 from a GitHub noreply address.
   - maihs: Dev Talan's two addresses hold 984 commits between them. Ryan's
     665 to 680 are split across five or six name-and-email pairs ("Ryan",
     "ryandev2", "Ryan Tuijp" under two addresses, a noreply address,
     perhaps "RyanLand").

   Shares, bus factor and the leaderboard are all wrong as a result.
2. **Commits are a poor measure of contribution.** One-character commits
   inflate them, and one large, careful change counts as one. The owner wants
   lines added and removed, as GitHub's contributors page shows, without the
   noise.
3. **`w` throws you back a page.** Changing the Window runs
   `self.opened.clear()` in `App::switch`, closing whatever detail was open.
   It should keep your place.
4. **There's no mouse support at all.** Clicking a tab, a row or a Map block
   does nothing.
5. **Small Map blocks are too small to read or pick** in the terminal.
6. **"Worth a look" repeats a folder and its own subfolder:**
   `app/marketing` 86% and `app/marketing/src` 92%, same person. It should
   collapse to the top-most folder.
7. **The Map's `c` hint says "colour".** It should say what the colour means:
   "c colour by: activity / age / owner".
8. **The person detail's "Works on" puts `package.json` first.** Manifests and
   lockfiles change with every dependency bump and shouldn't rank there.
9. **The person detail's red ▲ list** ("project folders that rest on them,
   96% of commits") confused the owner. It needs plain words, such as
   "Only Dev has touched these in the last year".
10. **Hotspot rows are cluttered.** Two bars with two numbers are hard to read.
11. **Coupling only shows pairs.** The owner asked why not groups.
12. **"Commits over time" is plain:** one flat bar chart.
13. **"Did you know?" facts are generic.**
14. **"What kind of work" isn't trusted.** It reads conventional-commit
    prefixes only, and most repositories don't use them.
15. **The GitHub screen is thin.** The owner wants PRs merged and by whom,
    reviews, closed issues, and GitHub data on the other screens as well.
16. **There's no theme to choose,** and no filters (by person, folder or
    date).
17. **The terminal UI looks average.** The library isn't the cause: ratatui is
    the standard. The design is: nine screens with equal weight, numbers
    without context, fixed colours, no mouse. The terminal also has hard
    limits: blocky charts, no hover, tiny text.

---

## Removed

- **Everything about AI agents.** The owner decided on 2026-09-24 that the
  product shows nothing AI-related. Phase 13 removes, end to end:
  - agent-commit detection (`crates/commitscape-index/src/message.rs`)
  - the `AGENT` commit flag in the index, with a cache version bump
  - every metric, JSON field, fact, tile, card line and help entry that
    counts or mentions agent commits
  - the Agent Commit, Context Weight, Stale Rule and Agent Footprint terms

  The ideas discussed and dropped with it:
  - "what changed when AI arrived"
  - AI share
  - reading git-ai or Agent Trace notes

  Bot accounts such as `github-actions[bot]` and `dependabot[bot]` are not an
  AI feature. They're still grouped as bots so they don't pollute the people
  rankings.
- **Nine screens become five:** Overview, Activity, People, Map, Risk.
  - Age becomes a Map colouring plus one Overview chart.
  - Hotspots and Coupling become Risk.
  - Ownership becomes part of People and a Map colouring.
  - The GitHub tab goes away: its data flows into Activity and People.
- **Generic facts.** A fact appears only if it's unusual for this repository.
- **Any single "score" of a person.** There is no productivity score and no
  "best developer" ranking, ever.
- **The planned `resvg` dependency** for a PNG card. The browser renders the
  card and saves it as PNG.

---

## The product after Build Run 3

### Surfaces

| Command | What it does |
|---|---|
| `commitscape [repo]` | Opens the browser UI when a browser can be opened, otherwise the terminal UI |
| `commitscape --web` / `--tui` | Forces one or the other |
| `commitscape who <path>` | Who to ask about this code, and why |
| `commitscape check` | What you probably forgot to change (staged changes, a branch, or a PR) |
| `commitscape health <github-url>` | Whether a project is alive and whether it depends on one person |
| `commitscape wrapped [folder]` | Your year across every repository in a folder, as a page and a card |
| `commitscape card` | The shareable card, SVG, for READMEs and CI |
| `commitscape report` | The browser UI saved as one HTML file with its data inside |
| `commitscape --json` | Unchanged: every metric, reproducible |

### The browser UI: the main UI from now on

A static React app served by the Rust binary. See ADR-0010 for how it's built
and served. The five screens:

1. **Overview.** The story at a glance:
   - name, age, size, languages, people
   - an annotated timeline of the project's life: first commit, releases,
     people joining and leaving, the biggest day, the biggest clean-up, quiet
     stretches, and language shifts ("moved from JS to TS in March 2025")
   - facts unusual for this repository
   - "Worth a look"
   - a small Map
2. **Activity.**
   - Commits over time, coloured by person (top five plus "others"), with
     releases marked.
   - PRs opened and merged, and issues opened and closed, from GitHub.
   - The calendar.
   - Hours of the week.
   - Kinds of work, judged first by the files a commit touched:
     - tests only
     - docs only
     - dependencies only
     - CI only

     If that doesn't settle it, the conventional-commit prefix decides. The
     chart is hidden when most commits can't be classified.
3. **People.** Contribution views side by side, with no single score:
   - commits
   - lines added and removed, excluding generated, vendored and lockfile
     changes, Bulk Commits, and the revisions listed in
     `.git-blame-ignore-revs`
   - areas where the person is the go-to
   - PRs merged
   - reviews given
   - time to merge

   Each person's profile shows where they work on a mini-Map, their hours,
   and their streaks. Merged identities show "merged 2 identities" with an
   undo.
4. **Map.**
   - Zoomable, with hover.
   - Colour by activity, age or owner.
   - Clicking a file draws lines to the files that change with it.
5. **Risk.**
   - Hotspots as a scatter chart (changes across, nesting up, danger corner
     shaded, labelled).
   - Change groups: sets of files that move together, not just pairs.
   - Knowledge silos: folders only one person has touched in a year, and
     who could take them over.

On every screen:
- **Filters:** click a person, a folder or a date range and every chart
  follows.
- **Share:** a button saves the card as PNG.
- **Themes:** light and dark, plus a few named themes.

### Over SSH

1. **VS Code and Cursor Remote-SSH:** these editors forward the port and
   open the laptop's browser through `$BROWSER`, so this works automatically.
2. **Tailscale or a LAN:** `--listen <addr>` prints a link with a secret
   token.
3. **Plain ssh:** the tool prints the one `ssh -L` line to paste. When there's
   no browser, it opens the terminal UI instead and says how to get the
   browser one.
4. **Later: `commitscape ssh devbox:~/code/repo` run on the laptop.** The
   engine runs on the server over the SSH connection, the pages are served on
   the laptop, and updates stream live. This needs commitscape installed on
   both machines.

### The terminal UI: frozen after one clean-up

- **Same five screens as the browser.**
- **Mouse support.**
- **Colours:** follows the terminal's own palette by default (so the user's
  terminal theme applies), plus a few named themes.
- **The review's fixes.**

After that, only bug fixes. New features land in the browser and in CLI
commands. It is already the largest crate (6.4k of about 17k lines of Rust),
and two UIs growing side by side is how this stops being a small project.

### Problem-solvers

- **`check`: what did I forget?** It takes the staged changes, a branch, or a
  PR. It lists files that historically change with the ones changed but are
  missing here, with evidence: "You changed `schema.ts`. 9 of the last 10
  commits that did also changed a migration." It stays quiet unless the
  evidence is strong. It exits non-zero only with `--strict`. A GitHub Action
  runs it on pull requests and posts one comment.
- **`who <path>`: who do I ask?** People ranked by how much and how recently
  they worked on the path. It flags anyone who has stopped committing ("last
  seen 8 months ago"), and names the next best person.
- **`health <github-url>`: can I rely on this?** It makes a partial clone into
  the cache (`--filter=blob:none`) and shows:
  - active maintainers in the last 90 days
  - bus factor
  - release rhythm
  - how fast issues get a first answer
  - trend
  - a card
- **`wrapped [folder]`: what did I do this year?** It finds every repository
  under a folder, keeps only the user's own commits (all their identities
  merged), and builds a year page and a card: commits, lines, languages,
  busiest day, streak, night-owl hours, top repositories. Private
  repositories are included and nothing is uploaded. It suits self-reviews and
  brag documents, and it's the December launch.

### GitHub, deeper (amends ADR-0009)

- **Fetch everything once, then only what's new:**
  - all pull requests (author, merged by, created, merged, closed, reviews,
    reviewers)
  - all issues (opened, closed, first response)
  - releases

  This replaces the latest-100 sample. It's cached like the index,
  incrementally, and runs in the background, never before the first screen.
- **Commits link to their GitHub accounts,** which is the strongest evidence
  for merging identities (ADR-0011).
- **Rate limits:** a big repository's first fetch shows progress and resumes
  where it stopped.

### Identity (ADR-0011, which supersedes the "nothing else merges" rule of ADR-0006)

- **Merge automatically when the evidence is strong:**
  - GitHub says the commits belong to the same account
  - or both Signatures carry the same full display name: two or more words,
    not a generic name like `root`, `ubuntu` or `Your Name`
- **Merge in the order of the evidence:** `.mailmap` first, then email
  equality, then the noreply rule, then GitHub accounts, then same full name.
- **Weaker signals are only suggested,** never merged: a single-word name, or
  the same email local-part.
- **Every merge is visible and can be undone.** Undo lives in the cache
  directory, never in the repository. A button can write the `.mailmap` lines
  for owners who want to fix it for every tool.

### Line counts (needs a new ADR that amends ADR-0004)

Lines added and removed per change come from a second pass that reads blobs.
- **It runs in the background after the first screen.**
- **It's cached incrementally,** in the line-delta field the Changeset schema
  reserved.
- **It's on by default,** since the first screen doesn't wait for it.
- **Before choosing, measure** the pass's cost on rust-lang/rust and Linux.
- **Until the pass finishes,** views that need lines say "counting lines…".

Blame-based "surviving lines" stays out of scope for this run.

---

## Build Run 3: the plan

Phases continue from Build Run 2. Each ends with a commit, and `STATE.md`
records its measured numbers and findings.

| Phase | What | Gate |
|---|---|---|
| 13 | Remove everything AI-related, end to end | No "agent" or "AI" left in UI, JSON, card, help or glossary; cache version bumped; goldens and snapshots updated |
| 14 | Trust fixes: identity merging (ADR-0011) with bots grouped; `w` keeps your place; mouse support; "Worth a look" collapses nested folders; Map `c` label; manifests and lockfiles out of "Works on"; plain words for the ▲ list | maihs shows Dev Talan once (984 commits) and Ryan once; pixelactstudio shows one Dev Talan; render tests for each fix |
| 15 | Line counts in a background pass (new ADR amending ADR-0004) and the People contribution views | Cold and warm cost measured on rust-lang/rust and Linux; the terminal UI's first screen still under 100 ms; hand-worked fixture values |
| 16 | Terminal UI clean-up: nine screens to five, themes (terminal palette plus presets), Kinds of work from files, facts only when unusual, commits over time by person with releases marked. Then freeze the terminal UI | Snapshots for all five screens; first screen under 100 ms |
| 17 | GitHub, deeper: full PR, issue, review and release history, incremental and resumable; commits linked to GitHub accounts | Works on t3code and maihs; a large repository resumes after an interruption |
| 18 | Browser UI foundation (ADR-0010): the local server, JSON API with generated TypeScript types, token security, `--web`, `--tui`, `--listen` and `--port`, choosing the default, the SSH behaviours, the `web/` app skeleton | API tests through the server; opens on this machine; works through VS Code Remote-SSH port forwarding |
| 19 | Browser screens: Overview (with the timeline), Activity, People, Map, Risk; filters; themes; card as PNG; `commitscape report` | Screenshots of every screen on pixelactstudio, maihs and t3code under `target/preview/web/` |
| 20 | Problem-solvers: `check` plus its GitHub Action, `who`, `health` | Hand-worked fixture tests; `check` run on real history finds a real forgotten file |
| 21 | `wrapped` (page and card) and the README card Action | The owner's own Wrapped across `~/code` |
| 22 | Distribution and launch material: npm (ADR-0003, with the web app inside the binary), Homebrew, Nix flake, README rewrite, a short demo video | `npx commitscape` works on a clean machine |

Later, not in this run:
- `commitscape ssh host:path`
- the replay video
- GitLab and other hosts
- blame-based surviving lines
- a smaller head write
- replacing `bincode`

## Launch

Aim for early December 2026, Wrapped season. The launch post shows the owner's
own Wrapped and a repository card. It says plainly that the project was built
with AI agents. The README carries the card, a GIF of the browser UI and a
GIF of the terminal UI.

## Not doing

- A hosted service, accounts, or uploading anything.
- Productivity scores or developer rankings.
- AI attribution of any kind (see "Removed").
- GitLab before the GitHub side is deep.
- New features in the terminal UI after Phase 16.
- Next.js, TanStack Start or any Node server. The Rust binary is the server
  (ADR-0010).
