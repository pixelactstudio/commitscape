# STATE

Running log for Build Run 1 (Phases 0 to 7). Written so a fresh session with
no context can read this plus `docs/adr/` and continue without asking anything.

**Current position:** Build Run 5 (Phases 32 to 42) is done, uncommitted in the working tree: its brief is `IDEA.md`, with ADR-0020 to ADR-0022 and ADR-0023, written during the run. The table under "Build Run 5" gives each phase's gate and result, each phase's findings are under "Phase N findings", and "Where to pick up" (at the end) lists what is left for the owner. Phase 36's README embed and Phase 40's three real accounts need the owner; everything else met its gate. Build Run 4 (Phases 23 to 31) is committed. Since Build Run 4 the Site moved from Cloudflare to TanStack Start on Node with Postgres and R2 (`CLAUDE.md`, `DEPLOY.md`); older findings below that mention D1, Workers or `wrangler` describe that earlier Site.
Build Run 1 (Phases 0 to 7) built a correct, fast tool. Build Run 2 (Phases 8
to 12) made it fun and visual. On 2026-09-24 the owner used it on their own
repositories and reviewed it. The review and the decisions that followed are
in `IDEA.md`, which is the brief for Build Run 3:
- a browser UI becomes the main interface (ADR-0010)
- identities merge on strong evidence (ADR-0011)
- contributions are shown through several views
- problem-solving commands: `check`, `who`, `health`, `wrapped`
- everything AI-related is removed
- the terminal UI is cut from nine screens to five, then frozen

---

## Gate table

| Phase | Gate | Status |
|---|---|---|
| 0 | Benchmark harness runs and records a number | **PASS — `startup` median 0.95ms** (min 0.56, max 1.05, n=20) |
| 1 | Cold walk time on `rust-lang/rust` recorded | **PASS: 23.1 to 26.9s** (budget 60s). First run was 114s; see ADR-0007 |
| 2 | Warm start measured, in ms | **PASS: 23.1ms rust-lang/rust, 23.5ms Linux** (medians, n=20; budget 100ms) |
| 3 | Top-10 largest and top-10 hotspots contain no lockfiles / drizzle snapshots / `routeTree.gen.ts` | **PASS on `pixelactstudio`**, which has all three; unfiltered, `pnpm-lock.yaml` ranks third by size and the snapshots eleventh to thirteenth |
| 4 | Metric values match hand-worked fixture literals | **PASS**: 11 tests in `crates/commitscape/tests/fixture_metrics.rs` assert every documented value through the real pipeline |
| — | Throwaway ratatui spike, captured then deleted | **DONE**: findings below; the code was deleted from `.scratch/` |
| 5 | Pair-map size + changeset histogram reported; `--max-changeset-size` chosen from data | **PASS**: seven repositories reported below; default stays 50, now with the data behind it |
| 6 | `--json` run against ≥3 structurally different repos | **PASS: five** (pixelactstudio, t3code, maihs, rust-lang/rust, Linux), each checked against 16 invariants; golden files for all ten non-empty fixtures |
| 7 | TUI: every Panel covered by an `insta` snapshot through `TestBackend`; first paint from a warm cache measured under 100ms | **PASS**: all seven Panels and every detail they open have snapshots (20 tests, 18 snapshots); first paint median **51.2ms rust-lang/rust, 67.5ms Linux** (n=20, in a pseudo-terminal, its start-up included) |

### Phase 0 measured numbers

```
startup   min 0.56ms   median 0.95ms   mean 0.87ms   max 1.05ms   n=20
```

Process launch to exit, release build, doing no work. This is the floor under
ADR-0002's 100ms warm-start budget: **~99ms remains for actual work**, before
the Node shim from ADR-0003 adds its own startup on top.

### Phase 1 measured numbers

```
cold-walk-rust   23.1s to 26.9s over five runs, n=1 each   (budget: 60s, gating)
index: 345,135 commits (108,403 merges), 1,489,215 changes,
       110,698 files, 8,523 people
merge commits account for 122,152 of 1,489,215 changes (8.2%)
pass one (graph, one thread): 2.8s   pass two (diffs, six threads): 18 to 21s
CPU: user 99 to 113s against 24 to 26s wall, so the diffs use all six cores
memory: peak 1,940 MB resident, of which about 1,000 MB is the memory-mapped
        pack file; about 900 MB anonymous
```

The first measurement was 114s, single-threaded, with merges diffed against
their first parent: 4,763,555 changes, 71% of them replayed by merges. Two
changes brought it to 25s:

1. **Merges record their combined diff** (ADR-0007): only paths that differ
   from every parent. Stored changes fell from 4.8M to 1.5M, and a subtree that
   matches either parent is skipped unread.
2. **Diffs run on every core.** Pass one walks the graph on one thread; pass
   two hands out batches of 64 commits to one thread per core, each with its
   own object and delta-base caches, and delivers results in walk order.

Single-threaded, our diff costs about 185us per commit against git's 81us on
the newest 40k commits. The difference is probably object lookup and delta
resolution in gix; it was not chased further because the budget is met with
more than 2x headroom. Scaling is 3.4x on six physical cores, which points at
memory bandwidth (per-thread caches far exceed the 16 MB L3).

**Verification.** `cargo xtask verify-walk <repo>` compares the walk with `git
diff-tree -c --raw` and `git rev-list --count`:

| Repository | Commits walked | Sampled | Merges sampled | Mismatches |
|---|---|---|---|---|
| `rust-lang/rust` | 345,135 (= rev-list) | 3,453 (1 in 100) | 1,085 | 0 |
| `pixelactstudio` | 1,116 (= rev-list) | all | 70 | 0 |
| `t3code` | 7,789 (= rev-list) | all | 179 | 0 |
| `maihs` | 5,654 (= rev-list) | all | 1,302 | 0 |

CI runs the same check over every fixture.

### Phase 2 measured numbers

```
warm-start-rust    min 19.9ms   median 23.1ms   max 27.2ms   n=20   (budget 100ms)
warm-start-linux   min 20.9ms   median 23.5ms   max 30.9ms   n=20   (budget 100ms)
warm-update-rust   min 164.7ms  median 170.6 to 192.3ms  max 256.9ms  n=10
                   625 new commits, main rewound 40 first-parent steps (budget 300ms)
cold-index-linux   86.2s, 1,483,509 commits, 950 refs     (stress number, not gating)
cache size         rust-lang/rust: 12.5 MB head, 26 MB data
                   Linux: 12.8 MB head, 97 MB data
```

Warm start means the binary from process start to exit, reading the cache for
a 90-day window: open the repository, fingerprint the refs, read and decode the
head, read the months the window needs. No git object is read. Page cache
matters: with the head file evicted, reading it alone took 21 to 25ms.

What the warm path costs, measured on rust-lang/rust with a warm page cache:
repository open 0.4ms, refs fingerprint 0.2ms (1.2ms for Linux's 950 refs),
head file read 6ms, checksum 1.2ms, decode 7 to 8ms on three threads, window
blocks 2 to 3ms.

### Phase 3 measured numbers

```
cold-index-rust    22.8s to 30.4s (history walk and HEAD pass; budget 60s)
                   62,799 files at HEAD, read and measured once
warm-start-rust    median 27.7ms   (n=20; now includes the Analysis and rankings)
warm-start-linux   median 31.7ms   (n=20)
warm-update-rust   median 265.0ms, max 278.4ms, 625 new commits (budget 300ms)
```

The gate run, `commitscape ~/code/pixelactstudio --window all`:

```
Largest files (lines, generated files excluded)
   1      1,200  apps/api/src/modules/admin/v1/__tests__/users.integration.test.ts
   2        863  packages/auth/src/__tests__/security-hardening.integration.test.ts
   3        838  apps/dashboard/src/features/audit-log/components/admin-audit-log.tsx
   ...
Hotspots (churn in the window, and indentation complexity, both ranked)
   1  churn    40  complexity     1,582  packages/auth/src/index.ts
   2  churn    13  complexity     2,222  apps/api/src/modules/admin/v1/__tests__/users.integration.test.ts
   3  churn    26  complexity       963  apps/api/src/modules/admin/v1/users.handlers.ts
   ...
```

Without classification the same repository's ten largest files are nine JPEGs
and MP4s and `pnpm-lock.yaml`; its Drizzle snapshots come eleventh to
thirteenth. `vidcastx` passes the same check. rust-lang/rust and Linux were
used to find the failure modes listed under Phase 3 findings.

### Phase 4 measured numbers

```
warm-start-rust    median 35.6ms   (n=20; the summary now computes every metric)
warm-start-linux   median 51.0ms   (n=20)
```

Per metric, warm, 90-day Window: rust-lang/rust ownership 7ms, staleness 1.7ms,
code age 1.7ms; Linux ownership 15ms before the rewrite described in the
findings, suspected duplicates 12ms before their `.mailmap` text was made lazy.

### Ratatui spike findings

A throwaway crate in `.scratch/` (ratatui 0.30.2, crossterm 0.29, insta 1.48)
loaded through the real cache, computed a real Analysis, and drew an Overview:
a title line, a hotspot list and a bus-factor-1 list. Then it was deleted.

- **First paint fits the budget.** In a pseudo-terminal (`script`), from
  process start to the first frame drawn: rust-lang/rust 28.6 to 30.5ms (load
  23ms), Linux 40.9 to 41.5ms (load 28ms, then 13ms of Analysis inside the
  draw). Whole process, Linux: 50 to 60ms wall.
- **`ratatui::init()` and `ratatui::restore()`** set up and tear down raw mode,
  the alternate screen and a panic hook: 35µs. Layouts are
  `Layout::vertical([..]).areas(rect)`, returning arrays.
- **`TestBackend` plus `insta::assert_snapshot!(terminal.backend())` works as
  the render seam**: the snapshot is the screen as quoted text rows, box
  drawing included, and a 60 by 12 draw takes 0.19ms. insta writes a
  `.snap.new` and fails on a new snapshot; accept with `INSTA_UPDATE=always`
  once and commit the `.snap`. CI must never write snapshots.
- **Compute per Window, not per frame.** The spike called `hotspots()` and
  `ownership()` inside the draw closure; on Linux that is 13ms a frame. The
  real TUI keeps view models and recomputes them only when the Window or a
  threshold changes.
- **The root directory needs a name**: its path prefix is empty, and a
  bus-factor-1 list rendered it as a blank row.
- **The fixtures are all `.txt` files, which are Prose**, so they have no
  Hotspots or largest files and make thin snapshots. TUI snapshot tests will
  build their index from code files.

### Phase 5 measured numbers

`cargo xtask changesets <repo>...`, over all history, non-merge commits:

| Repository | Commits | Median files | p90 | p99 | Over 50 | Over 100 |
|---|---|---|---|---|---|---|
| env-helper | 147 | 1 | 3 | 40 | 0.68% | 0% |
| vidcastx | 259 | 3 | 23 | 168 | 6.18% | 2.32% |
| pixelactstudio | 1,046 | 1 | 13 | 124 | 2.29% | 1.24% |
| maihs | 4,352 | 2 | 7 | 35 | 0.60% | 0.16% |
| t3code | 7,610 | 2 | 16 | 74 | 2.04% | 0.70% |
| rust-lang/rust | 236,732 | 2 | 9 | 58 | 1.21% | 0.51% |
| Linux | 1,371,396 | 1 | 4 | 15 | 0.15% | 0.05% |

Change Coupling's pair map at the default support of 5:

| Repository | 90 days | 1 year | All history |
|---|---|---|---|
| pixelactstudio | 120 pairs, 0.0ms | 1,263, 0.3ms | 1,263, 0.3ms |
| t3code | 25,098, 3.8ms | 37,383, 6.0ms | 37,383, 6.0ms |
| maihs | 3,077, 1.0ms | 8,062, 2.5ms | 9,561, 2.9ms |
| rust-lang/rust | 13,711, 2.5ms | 59,363, 10.9ms | 472,305, 121ms |
| Linux | 3,940, 1.8ms | 46,424, 11.0ms | 1,430,730, 455ms |

**`--max-changeset-size` stays 50, chosen from this.** Over 50 files is 0.15%
of Linux's commits and 1.2% of rust-lang/rust's: the reformat and mass-move
tail, with rust's p99 at 58. In young application repositories it is 2 to 6%,
mostly scaffolding drops, which must not drive Change Coupling. At 100, the
0.7% of rust-lang/rust's commits touching 51 to 100 files would each add 1,275
to 4,950 pairs.

### Phase 6 measured numbers

`commitscape <repo> --json --window 1y`, release build:

| Repository | Shape | Commits (1y) | Merges | People | Cold | Warm |
|---|---|---|---|---|---|---|
| pixelactstudio | TypeScript monorepo, two people, generated files | 1,116 | 70 | 2 | 150ms | 20ms |
| t3code | TypeScript app, many contributors | 7,789 | 179 | 305 | 484ms | 36ms |
| maihs | Next.js app, merge-heavy (23% merges) | 4,685 | 1,210 | 18 | 971ms | 10 to 17ms |
| rust-lang/rust | compiler, 345k commits, bors merges | 33,646 | 12,589 | 8,523 | 23.2s | 58 to 70ms |
| Linux | kernel, 1.48M commits, 39k people | 89,337 | 7,674 | 39,381 | 87.0s | 97 to 100ms |

Warm, by Window: rust-lang/rust 40 to 47ms at 90 days, 270 to 314ms over all
history; Linux 59 to 69ms at 90 days, about 1.0s over all history. Output is
34 to 81 KB at the default `--top 20`.

Every document passed these checks (`jq`): percentiles, scores and coupling
degrees within 0 to 1; each score equal to the product of its percentiles;
each Jaccard degree equal to together / (first + second - together); owner
shares summing to 1 and owner commits to the directory's; bus factor between
1 and the number of owners; changeset buckets summing to the commit count;
median ≤ p90 ≤ p99 ≤ max; rankings in order.

### Phase 7 measured numbers

`cargo xtask bench --filter first-paint`: process start to the interface's
first frame, then exit, warm cache, 90-day Window. The binary runs under
util-linux `script` for a pseudo-terminal; `script -qec true` alone takes
about 15ms, so these are upper bounds.

```
first-paint-rust    min 49.19ms   median 51.23ms   mean 51.85ms   max 60.02ms   n=20
first-paint-linux   min 63.88ms   median 67.50ms   mean 67.63ms   max 77.22ms   n=20
```

Peak memory (GNU `time`, maximum resident set):

| Repository | Summary, 90 days | Interface, 90 days | Interface, then all history |
|---|---|---|---|
| rust-lang/rust | 43 MB | 115 MB | 148 MB |
| Linux | 51 MB | 234 MB | 325 MB |

Most of the interface's extra memory is the rest of history, read in the
background once the first frame is up (decision 20).

### Build Run 2

The user's feedback on the Phase 7 interface, in short: the numbers are right
but hard to read (what is `p94`, how is complexity measured, what is
coupling); lists of long paths are not something anyone reads; the selection
highlight inverts colours; there are no charts and nothing fun. They asked for
charts and graphs in the terminal, stats about the project and its people, a
help window that explains every term, and GitHub stats through the `gh` CLI
(GitHub first, other hosts later). This reverses two lines of the original
brief, "findings rather than counts" for the Overview and "no network calls",
at the user's request.

| Phase | What | Status |
|---|---|---|
| 8 | The index records each commit's Local Time, Commit Kind and whether an agent co-wrote it; the remote URL is readable | **DONE** |
| 9 | The repository's story as Analysis methods: languages, activity, rhythm, streaks, people, fun facts | **DONE** |
| 10 | GitHub numbers through `gh`, in the background and cached | **DONE** (the crate; its Panel comes with Phase 11) |
| 11 | The interface rebuilt around charts, colour, plain language and a help window | **DONE**: nine screens, a help window, search; 28 render tests; first paint 55.1ms rust-lang/rust, 77.4ms Linux |
| 12 | `commitscape card`: the Overview as a shareable SVG | **DONE**: a 1,080 by 684 pixel card, 19 to 27 KB on real repositories |

### Build Run 3

The brief is `IDEA.md`, including the owner's review of Build Run 2 and the
gate for each phase.

| Phase | What | Status |
|---|---|---|
| 13 | Remove everything AI-related, end to end | **DONE**: no agent or AI term in the UI, JSON, card, help or glossary; cache schema 8; JSON schema 2 |
| 14 | Trust fixes: identity merging (ADR-0011), `w` keeps your place, mouse, review fixes | **DONE**: maihs one Dev Talan and one Ryan, pixelactstudio one Dev Talan; render tests for each fix |
| 15 | Line counts in a background pass (new ADR amending ADR-0004); People contribution views | **DONE**: ADR-0012; rust-lang/rust 53 s and Linux 195 s cold, background; hand-worked `lines` fixture |
| 16 | Terminal UI: nine screens to five, themes, Kinds of work from files, unusual facts only; then frozen | **DONE**: snapshots of all five screens; first paint 52.0 ms rust-lang/rust, 69.6 ms Linux; frozen |
| 17 | GitHub, deeper: full PR, issue, review and release history, incremental (amends ADR-0009) | **DONE**: t3code and maihs fetched; t3code resumed after an interruption |
| 18 | Browser UI foundation (ADR-0010): server, API, generated types, token, default choice, SSH | **DONE**: API tests through a real server; opened in Chromium here; VS Code simulated with `$BROWSER` |
| 19 | Browser screens, filters, themes, PNG card, `commitscape report` | **DONE**: screenshots of every screen, both themes, on pixelactstudio, maihs and t3code in `target/preview/web/`; 8 Playwright tests on a fixture; first chart 740 ms rust-lang/rust, 459 ms Linux |
| 20 | `check` plus its GitHub Action, `who`, `health` | **DONE**: hand-worked tests for all three; replayed over real history, `check` flagged files the same author then changed in their next commits (10 in maihs, 12 in t3code) |
| 21 | `wrapped` and the README card Action | **DONE**: the owner's 2026 across `~/code` in `target/preview/wrapped/`; hand-worked test for the year; the card Action simulated against a local remote |
| 22 | Distribution (npm, Homebrew, Nix) and launch material | **DONE, but not published**: `npx commitscape` ran on clean Debian and Alpine containers from the packed tarballs; the flake builds; nothing is on npm yet (no remote, no token) |

### Build Run 5

The brief is `IDEA.md` (written 2026-10-04): the Site turns from a repository's Report to a person's Profile, with Standings, Cards and the fun side (ADR-0020 to ADR-0022). The agent doing the work never commits, pushes, publishes or deploys; the owner commits.

| Phase | What | Status |
|---|---|---|
| 32 | Foundation: server rendering and streaming, no theme flash, the logo, the chart drawn once, releases thinned, the repository page trimmed with avatars and search | **DONE**: 32 Playwright tests; layout shift 0.0000 on all ten pages measured (People 0.0589 before the fix in finding 6); no server function asked again after hydration on any of them; screenshots in both themes in `target/preview/site/phase32-*` |
| 33 | The Profile, first speed: `/u/<login>` from GitHub's API, stored copies, the viewer's token, the per-project breakdown, the new landing page | **DONE**: 7 vitest tests against GitHub answers written by hand, 4 Playwright tests (Profile, preview, failures, landing); the owner's, gaearon's and torvalds' Profiles screenshotted in both themes (`target/preview/site/phase33-*`); GitHub requests per cold view 18 to 104, per warm view 0 (finding 4); ADR-0023 |
| 34 | The Profile, second speed: Surviving Lines in the engine, per person and head; the Builder counts on request; Lines Changed per person; sections stream in | **DONE**: hand-worked `survival` fixture (Surviving Lines, Bulk Commits, ignored revisions) through gix and through the scripted fake; measured on ripgrep, facebook/react and rust-lang/rust (finding 3); over budget is "not counted" in the engine, the Builder and the page (tests); 265 Rust tests, clippy clean; 21 Builder, Site and UI tests added; the pipeline end to end in Playwright |
| 35 | You in this repository: `/u/<login>/<owner>/<repo>`, Standings, the Builder keeping pull requests and reviews, privacy and hiding, `/privacy`, MCP tools | **DONE**: access tests (a private repository's Standings refused without access, refused when GitHub's id differs, shown with access; a hidden person absent from Standings, Profile, engine numbers, MCP and Cards, still seeing their own); facebook/react's pull requests read in 1,414.6 s the first time (20,362 pull requests, 408 pages) and 1.5 s after; 48 Playwright tests |
| 36 | Cards: the pipeline, the set, animation, light and dark, the gallery, embeds with stored copies, a preview image on every page | **DONE, but the README embed needs the owner**: 16 SVG and 16 PNG snapshots; each Card drawn as SVG and PNG under 200 ms (39 to 135 ms warm in the dev server; tested); stored copies, stale-while-drawing and "reading" Cards tested; every page's preview image checked in Playwright. The embed in a real README on GitHub is in "Left for the owner" |
| 37 | Proof of Work: `/u/<login>/work`, filters, share link, Markdown and PDF | **DONE**: the owner's September 2026 checked against GitHub with the `gh` CLI (finding 3); private items absent from a public page and from a shared link unless chosen (vitest); 4 vitest and 2 Playwright tests, Markdown and PDF downloads among them |
| 38 | Versus and Rivals | **DONE**: fixture Profiles give the winners worked out by hand (pure function and through stored Profiles); a hidden Profile refused for Versus, its Card and its Profile (vitest and Playwright); 6 vitest and 2 Playwright tests; BurntSushi versus gaearon screenshotted in both themes |
| 39 | Archetypes and Achievements, each rule in `CONTEXT.md` and on the page | **DONE**: every rule tested at its edges on fixtures (17 vitest tests, a just-below and an at-the-line case for each threshold); a test keeps CONTEXT.md's wording equal to the code's; the oldest surviving line added to the engine with hand-worked fixture values; 265 Rust tests, clippy clean, 53 Playwright tests |
| 40 | Seasons, Races and Crews: invitations, acceptance, live Standings, recap and finish Cards | **DONE with stand-in accounts; real accounts need the owner**: end to end in Playwright with three signed-in accounts (alice, bob, carol) against the fake GitHub: a Race joined only by those who accept, live Standings and its Card; a Crew where leaving removes the person at once (checked in the page and the database); a hidden person never in it and never invitable; 4 vitest tests of the rules; 55 Playwright tests |
| 41 | People on the Leaderboards: top contributors per Season, per repository, with a time filter | **DONE**: three people boards (pull requests merged, pull requests reviewed, Surviving Lines) over the seed repositories or one of them, for This Season, Last Season, 90 days and all time; hidden people and `[bot]` accounts absent (2 vitest tests, 1 Playwright test); built from a real local seed night of 6 repositories (20,137 pull requests read) and screenshotted in both themes; the page answers in 80 to 100 ms |
| 42 | Wrapped 2026: a person's year across GitHub, as a page and a set of Cards | **DONE**: `wrappedOf` tested on a year worked out by hand; the owner's 2026 checked against GitHub by hand, every number equal; two Cards with snapshots; 1 Playwright test; screenshots in both themes |

### Build Run 4

The brief is `IDEA.md` (written 2026-09-25), with ADR-0013 to ADR-0019:
- a monorepo
- the web UI on Astryx
- commit search
- a hosted Site on Cloudflare's free plan
- a Builder on the owner's VPS
- encrypted Shared Reports
- GitHub sign-in through a GitHub App
- Leaderboards

The agent doing the work never commits, pushes, publishes or deploys; the owner commits.

| Phase | What | Status |
|---|---|---|
| 23 | Monorepo (ADR-0013): pnpm + Turborepo, `apps/local`, `packages/ui`, `packages/data`, the Data Source seam | **DONE**: 242 Rust, 8 vitest and 9 Playwright tests pass from the new layout; `cargo build` embeds `apps/local/dist`; `nix build` builds (10.1 MB); actionlint passes on both workflows |
| 24 | The browser interface on Astryx (ADR-0018), command palette, shortcuts, avatars | **DONE**: 13 Playwright tests pass, a keyboard-only walk among them; every screen in both themes on ripgrep in `target/preview/web/`; the embedded app 305 KB → 1,053 KB; canary charts tried side by side and not taken |
| 25 | Commit search (ADR-0019): subjects in the index, the Commit List, the Commits screen | **DONE**: hand-worked tests of subjects and the Commit List; types regenerated; facebook/react 35,275 commits, 1.5 MB gzipped, 13 ms a keystroke; rust-lang/rust 345,135 commits, 16.2 MB gzipped, 50 ms in a worker; cache schema 10 |
| 26 | The Site's foundation (ADR-0014): landing page, repository page, D1, rate limits, `/privacy` | **DONE**: 5 Playwright tests under `wrangler dev` (landing, a fixture's stored Report, `/privacy`, the API); every handler's CPU measured, 0.02 to 0.18 ms median |
| 27 | The Builder and public lookup (ADR-0015): `report --data`, clone policy, instant GitHub facts | **DONE**: on this machine against GitHub, ripgrep's Report on screen in 8.2 s and facebook/react's in 25.8 s (0.6–0.8 s after); not found, private, too big and timed out each say so (Playwright); full clones up to 100 MB |
| 28 | Sharing (ADR-0016): `commitscape share`, the Share button, `/s/` | **DONE**: end to end on this machine, CLI and Share button to browser; the key in no request (Playwright); a changed byte fails; expired answers 410 and the Cron Trigger removes it; built on Linux only (macOS and Windows are CI's) |
| 29 | GitHub sign-in (ADR-0017): `/me`, installations, access checks, webhooks | **DONE**: 8 Playwright tests against GitHub's responses written by hand (sign-in, `/me`, a private Build with an installation token, access asked and remembered five minutes, signed webhooks, retention, "Delete my data"); no test App on GitHub yet |
| 30 | Leaderboards: seed list, nightly budget, the boards | **DONE**: 53 seed repositories built on this machine against GitHub on the first night (median 26 s a Build, 45 min in all; torvalds/linux refused as too big), 107 after three more; the six boards written and screenshotted in both themes (`target/preview/site/`); bots answering issues and a 1,000-person cap found on the boards and fixed |
| 31 | Ready to launch: README, `DEPLOY.md`, security pass | **DONE**: README for the three ways and "What leaves your machine" rewritten; `DEPLOY.md` written and followed from scratch against local stand-ins (all its checks pass, `wrangler deploy --dry-run` 743 KiB gzipped); security pass: 4 medium and 7 low findings, all fixed with tests; every local check green (255 Rust, 49 vitest, 16 local and 22 Site Playwright tests, `nix build`, actionlint); CI itself runs when the owner pushes |

### Measured while planning Build Run 4 (2026-09-25)

On this machine, release build, cache under `target/`:

| Repository | Commits | Full clone | Partial clone (`--filter=blob:none`, HEAD checked out) | First analysis (`--json --no-lines --window all`) | Again, cached |
|---|---|---|---|---|---|
| BurntSushi/ripgrep | 2,287 | 6.3 MB | 2.9 MB, 2.9 s | 63 ms | 10 ms |
| facebook/react | 21,708 | 1.1 GB | 62 MB, 14.0 s | 1.39 s | 81 ms |

- **A bare partial clone fails.** It reports "failed while reading a file at HEAD": the head pass needs HEAD's blobs.
- **`commitscape report` fails on a partial clone.** It reports "failed while reading a blob for its lines": the line-count pass (ADR-0012) needs every old blob. ADR-0015's clone policy answers this.
- **ripgrep's Report from a full clone** took 263 ms and is 1.1 MB, 144 KB gzipped.

### Phase 8 measured numbers

```
cold-index-rust   24.0s   (n=1; Phase 1 range 23.1 to 26.9s; budget 60s)
```

Reading each message and author date in the walk's first pass costs nothing
measurable.

### Phase 11 measured numbers

`cargo xtask bench --filter first-paint`, as in Phase 7 (n=20, medians):

| Step | rust-lang/rust | Linux |
|---|---|---|
| Phase 7 interface | 51.2ms | 67.5ms |
| New interface, first version | 108.2ms | 185.5ms |
| The Map laid out after the first frame | 69.1ms | 118.5ms |
| Shared names counted without a String each | 63.1ms | 97.8ms |
| Ownership, languages and duplicates on their own threads | **55.1ms** | **77.4ms** |

What the first Window cost on Linux, measured part by part: the Map 61 to
100ms, Ownership 10 to 16ms, languages 9 to 13ms, suspected duplicates 4 to
11ms, everything else together about 15ms; counting shared names 27ms, and
3ms after.

---

## Environment

- Rust 1.98.1 stable. `gix` 0.87.1, `gix-diff` 0.67.1, `bincode` 2.0.1.
- Benchmark clone: `rust-lang/rust` at `../.commitscape-bench/rust`
  — **339,854 commits, 62,817 files at HEAD**, full history (not shallow), 1.5G.
  Override the location with `COMMITSCAPE_BENCH_REPOS`. With all refs it is
  345,135 commits.
- Benchmark clone: `torvalds/linux` at `../.commitscape-bench/linux`, full
  history, cloned with `--no-checkout` (the tool reads the object database, not
  the work tree). Used for ADR-0002's warm-start-at-every-scale budget.
- Machine for every number in this file: AMD Ryzen 5 3500, six cores, no SMT,
  16 GB RAM, SATA SSD.
- Fixtures: `cargo xtask fixtures --force` → `fixtures/` (gitignored).
- `cargo xtask` is aliased in `.cargo/config.toml` to a release build of the
  xtask crate.

---

## Phase 1 findings

1. **`gix`'s ergonomic tree-diff API is gated behind `blob-diff`.**
   `Tree::changes()` and `gix_diff::Rewrites`, the rename tracker, both
   require gix's `blob-diff` feature, which would compile blob diffing into a
   binary whose central performance decision is that the walk never touches
   blob contents. The walk now uses its own structure-only tree walk
   (`gix_source/tree_diff.rs`), which reads tree objects only.
2. **Exact renames are paired in the builder, not by gix.** A rename with
   identical content is a deletion and an addition sharing a blob id, so
   detecting it is an id comparison.
3. **A merge's diff against its first parent replays the merged branch.**
   Found by the `merges` fixture. Resolved by ADR-0007: merges record the
   combined diff, which is empty for a clean merge.
4. **Shallow clones have absent parent objects.** A missing parent reads as an
   empty tree, so a shallow boundary's whole tree becomes additions and the
   index is marked truncated. Caught by the `shallow` fixture.
5. **File identity depends on time order, and the walk is not in time order.**
   The first builder resolved renames while walking newest-first, and a rename
   overwrote the path lookup, so after `mv lib.rs lib_old.rs` plus a new
   `lib.rs`, the new file's path resolved to the old file. Identity is now
   resolved after the sort, oldest first, by `PathTable::record`: a rename
   frees the old path, and a file created there later is a different file.
6. **The frontier skipped commits but still walked their ancestors.** Resuming
   would have re-walked all of history. The walk now hides the frontier the
   way `git rev-list <tips> --not <frontier>` does, using gix's `with_hidden`.
7. **`identity()` walked all of history to find the root commit**, about 2.5s
   on `rust-lang/rust`, and it runs on every warm start. The cache key is now
   the git directory alone; a different project cloned to the same path is
   caught because none of the cached frontier commits exist in it.
8. **Refs that are not history.** `refs/stash`, `refs/notes/*` and
   `refs/original/*` were walked as if they were branches. Tips are now HEAD
   plus `refs/heads`, `refs/remotes` and `refs/tags`.

## Phase 2 findings

1. **On btrfs, renaming over an existing file forces the new file's data to
   disk first.** A 67 MB write took 45ms; the rename over the old file took
   1.2 to 4.4 seconds. ADR-0002's "write to temporary files and rename" put
   that on every update. ADR-0008 writes heads under new names and swaps a
   small pointer file instead.
2. **gix's hidden-commit walk paints from every hidden tip.** Hiding the
   frontier (every ref, including about 950 tags on Linux) made a resume with
   nothing new take 11 seconds on Linux and 2.4 on rust-lang/rust. The resume
   now stops at the first indexed commit on each path, using the stored
   commit ids; the same resume takes about 100ms.
3. **The mailmap was scanned rule by rule for every signature.** Linux has 989
   rules and 39,381 people; resolving took about 500ms. Rules are now indexed
   by lowercased email.
4. **A warm start must not touch git objects.** Peeling HEAD for the refs
   fingerprint and reading a no-checkout clone's committed `.mailmap` each
   opened the pack index, 20 to 60ms on a cold page cache. The fingerprint now
   hashes HEAD's stored target, and the committed mailmap is represented by
   HEAD's commit id, read only when it changed.
5. **One allocation per string made the author table the slowest thing to
   decode**: 15ms for Linux's 39,381 people. Its strings are now packed into
   shared buffers, and the head decodes its path, author and HEAD tables on
   separate threads.
6. **Rewriting everything per update wrote about 110 MB on Linux** and varied
   from 55 to 350ms with kernel writeback. The data file is now append-only
   (ADR-0008): an update appends the months it re-encoded and a run of new
   commit ids.

## Phase 3 findings

1. **Dividing by the maximum does not survive real repositories.**
   rust-lang/rust has a parser stress test whose Complexity Proxy is
   4,024,433, over a hundred times any real source file. Normalising by the
   maximum made every other hotspot score round to zero and ranked that test,
   changed once in a year, first. Hotspots now multiply percentile ranks, and
   `CONTEXT.md` says so. A test reproduces the case.
2. **`linguist-generated=false` does not mean a person wrote a file.**
   rust-lang/rust sets it on `Cargo.lock` so GitHub shows the lockfile's diffs.
   Lockfiles are therefore Generated whatever `.gitattributes` says; the
   attribute still overrides every other rule.
3. **Linux's largest files were AMD register maps**, 60,000 to 220,000 lines
   of `#define` with a comment naming each register and no generator marker. A
   C or C++ header whose code lines are at least 90% `#define` is now a
   generated table, and any text file over 100,000 lines is machine-produced
   (this also catches a 313,000-line HTML example in rust-lang/rust).
4. **Changelogs and release notes topped the largest files**, and a kernel
   documentation file was a hotspot. Indentation and size measure code, so
   there is now a Prose class (Markdown, reStructuredText, AsciiDoc, plain
   text, and extensionless files such as `MAINTAINERS`): counted for Churn,
   Ownership and Change Coupling, never a Hotspot or among the largest.
5. **Another project's checkout is vendored.** `t3code` commits whole
   repositories under `.repos/`, which dominated its largest files. A
   directory below the root with both its own lockfile and its own license
   file is now vendored; in rust-lang/rust this also covers subtree-synced
   projects such as `src/tools/rust-analyzer`, whose churn comes from
   upstream.
6. **Sorting 95,000 files to show ten cost 23ms of a warm start**, first
   because `Ordering::then` evaluated the path tie-break eagerly and then from
   sorting at all. Rankings return at most 1,000 rows, chosen by a linear
   selection.
7. **An update listed all 62,799 files at HEAD to find the 1,700 that
   changed.** HEAD is now updated by diffing the old HEAD tree against the new
   one; a changed `.gitattributes`, or a lockfile or license file appearing or
   disappearing, falls back to a full listing, since those can reclassify
   files that did not change. The first version fell back on every edit to
   `Cargo.lock`, which is most of rust-lang/rust's history.

## Phase 4 findings

1. **`CONTEXT.md` defined Bus Factor as "the Authors holding the majority",
   but the fixture literals contradict a 50% reading** (60% gives bus factor
   2). The only reading consistent with every literal is the fewest people who
   together hold more than 80%. The glossary now says that.
2. **`docs/fixtures.md` said the ownership fixture had 16 commits**; the
   generator makes 21. Corrected, with the root directory's worked value
   (bus factor 3) added.
3. **Carol displayed as `90210+carol@...`**, her most-used signature. Rule 3
   makes the plain address the canonical form, so the display now drops the
   numeric prefix, matching what the fixture document calls canonical.
4. **Staleness and Code Age look past the Window**, which a warm start does not
   load. Each file's first and last touch over all of history is now kept per
   file in the index and the cache head, updated by every resume.
5. **Linux has 7,602 suspected-duplicate groups and rust-lang/rust 997.**
   Formatting a `.mailmap` suggestion for each took 12ms, so suggestions are
   made for one group at a time (`Analysis::mailmap_for`). The panel for this
   hint will need paging.
6. **Ownership hashed every ancestor directory of every change as a byte
   string**: 15ms on Linux. Directories are now interned by parent and name,
   each touched file's directories resolved once, and (directory, person)
   pairs counted with one sort.

## Phase 5 findings

1. **Pairs rank by Jaccard degree, then shared commits.** On rust-lang/rust
   the top of the list is generated shell completions (`src/etc/completions/`)
   and blessed MIR test output, which carry no generator marker. That is what
   `linguist-generated` in `.gitattributes` is for; no rule was added for one
   repository.
2. **Coupling over all history is the one expensive Analysis**: 1.43 million
   pairs and 455ms on Linux. It is never on the startup path, which uses the
   90-day Window (1.8ms).

## Phase 6 findings

1. **`--json` ends its Window at the newest commit, not at the clock**, and
   loads with `Since::BeforeNewest`. It prints nothing machine-specific: no
   timings, cache paths or the path it was given. The document is
   byte-identical with no cache, a cold cache and a warm one, and across
   fixture rebuilds, which is what lets the golden files be compared byte for
   byte. The summary still ends its Window now, so the two can differ on a
   repository that has been quiet for a while. `CONTEXT.md` now says a Window
   ends at an anchor.
2. **Ownership was counted after the ranking cap.** Linux reported exactly
   1,000 directories at one year; there are 1,724. `Analysis::ownership` now
   returns the counts taken before the cap next to the ranked rows, as
   Coupling already did with its pair count.
3. **The summary left the root out of the bus-factor-1 list**, though one
   person holding the whole repository is the most important row it can
   show. It is now listed as `(root)` (`DirectoryOwnership::label`), which the
   TUI will use too.
4. **A Span serialises as its `--window` label** (`30d`, `90d`, `1y`, `all`),
   so the document echoes the flag it was given.
5. **The document's shape is the Rust types in `crates/commitscape/src/json.rs`**,
   whose field names are the schema. `schema` is bumped when a field is
   removed or changes meaning, not when one is added.

## Phase 7 findings

1. **A Staleness bucket could not list its own files.** `staleness().files`
   keeps the 1,000 stalest, so on Linux the "under a week" bucket would have
   opened onto nothing. `Analysis::stale_files(age)` ranks one bucket's files.
   Code Age kept only per-quarter totals; `Analysis::code_age_files` lists the
   files behind a quarter.
2. **Entering a number needs the commits behind it.**
   `Analysis::commits_touching(files)` returns the counted commits that
   touched every given file, which serves both a file's commit list and a
   coupled pair's shared commits; `Analysis::owners_of(file)` counts them per
   person.
3. **The interface keeps drawing while the rest of history loads.**
   `Rest::complete(recent)` returns a completed copy and leaves the recent
   index in use. Whether a Window is loaded moved to `Window::is_loaded`, so
   the interface can ask without building an Analysis.
4. **Scripted commit ids carried their number only in their last bytes**, so
   every abbreviated id read `000000000` and a snapshot could not tell commits
   apart. The number is now at both ends.
5. **A pseudo-terminal without a size draws nothing.** Under `script` with its
   input piped, every frame is 0 by 0. The smoke test sets
   `stty rows 30 cols 110` first; a real terminal always has a size.
6. **Two unit tests I wrote were below the signed-off seams** (number
   formatting and list scrolling). They were removed; both behaviours are
   covered through the render seam, since every snapshot formats numbers and
   one scrolls a list on an eight-row screen.

## Phase 8 findings

1. **A message is read once, as the walk reads its commit, and kept as a few
   bits.** Keeping Linux's messages until the index is built would cost about
   700 MB. `MessageFacts::read` is shared by both adapters, so the rules are
   written and tested once.
2. **Agents are recognised by their addresses and bot names, never by a bare
   word.** `noreply@anthropic.com`, `copilot@users.noreply.github.com`,
   `cursoragent@cursor.com` and the like: a developer named Claude is not an
   agent. Dependency bots are automation, not agents.
3. **Local Time uses the author date and the author's zone.** Committer time
   still orders history. A rebased or applied commit keeps when it was
   written (`author_delta`), so a team's rhythm is not the maintainer's.
4. **Schema 7.** Every cache rebuilds once.

## Phase 9 findings

1. **New Analysis methods**: `pulse(who)` (commits per day and per weekday
   and hour of Local Time, Commit Kinds, Agent Commits, streaks, the busiest
   day and hour), `contributors()`, `work_of(person)`, `languages()`,
   `totals()` and `code_map()` (every directory's lines, the Window's
   commits and top owner, for the treemap). All are in `--json`.
2. **Totals come from facts the index always holds** (the history span, the
   author table, HEAD), so the Overview's big numbers are right at first
   paint even when only 90 days of history are loaded.
3. **The Pulse counts every commit that is not a merge, Bulk Commits
   included**: it measures when work happened, not what it changed.
4. **Configuration and data (JSON, YAML, TOML, XML) are code but not a
   language**, as on GitHub. They count toward lines of code and are left
   out of the language bar.
5. **On real repositories:** 30% of `t3code`'s 7,610 commits were written
   with an AI agent, 1,447 of them authored by "Cursor Agent"; it has a
   112-day streak and a 492-commit day. `pixelactstudio` makes 45% of its
   commits on weekends and 39% at night. Its leaderboard lists "Dev Talan"
   twice, under two emails, which the People Panel will need to explain.

## Phase 10 findings

1. **ADR-0009: GitHub numbers come from the `gh` CLI**, one GraphQL query
   after the first frame, cached by `gh` for an hour. A new crate,
   `commitscape-forge`, knows nothing of git; `check-layering` keeps it so,
   and keeps the metrics crate from reaching it.
2. **One query takes 1.2 to 1.8 seconds** (rust-lang/rust is the slowest);
   repeated within the hour, 66ms.
3. **GitHub no longer lists stargazers through its API**: the connection
   reports zero even for rust-lang/rust. Star totals are available; star
   growth is not.
4. **`gh` gets `-f`, never `-F`**: `-F` reads a value starting with `@` as a
   file and turns numeric names into numbers.
5. **Tests**: remote URL forms, a response written by hand with its derived
   numbers worked out, and a real response recorded from pingdotgg/t3code.
   One ignored test asks GitHub live (`cargo test -p commitscape-forge --
   --ignored`).

## Phase 11 findings

1. **Nine screens**: Overview, Activity, People, Map, Hotspots, Coupling,
   Ownership, Age and GitHub, on keys 1 to 9. The Overview opens on the
   repository's name in a pixel font, its size and age, its language bar,
   commits over time, who writes the code, facts worth sharing and what is
   worth a look. Every screen explains itself in a sentence or two, `?`
   opens a help window with every term, and `/` searches a list.
2. **Colour has a job each.** People keep one of eight categorical colours,
   given out by all-time commits, on every screen; everyone else is grey.
   Magnitude uses one-hue ramps, blue for counts and age and orange for
   heat. Red, amber and green are kept for bus-factor status and always come
   with a symbol and a word. Every palette was checked with the dataviz
   validator against the `#1a1a19` surface; the first orange ramp failed its
   light-end contrast and was re-derived. Without truecolor the colours are
   mapped to the 256-colour palette each frame.
3. **A selected row keeps its colours** and gains a dark blue background and
   a bar at its left edge. Inverting it turned its bars into blocks of
   background.
4. **Percentiles are shown as Ranks.** "p94" meant nothing to the user; a
   Hotspot now says "the 2nd most changed of 40 files · the 3rd most nested
   of 120". `Hotspot` gained `churn_rank` and `complexity_rank`.
5. **A commit counts on its Landing Day.** t3code's 90-day chart reached back
   to April: rebased pull requests keep the date they were written, and the
   chart placed them there although the Window holds commits by when they
   landed. Days, streaks and active days now count the day a commit landed on
   its author's calendar; hours and weekdays still count when it was
   written. The `rhythm` fixture's worked values changed with it.
6. **A copy of another repository with its own `.github/` is vendored.**
   t3code keeps alchemy-effect under `.repos/`, with a lockfile but no
   license, so the lockfile-and-license rule missed it: 1.1 million lines,
   61% of what the Overview called the project's code. GitHub reads
   `.github/` only at a repository's root, so a folder with its own
   `.github/` and its own lockfile is a nested project. `CLASSIFIER_VERSION`
   is 5. t3code now reports 697,000 lines instead of 1.8 million.
7. **Two people sharing a name are told apart** by the start of their email
   (the login, for GitHub's noreply addresses), or by its domain when that
   is shared too.
8. **GitHub counts from the latest hundred pull requests and issues say so.**
   t3code's last hundred pull requests were opened in one day, so their chart
   draws days, not weeks, and a count of issues whose sample does not reach
   back a month reads "100+".
9. **The Map comes after the first frame**, from a background job, and says
   "Drawing the map…" until it arrives. The rest of the first Window's
   findings are computed on four threads.
10. **`cargo xtask preview <repo>`** drives the interface through key presses
    and writes every screen as SVG, and as PNG through headless Chromium, to
    `target/preview/`. The SVG exporter (`commitscape_tui::svg`) draws
    blocks, braille, squares and box lines as shapes, so it looks the same in
    any font; the Card will use it.
11. **On real repositories:** 31% of t3code's commits in 90 days were written
    with an AI agent, and "Cursor Agent" holds two of its folders alone;
    it had a 52-day streak and a 194-commit day, and its team commits at
    every hour of the week.

## Phase 12 findings

1. **`commitscape card [repo]`** reads all of history, asks GitHub unless
   `--offline`, and writes `<repository>-card.svg`, or `--out`'s path. It
   tells all of history unless `--window` says otherwise.
2. **The card is the Overview's story at a fixed size**, 120 by 36 cells:
   the name in the pixel font with GitHub's badges, the tiles, the language
   bar, commits over time, who writes the code, and six facts in two
   columns, framed and signed "made with commitscape". It is drawn by the
   same functions as the Overview, into an off-screen buffer.
3. **Over all of history, the tiles say what the counts do not**: commits
   a week, how few people made 80% of the commits (the repository's own Bus
   Factor), and active days out of the days there have been. acme: 0.6 a
   week, 2 made 80%, 57 of 701 days; t3code: 239 a week, 5 made 80%, 185 of
   228 days.
4. **The SVG keeps words together**: a run of characters in one style is one
   `<text>` with each character placed at its cell, so the card's text can
   be searched and copied and still keeps its shape in any font. Full
   blocks side by side are one rectangle, and touching box lines one path
   per colour and width. t3code's card went from 168 KB to 27 KB with no
   visible change.

## Phase 13 findings

1. **What went:** the index's agent detection (`message.rs` now reads the
   Commit Kind only, `message::kind_of`), the `AGENT` commit flag, the
   `agent` counts on `Pulse` and `Contributor`, `agent_commits` in `--json`,
   the People column "AI help", the person tile "with an AI agent", the
   Activity row, the Overview fact the Card also drew, the help entry and the
   Agent Commit term. The `rhythm` fixture's second commit lost its
   co-author trailer, so its id changed.
2. **Cache schema 8, JSON schema 2.** Every cache rebuilds once, so none
   keeps the old flag bit. The JSON bump follows decision 5 of Phase 6: a
   field was removed. pixelactstudio rebuilt in 127 ms; warm, 6 ms.
3. **Bots were never grouped before.** The review's "still grouped as bots"
   lands with identity in Phase 14 (ADR-0011); nothing about bots was
   removed here.

## Phase 14 findings

1. **Identity follows ADR-0011.** `identity::resolve_authors` takes
   `IdentityRules`: the mailmap, GitHub accounts by address, and the undos.
   Rules 1 to 3 group Signatures by an address key; rules 4 and 5 join
   groups with a union-find that records why (`PersonTraits::SAME_ACCOUNT`,
   `SAME_NAME`) and refuses to join groups that came out of one undo.
2. **Rule 3 keys on GitHub's account number.** maihs has Ryan under
   `46247385+ryandev2@` and `46247385+RyanLandDev@`: one account, renamed.
   The old rule keyed on the login and kept them apart. A bare
   `login@users.noreply.github.com` takes the number another Signature
   gives that login.
3. **Rule 4 needed GitHub in this phase, not Phase 17.** Ryan's Hotmail and
   university addresses join his account only through GitHub. The forge
   asks who authored up to three recent commits per address, in batches of
   a hundred (`forge::accounts`), after all of history is loaded; maihs's
   13 addresses took 2.3 s, once. Answers, misses included, are kept in the
   identity store so an address is asked about once.
4. **The identity store** (`cache::IdentityStore`) is two text files in
   the repository's cache directory: `accounts` and `kept-apart`. Their
   fingerprint, with the mailmap's and `identity::RULES_VERSION`, decides
   re-resolution, so a link, an undo or a rule change re-resolves people
   on the next warm load without reading history. Cache schema 9 stores
   each person's traits.
5. **On real repositories** (all of history): pixelactstudio shows one Dev
   Talan, 1,046 commits. maihs shows one Dev Talan, 2,306 commits, and one
   Ryan, 545, with "RyanLand" (65) suggested, not merged: GitHub links
   `ryanlandofficial@hotmail.com` to no account, and a one-word name that
   equals an old login is a weak signal (now a suggestion). IDEA.md's 984
   for Dev Talan is `git log HEAD` with merges; the tool counts every
   branch and leaves merges out (both addresses: 2,306; `git rev-list
   --no-merges` over the same refs agrees).
6. **Bots** (`[bot]`, `-bot`, `… Bot`, and a short list such as
   `github-actions` and `bors`) are people with `PersonTraits::BOT`.
   `Analysis::person_of` returns no one for them, so Ownership, Bus Factor,
   owners of a file and the Map's owners leave them out; `contributors()`
   and `bots()` split the list. Their commits still count as activity.
7. **`--json` resolves from the repository alone**: when the store holds
   links or undos, the document re-resolves without them, so it stays the
   same on every machine.
8. **The trust fixes.** `w` re-opens every open detail over the new Window
   once its findings arrive (`Target::among`), stopping at one the new
   Window lacks. The mouse clicks tabs, Windows, rows and Map blocks and the
   wheel scrolls, through targets each frame records. `Ownership::held_alone`
   drops a folder whose parent the same person holds; the Overview, the
   profile and the summary use it. `metrics::role_of` names dependency
   manifests and lockfiles, which "Works on" leaves out. The profile says
   "In 90 days, Alice made over 80% of the commits in these folders. If
   Alice left, few others would know them" and "30 of 34 commits". The
   Map's footer says "c colour by: activity / age / owner" with the current
   one bold.
9. **First paint, warm, after this phase** (`cargo xtask bench --filter
   first-paint`, n=20, nothing else running): rust-lang/rust median
   53.5 ms (min 49.9, max 70.3), Linux 69.5 ms (min 67.2, max 76.6). A first
   run with a build going on beside it measured 79 ms for rust-lang/rust,
   so these numbers need a quiet machine.
10. **Merges are shown on the profile**: "Merged 2 identities · same full
   name", each address with its commits, `u` to undo or redo, and the
   `.mailmap` lines that would make it permanent. The lines are shown, not
   written: the repository is the owner's, and the user's repositories here
   are read-only.

## Phase 15 findings

1. **ADR-0012: lines come from a second pass** after the first screen,
   `RepoSource::count_lines`: each non-merge commit diffed against its one
   parent with the walk's own tree diff, the two blobs of each changed file
   read, and lines counted with `imara-diff`'s Myers, git's default. The
   walk still reads no blob. `lines::line_pass` aligns the counts with the
   changes the index records by pairing renames exactly as the builder
   does, so an unchanged move is one change of 0 and 0.
2. **Measured cost** (`cargo xtask line-cost`, six cores, all history):
   rust-lang/rust 236,732 commits in 53 s (48 s through the binary), peak
   2.1 GB; Linux 1,371,396 commits in 195 s, peak 8.7 GB, most of it the
   memory-mapped pack, which the pass reads end to end. Bulk Commits are
   1.2% of rust-lang/rust's commits and 16% of its pass.
3. **Checked against git.** `cargo xtask line-cost --verify` compares every
   change with `git show --numstat --no-renames --diff-algorithm=myers`:
   98.7% of pixelactstudio's changes and 98.6% of t3code's newest 1,500
   commits' match exactly, totals within 0.11% and 0.89%. The rest are two
   equally short diffs lined up differently; imara-diff's Myers is not
   always git's. Two traps found on the way: this machine's git config sets
   `diff.algorithm=histogram`, and `git log --numstat` detects renames
   unless told not to.
4. **The line store** (`cache::LineStore`) is an append-only file keyed by
   commit id beside the cache, saved every 4,096 commits so a first pass
   resumes, and cut back to its last whole record after a crash. A
   commit's counts never change, so they survive a cache rebuild. Through
   the binary, over all of history: rust-lang/rust 48 s cold, and warm its
   7.7 MB store adds 0.18 s (0.76 s against 0.58 s without lines); Linux
   216 s cold, and warm its 35 MB store adds 1.1 s (3.17 s against 2.08 s).
5. **Counts fill `FileChange::lines` in memory**, and
   `CommitFlags::BLAME_IGNORED` marks the commits `.git-blame-ignore-revs`
   names; neither is written with history, since only `load` writes the
   cache and it runs first. `LinePass` lives in core so the interface can
   apply one.
6. **People views, side by side, no score:** `Analysis::contributions()`
   gives each person's commits, Lines Changed (added, removed, how many
   changes were and were not counted) and areas (folders that depend on
   them alone). Lines leave out merges, Bulk Commits, ignored revisions,
   lockfiles (`metrics::is_lockfile`) and Generated and Vendored files, by
   their class at HEAD or, for files gone since, by path
   (`metrics::looks_generated`). PRs and reviews need the full GitHub
   history of Phase 17 and join these views there.
7. **The interface** counts lines once all of history is loaded and says
   "counting…" until then; People gains "lines + / −" and "areas", the
   profile a lines tile. `--json` counts lines (and keeps them) unless
   `--no-lines`; each contributor gains `lines` (`null` when not counted)
   and `areas`.
8. **The `lines` fixture** (`docs/fixtures.md`) has a lockfile, a binary
   file, an exact move, a reformat named in `.git-blame-ignore-revs` and a
   Bulk Commit; its worked values are asserted through the real adapter:
   Alice +10 −2, Bob +13 −2, 214 and 35 over every counted change.
9. **First paint after this phase**: rust-lang/rust median 54.5 ms,
   Linux 71.3 ms (n=20). The first version computed each person's lines
   and Ownership again inside the first frame: 62.3 and 87.9 ms. Lines now
   run on their own thread beside Ownership, and areas are built from the
   Ownership already computed (`metrics::combine`).
10. **Bug caught by a snapshot:** the interface said "counting…" forever
   when no line counter was given, because the state moved before it was
   checked.

## Phase 16 findings

1. **Five screens**: Overview, Activity, People, Map, Risk, on keys 1 to 5.
   Hotspots, Coupling and Ownership became Risk (`ui/risk.rs`): Hotspots
   one line each in words, Change Groups, and knowledge silos with who
   could take each over. Age became the Map's age colouring and the
   Overview's "Code age" chart; the untouched files are one Enter from
   "Worth a look". The GitHub screen went: its pull requests and issues
   are in Activity's "Rhythm and GitHub", its stars in the Overview's
   badges. The five old screen files were deleted.
2. **New Analysis methods, hand-worked tests:** `work()` judges each commit
   from its files first (tests, docs, dependencies or CI only), then its
   Commit Kind; `commits_by_person(top)` splits commits over time among the
   top five and everyone else; `change_groups()` grows a group only with a
   file strongly coupled (Jaccard ≥ 0.5) to every member, at most eight;
   `silos()` names who else made the most commits in the nearest folder
   more than one person works in. Each has a `…_in` form taking what the
   interface already computed.
3. **Activity** stacks commits over time by person in each person's fixed
   colour, grey for everyone else, with a legend, and marks releases with
   `▾`: tags named like versions, pre-releases left out
   (`GixRepo::version_tags`), read after the first frame. Kinds of work
   are hidden when most commits can be told neither way (maihs).
4. **Facts only when unusual,** each against a stated bar (night ≥ 25%,
   weekend ≥ 30%, a day ≥ 5× a usual one with ≥ 10 commits, a streak ≥ 21
   days, twice as many fixes as features, a file in ≥ 20% of commits, a
   file ≥ 5,000 lines, untouched ≥ 3 years), and "Nothing unusual stands
   out" otherwise. acme now shows one fact.
5. **Themes** (`theme::Theme`, `--theme`, `t`): *terminal*, the default,
   maps text, surface, lines, people and states to the terminal's own
   sixteen colours so its theme applies, and keeps the magnitude ramps in
   24-bit colour, which sixteen colours cannot step; *dark* is the
   palette validated in Phase 11; *light* uses the reference palette's
   light steps, run through the validator on `#fcfcfb`: categorical all
   checks pass (worst adjacent CVD ΔE 9.1, normal-vision 19.6; three slots
   under 3:1, relieved by the names beside every colour), the blue ramp
   `#86b6ef…#0d366b` and the orange `#fc7856…#6e1a00` pass the ordinal
   checks. A theme recolours each drawn frame, so drawing code never knows
   which is on; the card and previews stay dark.
6. **First paint** after this phase: rust-lang/rust 52.0 ms, Linux 69.6 ms
   (n=20). On the way it reached 94.8 ms on Linux: judging each changed
   file's role took 8 ms (now on the Map's job, after the first frame),
   group counting scanned the Window once per group (one pass now), and a
   restructure made the main thread wait for Ownership before its own work
   (found by timing the Phase 15 binary beside this one).
7. **The terminal interface is frozen** from here: bug fixes only. New
   features go to the browser and the command line.

## Phase 17 findings

1. **`forge::history`** reads every pull request (with reviews and who
   merged it), issue (with its first answer from someone else) and
   release, a hundred to a page, in the order things last changed, and
   saves after every page in `github.json` beside the cache. ADR-0009 is
   amended with the design and these numbers.
2. **The page fetcher is a parameter,** so the tests serve pages written
   by hand: pages become records, an interrupted fetch resumes at the
   saved cursor, and a later fetch replaces a record that changed.
3. **Measured:** maihs (`MHS-Media-Software/maihs-software`, 319 pull
   requests) 9.9 s the first time; pingdotgg/t3code (9,294 pull requests,
   3,255 issues, 574 releases) 349 s the first time and 2.3 s with nothing
   new, 4.4 MB saved. A page costs one point of the 5,000 an hour, so time,
   not the rate limit, is what a big repository's first fetch runs out of.
4. **The resume gate:** t3code's fetch killed after 60 s had saved 2,300
   pull requests; the next run finished in 284 s with the same totals as a
   fetch that was never stopped.
5. **`commitscape github [repo]`** runs the fetch now, with progress, and
   says what is known and whether it stopped early. The browser (Phase 18)
   runs it in the background. The terminal interface, frozen, keeps the
   latest-hundred sample.
6. **Commits are linked to accounts by address** since Phase 14 (ADR-0011's
   rule 4); the history's logins are mapped to people through the same
   identity store.

## Phase 18 findings

1. **`commitscape-web`** serves the web app and a JSON API from the binary
   (ADR-0010). Like the terminal interface it reads an Index with the
   metrics crate; the binary hands it the rest of history, the line pass,
   GitHub's accounts and numbers, and the releases as functions, run in
   the background after the first answer. What they change is announced
   on `/api/events` (server-sent events) with a generation number, and the
   page fetches again. `check-layering` keeps it away from git, the index
   crate and the terminal.
2. **Security:** it binds `127.0.0.1` by default; every URL it prints
   carries sixteen random bytes as a token, which the first page load
   moves into an `HttpOnly; SameSite=Strict` cookie named for the port and
   drops from the address bar; every request's `Host` must be the address
   it listens on or `localhost` (and, with `--listen`, the machine's name),
   which stops DNS rebinding. The API tests speak raw HTTP to a real
   server: no token 401, a foreign `Host` 403 even with the token, the
   cookie, the meta, the overview, the event stream.
3. **Server-sent events are written to the connection itself** and flushed
   after each: `tiny_http` holds a streamed body in an 8 KB buffer, so the
   first event never left.
4. **TypeScript types are generated from the API types** (`ts-rs`, a
   dev-dependency only, so it never ships), and a test fails when
   `web/src/api/types.ts` drifts. `COMMITSCAPE_UPDATE_TYPES=1` rewrites it.
5. **The web app is built into the binary** by `build.rs` from `web/dist`;
   without a build it serves a page saying how to make one, so `cargo
   build` alone still works. `web/dist` and `node_modules` are not
   committed.
6. **Choosing the interface:** `--tui` and `--web` force one; `--listen`
   means the browser. Otherwise the browser when `$BROWSER` is set (VS Code
   and Cursor set it over Remote-SSH, and forward the port the opened link
   names), on macOS and Windows outside SSH, or with `$DISPLAY` or
   `$WAYLAND_DISPLAY`; else the terminal interface, which on quitting over
   SSH prints how to get the browser one. Port 7878 first, any free port if
   it is taken, `--port` to choose. Checked here: with `$BROWSER` set to a
   script, plain `commitscape` served and handed it
   `http://127.0.0.1:7878/?token=…`; with none, it opened the terminal
   interface; with `SSH_CONNECTION` set, `--web` printed `ssh -N -L
   7878:127.0.0.1:7878 dev24k@carbon`. VS Code itself was not available
   on this machine to try.
7. **Usable within a second, warm** (`web/scripts/first-chart.mjs`: the
   command to its first chart in headless Chromium, medians):
   pixelactstudio 243 ms, rust-lang/rust 490 ms (n=7), Linux 385 ms (n=5).
   One early rust-lang/rust run took 23 s: its cache had been rewritten
   after the measuring script, while buggy, killed servers as they loaded;
   I could not pin down which write it was. Every warm run since has been
   under 0.7 s.
8. **The web app** (`web/`, Vite, React 19, TypeScript strict): the name,
   Window switcher, tiles, commits per day and who writes the code, reading
   `/api/overview` and following `/api/events`. `npm run typecheck`, `npm
   run lint` (oxlint) and `npm test` (vitest) pass.
9. **A terminal interface bug fixed on the way:** when lines arrived, the
   screen blanked to "Computing the findings…" and back; lines change no
   one's identity, so the findings on screen now stay until the new ones
   replace them.
10. **New dependencies:** `tiny_http` 0.12 (a small blocking HTTP server;
    brings `ascii`, `chunked_transfer`, `httpdate`); `getrandom` 0.3,
    already in the tree, for the token; `ts-rs` 12, for tests only. In
    `web/`: `react`, `react-dom`, and for development only `vite`,
    `typescript`, `oxlint`, `vitest` and `@playwright/test`, which drives
    the system's Chromium and downloads no browser.

## Phase 19 findings

1. **Five browser screens**, the same five as the terminal's:
   - **Overview**: tiles, the project's story as Moments on a line with the
     same Moments in words beneath it, commits over time with releases
     marked, who writes the code, unusual facts, Worth a look, languages and
     code age.
   - **Activity**: commits by person, stacked (the five with most, then
     everyone else) with releases marked; pull requests and issues a week
     from GitHub's whole history; the week by hour; kinds of work.
   - **People**: one table, a column per measure and no single score, with a
     profile per person (their days, their week, their files, the folders
     that depend on them, the addresses joined into them, undo and redo of
     the merge, and the `.mailmap` lines to copy).
   - **Map**: a zoomable treemap of HEAD, coloured by how often, when last,
     or who; a click on a file opens its details and draws a line to each
     file that changes with it.
   - **Risk**: files as dots, how often changed against the Complexity
     Proxy, with the top quarter of both shaded; hotspots, groups of files
     that change together, and folders one person holds.
2. **The API grew to seven data answers** (`overview`, `activity`,
   `people`, `person`, `map`, `file`, `risk`), each over a Window or a date
   range (`from`, `to`) and a filter (`person`, `folder`). A filter is an
   Index narrowed to the person's commits and the folder's changes
   (`commitscape-web/src/filter.rs`), so every metric applies unchanged.
   Undo and redo are `POST /api/person/{undo,redo}`; the card is
   `/api/card.svg`, drawn by the terminal's card code and turned into a PNG
   in the browser (a canvas), as ADR-0010 planned.
3. **`commitscape report`** writes the app into one HTML file with its
   answers inlined for every Window: 895 KB for maihs. The page reads them
   from `window.__COMMITSCAPE__` by the same keys it would ask the server
   with. What was not written (deeper folders, a file's details, filters)
   says it needs the live interface.
4. **Themes**: follow the system, Light, Dark, and Midnight (a darker
   surface, `#0d1117`). Every series and ramp was run through the palette
   validator on its own surface: the dark series pass on both dark
   surfaces; the light series carry a contrast warning on the light surface
   (as in Phase 16), met by the labels and the table view under every
   chart. The dark ramps run from dark to light (`#1c5cab` to `#cfe2fa`,
   `#a42602` to `#ffd2c2`), validated as ordinal. A warm "paper" theme was
   tried and dropped: its blue ramp's light end failed the 2:1 floor.
5. **`?` shows what every number means**, under the number, and hides it
   again. Every chart has a legend when it has two or more series, a
   tooltip on each mark, and "Show the numbers" for a table. Unknown numbers
   are "—": lines before they are counted, pull requests before GitHub is
   read, and now also for people GitHub has no account for (they showed 0
   before).
6. **Fixed from the screenshots:**
   - "May be one person" put nine people in one group on t3code: everyone
     whose address starts `me@`. Local parts like `me`, `hello` and
     `contact` now say nothing. (A cap on how many may share one was tried
     and dropped in review: it would hide one person's four addresses.)
     `RULES_VERSION` is 2, so caches re-resolve once. maihs still suggests
     Ryan and RyanLand.
   - Risk said "deepest nesting"; the Complexity Proxy is every line's
     indentation level added up, and the screen now says so.
   - One bot under four addresses was four rows; bots are grouped by name.
   - The Map was blank when opened straight to a folder: its width was
     measured before the element existed. The width hook is a callback ref.
7. **Fixed in review:**
   - A folder filter narrowed a Bulk Commit to its few changes in the
     folder, so it stopped counting as one. The filter now marks it with
     an in-memory `CommitFlags::BULK`, which the metrics honour.
   - A filter's totals need all of history; until it is read, a filtered
     request says so (409) rather than showing the loaded part as the
     whole.
   - The story said everyone who committed in a short Window "made their
     first commit". A Moment for joining is now someone's first commit
     ever, and the first commit is told only when the Window holds the
     project's first. Both need all of history, so they appear once it is
     read. A second hand-worked test covers a Window that starts later.
   - The commits tile counted merges while saying it did not.
   - An undo while GitHub's accounts arrived could write over them; people
     now change under the lock, and a change copies the Index only while a
     request still holds the old one.
   - The folder box could put back a filter already cleared; "stopped
     early" and "unavailable" GitHub reads were worded as still reading.
   - A filter built the Index from a full copy it threw away; it now
     copies only what it keeps.
8. **Budgets.** Every answer takes 10 to 115 ms on rust-lang/rust (the Map
   the slowest). The first chart went from 490 ms (Phase 18) to 850 ms,
   because the page is bigger and it waited for the first event before
   asking for anything. The server now writes its state into the page it
   serves, and the filters' lists are asked for only when someone reaches
   for them. Medians over 7 runs, warm: **rust-lang/rust 740 ms, Linux
   459 ms, pixelactstudio 314 ms** (budget 1 s).
9. **Identity checks on the real repositories** (1 year Window):
   - maihs: Dev Talan once, 2 addresses, 2,301 commits (all of history,
     every ref: 2,306); Ryan once, 4 addresses, 544.
   - pixelactstudio: one Dev Talan.
10. **Tests.** The pre-agreed seam for the screens is Playwright against a
   fixture: 8 tests on `ownership` (`web/e2e/`) cover the totals and people,
   both filters, a profile's addresses, entering a folder on the Map, `?`,
   a theme that is kept, the card saved as a PNG at twice its size, and a
   report opened from a file. The HTTP API
   tests and the type drift test changed with the API.
11. **Screenshots**: `target/preview/web/<repository>/`, every screen and a
    profile and a file on the Map, in Dark and Light, plus the Overview
    with `?` on. Made by `web/scripts/screens.mjs`, which waits for the
    history, the lines and GitHub first.

## Phase 20 findings

1. **`check`** (`Analysis::forgotten`) reads each changed file's last 10
   focused commits (merges, Bulk Commits and commits of more than 20 files
   left out; a squashed pull request says little about any two of its
   files) and names what 8 of them in 10 also changed: a file still at
   HEAD, or a file somewhere in a folder (a new migration each time),
   never a lockfile or a generated file. A file with fewer than 5 such
   commits says nothing. It reads what is staged by default (the index
   file against HEAD, through gix), `--branch BASE` (merge base to HEAD),
   `--pr N` (the pull request's files through `gh`) or `--commit REV`
   (against the history before it). Text, `--format markdown` for a
   comment, or `--format json`; `--strict` exits with 1.
2. **Found in real history.** `scripts/check-replay.sh` runs
   `check --commit` over a repository's recent commits and prints each
   file it flagged that the same author changed within their next three
   commits: a file forgotten, then remembered. With the final thresholds
   (saved in `target/preview/check-replay-*.txt`):
   - maihs: 32 files flagged in 192 commits, 10 of them changed next. For
     one, `a7825b2f` changed `src/lib/security/__tests__/api-access.test.ts`
     without `src/lib/security/api-access.ts` (5 of 5 before it had both),
     and `2545c384`, the next, changed it.
   - t3code: 76 in 300, 12 changed next. For one, `3d74474f6` changed
     `apps/web/src/themePalette.ts` without its test (5 of 5), and
     `0a7c662d3` did.
   - pixelactstudio: nothing flagged in 168 commits.
   The first thresholds (7 in 10, every commit) flagged 313 files in 300
   t3code commits; the bar was raised so it stays quiet.
3. **The GitHub Action** (`actions/check/`) checks out all of history,
   runs `npx commitscape check --branch origin/<base> --format markdown`
   and keeps one comment on the pull request up to date, deleting it when
   nothing looks forgotten; `strict: true` fails the check. It cannot run
   until commitscape is on npm (Phase 22); its YAML was parsed and its
   script passes shellcheck.
4. **`who <path>`** (`Analysis::who`) orders people by their commits to a
   file or folder, each counting half as much for every 180 days of age,
   and shows their commits there and when they last changed it. Anyone
   whose last commit anywhere is over 90 days old is "last seen …", and
   when that is the first person, the first who still commits is named
   instead. On maihs, `src/app/api/`: Ryan (194), Dev Talan (249), San Choo
   (167, last seen 3 months ago), and so on.
5. **`health <github-url>`** keeps a partial clone (`git clone
   --filter=blob:none`: all of history and trees, and file contents only
   for HEAD, which the checkout fetches in one go) under the cache
   directory's `health/<owner>/<name>`, and updates it next time.
   `Analysis::health` gives the Maintainers (3 or more commits in the last
   90 days), the Bus Factor over the last year's commits, releases in the
   last year with the median gap and the days since the last, how many of
   the last 100 issues got a first answer from someone other than their
   author and how fast (the median), and the last 90 days against the 90
   before. It draws the card too. On BurntSushi/ripgrep: alive, Bus Factor
   6, 3 releases in the year, 77 of 100 issues answered, typically within
   5 hours; the clone is 6.6 MB.
6. **GitHub's one-shot query** now asks each of the last 100 issues for
   its author and first five comments, so `health` needs no second query;
   tested on a response written by hand.
7. **A median of an even list is now the mean of its two middles** in
   `health`: with two gaps the upper one said "typically 8 months apart" of
   three releases in a year.
8. **Fixed in review:**
   - A submodule, and a sparse checkout's folder, always looked staged.
   - `check` and `who` failed below a repository's top folder; they now
     look for the repository upwards (`GixRepo::discover`), and `who`
     takes a path that no longer exists.
   - A bot's welcome counted as an issue's first answer; comments by a
     `Bot` account (or a `[bot]` login) no longer do.
   - `check` could name a folder that is no longer at HEAD; it stops
     reading history at a file's tenth commit, and orders what it found by
     the evidence it keeps (more commits together, then fewer read).
   - The Action failed on a pull request from a fork, whose token cannot
     comment; the step summary says it instead, and only `strict` fails.
   - `health ../..` would have cloned into the cache's parent: an owner
     and a name must be names GitHub allows. When GitHub gave nothing,
     `health` now says why.
9. **A slip of mine, repaired:** two runs without `COMMITSCAPE_CACHE_DIR`
   wrote to `~/.cache/commitscape`: one created a cache for t3code there,
   now deleted, and one added an index to the owner's maihs cache there,
   now removed with the cache pointed back at the index it had before.

## Phase 21 findings

1. **`wrapped [folder]`** finds every repository under a folder (four
   levels down, not inside one found, nor in `node_modules`, `target`,
   `dist`, `build`, `vendor` or hidden folders; empty repositories are
   passed over). "You" are every person with one of your addresses: git's
   `user.email` in any of the repositories, `--email`, and every address
   joined to one of those in any repository (a GitHub account or a
   `.mailmap` there, ADR-0011), until no new one turns up. A name alone is
   not enough, since people share names; addresses committing under your
   name that are not yet you are printed as `--email` suggestions.
   `Analysis::year_in` gives each repository's part, on the author's own
   clock for days and hours alike; `wrapped()` joins them, so a streak or a
   busy day can cross repositories. A commit is counted once, so a clone or
   a worktree adds nothing. Only your commits of the year are line-counted
   (`line_pass_where`), and kept in the line store.
2. **The owner's 2026 across `~/code`** (17 repositories found, 2 empty;
   13 of the 15 with their commits; `target/preview/wrapped/`): 3,010
   commits on 222 days, 950,867 lines added and 383,301 removed, a 29-day
   streak from 7 April, the busiest day 18 July with 137 commits, 830
   commits (28%) between 22:00 and 05:00; maihs 1,677, pixelactstudio 885,
   env-helper 147, vidcastx 120; TypeScript 508k lines, JavaScript 102k,
   Rust 34k. Git's `user.email` is the owner's GitHub noreply address; the
   other address was joined through the GitHub account maihs links. It
   takes under a second with warm caches.
3. **The page** is the web app with the year written into it
   (`window.__COMMITSCAPE_WRAPPED__`): tiles, the year as a calendar and as
   columns, where and in what, the hours with the night shaded and
   labelled, and the card, saved as a PNG with the same button as the
   browser interface's. The card is SVG drawn in Rust in the validated
   dark palette (`commitscape-web/src/wrapped_card.rs`), 1,200 by 630: one
   series a chart, every bar with its number. A Playwright test checks the
   page on the `ownership` fixture: Alice's 2024 is 10 commits on 10 days.
4. **The README card Action** (`actions/card/`) redraws the card with
   `npx commitscape card` and commits it as `github-actions[bot]` when it
   changed. Its first design committed every run: the card's own commit
   changed the next card. It now skips when nothing was committed since
   the last card. Simulated twice against a local bare remote: one commit,
   then "nothing has been committed since". Like the check Action it needs
   commitscape on npm (Phase 22).
5. **Fixed in review:** a commit was placed in the year by UTC but on a
   day by its author's clock, so days either side of New Year could count
   and not be drawn; the year is now read on each commit's own clock. Also
   fixed: clones and worktrees counted twice, a blank name for a repository
   run from inside, "Your's", a colleague of the same name counted as you,
   repositories that could not be read left out without a word, the card's
   "1000k", and a 30-day card left stale by the Action (only an all-of-
   history card now waits for a new commit). Left as it is: every
   repository is read from its cache for the year only, but a first run
   still walks its whole history once to build that cache.

## Phase 22 findings

1. **npm (ADR-0003).** `cargo xtask npm --binary <platform>=<path>… [--pack]`
   writes `@commitscape/<platform>` for each binary given (its binary and
   the two license files, with npm's `os`, `cpu` and, for Linux x64,
   `libc`) and `commitscape`, the starter, which depends on all six at
   exactly the workspace's version. The starter
   (`npm/commitscape/bin/commitscape.js`) picks the package for the
   platform (musl by its loader file, which is quicker than asking Node's
   process report), and says plainly when it was not installed.
2. **The starter's cost.** Starting the binary as a child cost 36 ms
   (Node's own start is 21 ms, and `spawnSync` 12 more). Where Node has
   `process.execve` (22.15, 23.11 and on) the starter becomes the binary
   instead: 25 ms, median of 30. The terminal interface's first screen
   through npm is then about 77 ms on rust-lang/rust and 95 ms on Linux
   (52.0 and 69.6 ms measured in Phase 16, plus 25), inside 100 ms. On an
   older Node it falls back to the child, and Linux would be about 106 ms.
3. **On a clean machine.** From the packed tarballs, in fresh
   `node:22-bookworm-slim` (no git installed) and `node:22-alpine`
   containers: `npm install` took only the platform's package, and
   `npx commitscape --version`, `--summary`, `who` and `--web` (its first
   request answered with the redirect that keeps the token) all ran on a
   copy of a fixture. The binary tried was the static musl build packed
   under both Linux x64 names: a NixOS build of the glibc binary points at
   the Nix store's loader. The release builds the glibc one on Ubuntu
   22.04. It exposed one bug, fixed: `who alpha --repo X` read `alpha`
   from the current folder.
4. **The binaries.** A `dist` profile (the release one, stripped, no debug
   information) makes an 8.6 MB static musl binary with the web app inside,
   3.8 MB packed. Warm, on rust-lang/rust, `--summary` takes 45 ms with it
   against 42 ms with the glibc release build, so musl's allocator needs no
   replacing.
5. **The release** (`.github/workflows/release.yml`, on a `v*` tag that
   must match the workspace version): the six targets on their own runners
   (Linux x64 glibc on Ubuntu 22.04 for an old glibc; musl x64 and ARM;
   macOS Intel and Apple; Windows), the web app built first; then the
   platform packages published, `commitscape` last, with provenance; then
   a GitHub release with a tarball per target, `SHA256SUMS`, and the
   Homebrew formula written by `scripts/homebrew-formula.sh`. CI
   (`.github/workflows/ci.yml`) runs every check and the Playwright tests.
   Both pass actionlint (with shellcheck); neither has run on GitHub.
6. **Homebrew**: the formula installs the release's prebuilt binary on
   macOS and Linux, Intel and ARM; it needs a tap repository
   (`homebrew-commitscape`) to live in.
7. **Nix**: `flake.nix` builds the web app with `buildNpmPackage` and the
   binary with `rustPlatform.buildRustPackage` from nixos-unstable (Rust
   1.98.1; the system's nixpkgs has 1.95, too old). `nix build` took 6
   minutes here, and the result serves the web app. Its tests are left to
   CI, since they need fixtures written with git.
8. **The README** is rewritten for people meeting the tool: the card,
   `npx commitscape`, a GIF of each interface, what each screen shows, the
   four questions, SSH, sharing, and what leaves the machine. The GIFs
   (`docs/media/`) show BurntSushi/ripgrep, a public repository, never the
   owner's private ones. They were made from frames: `web/scripts/demo.mjs`
   tours the browser interface and `cargo xtask preview` renders the
   terminal's screens, then ffmpeg (from nixpkgs, not a dependency). The
   card at the top is commitscape's own, where `actions/card` would keep
   it. The license files the manifests name were added.
9. **Fixed on the way:** offline, with no GitHub history saved, Activity
   drew empty pull-request charts saying "none in this window"; it now
   says GitHub's history is not read here.
10. **Fixed in review:**
    - I had written `.github/workflows/ci.yml` over the existing one
      without reading it first, dropping its three-OS test matrix, its
      walk-against-git check and its cache. It is restored as it was, with
      the web job added.
    - npm would refuse a published package's provenance with no
      `repository`: `cargo xtask npm --repository` writes it, and the
      release passes the repository it runs in, as it now does to the
      Homebrew formula.
    - The starter: interrupted on its fallback path it exited 0, where it
      now dies of the same signal (130 on Ctrl-C, checked on both paths);
      a glibc system with musl installed looked for the musl package; a
      binary that cannot run is no longer handed to `execve`, whose failure
      cannot be caught; an unsupported platform is pointed at building from
      source, not at crates.io, where commitscape is not.
    - The version comes from Cargo (`CARGO_PKG_VERSION`, `cargo pkgid`),
      not a hand-read Cargo.toml; every script finds Chromium as the
      Playwright config does.

## Phase 23 findings

1. **The layout (ADR-0013).** `web/` is now three pieces of a pnpm
   workspace, run through Turborepo:
   - `apps/local`: the page the binary embeds. It only picks the Data
     Source and renders the screens.
   - `packages/ui`: every screen, chart and component, moved as they were.
   - `packages/data`: the generated API types, the Report format and the
     Data Sources, with no React in it, so the Site's Worker and the
     Builder can use it too.

   The two packages are used as TypeScript source (`exports` points at
   `src/index.ts`), so they have no build step of their own: Vite compiles
   them into the app. Shared versions are pinned once, in
   `pnpm-workspace.yaml`'s `catalog:`.
2. **The Data Source seam.** `packages/data/src/source.ts` has the one
   interface every screen reads through: `get`, `card`, `listen` and an
   optional `changePerson`, with three makers:
   - `serverSource(meta)`: the local server, as before.
   - `reportSource(report)`: an inlined Report (`window.__COMMITSCAPE__`).
   - `fetchReport(url, { decrypt })`: downloads a Report, decrypts it if
     it is a Shared Report, undoes gzip when the bytes are gzipped, then
     reads it exactly like an inlined one.

   The screens get it from React context (`SourceContext`, `useSource`,
   `useData` in `packages/ui/src/data.ts`) and no screen calls `fetch`.
   The People profile shows "undo the merge" only when the source has
   `changePerson`. Five vitest tests cover the seam, including a fetched,
   gzipped and "decrypted" Report.
3. **The name and origin constants** are in `packages/data/src/product.ts`:
   `PRODUCT = "commitscape"` and `SITE_ORIGIN = "https://commitscape.invalid"`.
   No domain is bought, so the origin is a name that can never resolve
   (see "Open questions for the owner").
4. **Rust changes, in plain words.** Three paths moved and nothing else:
   - `crates/commitscape-web/build.rs` embeds `apps/local/dist` instead of
     `web/dist`;
   - `src/assets.rs`'s "not built" page says `pnpm install && pnpm build`;
   - the types test in `src/api.rs` writes and compares
     `packages/data/src/types.ts`.
5. **Versions.** pnpm 12.6.0 (pinned by `packageManager`), Turborepo
   2.11.4; everything else as it was (React 19.3.0, Vite 8.3.1, TypeScript
   6.0.3, vitest 5.0.1, Playwright 1.63.0, oxlint 1.85.0). TypeScript 7
   is out but was left for a separate, deliberate upgrade. pnpm 12 refuses
   to install a package whose install script nobody decided on;
   `pnpm-workspace.yaml`'s `allowBuilds` says no to Astryx's, which only
   prints a nudge to run `astryx init`. pnpm 12 also holds back packages
   published in the last day: it wrote Turborepo's platform packages into
   `minimumReleaseAgeExclude`.
6. **CI and release.** Both workflows use `pnpm/action-setup@v6` (which
   reads `packageManager`) with Node 24. The web job runs `pnpm install
   --frozen-lockfile`, `pnpm check` (Turborepo's typecheck, lint, test and
   build), builds the binary, then Playwright from `apps/local`. The
   release builds only the local page (`pnpm --filter @commitscape/local
   build`). actionlint (with shellcheck) passes on both. Neither has run on
   GitHub yet.
7. **Nix.** `flake.nix` builds the web app with nixpkgs' `fetchPnpmDeps`
   and `pnpmConfigHook` (pnpm 12, fetcher version 4), fetching only what
   `@commitscape/local` and its packages need, from a source filtered to
   the TypeScript workspace so a Rust change does not rebuild it. The
   binary is now built with the `dist` profile, as npm and Homebrew's are
   (Decision 36): `nix build` gave a 10.1 MB binary that serves the app.
   The dependency hash is `sha256-UlfKRiriCZnSzAIxZNgsNtwKqIxkoDriCxElvxhbFSA=`
   and changes whenever the local page's dependencies do: build once with
   `pkgs.lib.fakeHash` and copy the hash Nix prints.
8. **Measured.** Every existing test passes from the new layout: 242 Rust
   tests, 8 vitest tests (3 moved, 5 new), 9 Playwright tests. The
   embedded app before Astryx: 304,636 bytes in `apps/local/dist`, its
   script 284,793 bytes (87,124 gzipped) and its styles 9,860 bytes (2,856
   gzipped).
9. **This machine.** `/home` (and `/nix`, `/tmp`) had 2.3 GB free, and it
   is btrfs with snapshots, so deleting files there frees nothing. The
   build kept everything big on `/srv/bulk`:
   - `target/` in this worktree is a symbolic link to
     `/srv/bulk/datasets/commitscape-br4/target` (git ignores it);
   - pnpm's store and its packages live in
     `/srv/bulk/datasets/commitscape-br4/pnpm-store`, linked into
     `node_modules` (a machine setting passed through the environment, not
     written into the repository).

   `nix build` needs about 1 GB in `/tmp`, so it ran with a guard that
   would stop it below 400 MB free.

Files created, changed or deleted in Phase 23:
- Moved: `web/` → `apps/local/` (`index.html`, `public/`, `e2e/`,
  `scripts/`, `playwright.config.ts`, `README.md`); `web/src/*` except
  `main.tsx` and `api/` → `packages/ui/src/`; `web/src/api/types.ts` →
  `packages/data/src/types.ts`.
- Deleted: `web/package-lock.json`, `web/src/api/client.ts`,
  `web/src/api/useData.ts`, `web/.oxlintrc.json` (now `.oxlintrc.json`).
- Created: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
  `turbo.json`, `tsconfig.base.json`, `.oxlintrc.json`;
  `apps/local/package.json`, `src/main.tsx`, `tsconfig.app.json`,
  `tsconfig.node.json`, `vite.config.ts`, `README.md` (rewritten);
  `packages/data/{package.json,tsconfig.json,vitest.config.ts}` and
  `src/{index.ts,product.ts,source.ts,source.test.ts}`;
  `packages/ui/{package.json,tsconfig.json,vitest.config.ts}` and
  `src/{index.ts,data.ts}`.
- Changed: `packages/ui/src/App.tsx` and `screens/People.tsx` (the Data
  Source), every screen's imports; `apps/local/e2e/serve.ts` (the root
  path); `crates/commitscape-web/build.rs`, `src/assets.rs`, `src/api.rs`;
  `.github/workflows/ci.yml`, `release.yml`; `flake.nix`; `.gitignore`;
  `.gitattributes`; `README.md`; `STATE.md`.

## Phase 24 findings

1. **Astryx under Vite, without its compiler.** `@astryxdesign/core`,
   `@astryxdesign/theme-neutral` (both 0.6.3) and `@stylexjs/stylex`
   (0.19.1) are pinned exactly in `packages/ui`. Astryx's precompiled
   `reset.css` and `astryx.css` are imported first in `index.css`; they sit
   in cascade layers, so every rule of ours is scoped to our own classes
   (an unlayered `button {…}` would override Astryx's buttons). No StyleX
   compiler: we style our parts with `className` and Astryx's CSS
   variables, never `xstyle`. `astryx init` and `swizzle` were never run;
   the CLI's read-only `component` and `docs` commands were used to read
   the API. pnpm is told not to run Astryx's install script, which only
   prints a nudge to run `init`.
2. **One theme.** `commitscapeTheme` (`packages/ui/src/theme.ts`) is
   `defineTheme` extending Astryx's neutral theme (its system fonts and
   Lucide icons) with our blue as the seed (`#2a78d6` light, `#3987e5`
   dark) and warm greys. Modes: system, light, dark; Midnight is gone. The
   charts' eight series colours and two ramps keep the values validated in
   Phase 19, written once with `light-dark()`, so they follow whichever
   mode Astryx's `Theme` sets on the page.
3. **What is on Astryx now.** The shell is `AppShell` with `TopNav` (the
   repository's name, "Jump to…", Help, the theme `Selector`, "Save the
   card"); screens are a `TabList`, Windows a `SegmentedControl`; the
   filters are `Selector` (people, with search), `TextInput` (folder) and
   `DateInput` (dates); every figure and number tile is a `Card` with a
   `Heading`; the People and Hotspots tables are Astryx `Table`s (People's
   columns sort through its sortable plugin); profile and file buttons are
   `Button`s; avatars are `Avatar`; key hints are `Kbd`; "Save the card"
   reports a failure as a `Toast`. The screens' own `<main>` became a
   `div`, since `AppShell` already renders the page's one `main`.
4. **Charts stay ours.** `@astryxdesign/charts@0.6.3-canary.ca469c7` was
   tried on ripgrep's data in a throwaway app outside the repository (it
   needs a canary build of Astryx core, not the pinned 0.6.3). Side by side
   (`target/preview/web/charts-side-by-side/side-by-side-{light,dark}.png`)
   it cut the first digits off its y-axis labels (`0,000` for 50,000),
   wrote dates as `2025-09-25`, and has nothing for release marks, stacking
   by person or a table of the numbers. Its curved lines are nicer. Not
   plainly better, so ADR-0018's rule keeps ours, restyled with Astryx's
   tokens (surfaces, text, borders, radii, the popover for tooltips).
5. **⌘K.** The command palette (`CommandPalette`) jumps to a screen, a
   person in the Window, a folder or file from the Map's first two levels,
   or a Hotspot. Its list is asked of the Data Source when it opens, so it
   works in a Report too; a query typed before the list arrives is answered
   when it does. Enter with nothing highlighted takes the first match, as
   npmx.dev does (Astryx's palette needs an arrow key first; we catch the
   Enter).
6. **Keys.** `1`–`5` screens, `/` and ⌘K/Ctrl+K the palette, `w`/`W` the
   next and previous Window, `?` help, Esc closes help or the file panel.
   All are off while typing in a field, except ⌘K. `?` shows the list of
   keys above the screen, every number's explanation, and outlines every
   key hint on screen (`.keys-on`). The Map's blocks are now focusable and
   open with Enter, so every screen can be used without a mouse.
7. **Avatars (Rust change, in plain words).** Every person in the API now
   carries their GitHub `login` when one is known (from the accounts GitHub
   linked, or a noreply address), and the page's state carries `avatars`:
   true unless `--offline` was given. The page loads
   `avatars.githubusercontent.com/<login>` only when both are there;
   otherwise a colour swatch, as before. Files: `api.rs` (`PersonRef.login`,
   `Meta.avatars`, `login_of`), `lib.rs` and `report.rs` (`avatars` on the
   Session and the Report), `main.rs` (`avatars: !offline`). README's "What
   leaves your machine" says so.
8. **Measured.**
   - The embedded app: 304,636 bytes before, 1,053,217 after. The script
     285 KB → 865 KB (87 → 261 KB gzipped); the styles 9.9 KB → 178 KB (2.9
     → 31 KB gzipped). Most of it is the Astryx components used (the date
     input and its calendar are the largest part) and Astryx's one CSS
     file. The `nix build` binary grew from 10.1 to 10.9 MB, and each
     one-file Report grows by the same 0.75 MB. More than ADR-0018's "a few
     hundred KB"; see "Open questions for the owner".
   - The page is now one script: Vite had split two lazy chunks off, which
     a one-file Report cannot load (`inlineDynamicImports`).
   - Tests: 242 Rust, 9 vitest (a palette test added), 13 Playwright (4
     new: a keyboard-only walk through every screen, ⌘K to a person with
     typing left alone in fields, `?` marking the keys, no avatar request
     with `--offline`).
   - Screenshots of every screen in both themes on ripgrep, GitHub read
     (35 people with avatars in the last year):
     `target/preview/web/{overview,activity,people,person,map,map-file,risk}-{light,dark}.png`
     and `overview-help-light.png`.
9. **Nix.** `/nix` ran out of space fetching the new dependencies (1.2 GB
   free). The flake is now checked with a Nix store on `/srv/bulk`
   (`nix build --store <dir>`, which builds in our own `TMPDIR`), so
   nothing lands in `/nix`: the new pnpm hash is
   `sha256-LLwfHwVnkpv/Sygge6KSiMjGKhnuJsVzfGgX3MFe6sQ=` and the binary
   built.

Files created, changed or deleted in Phase 24:
- Created: `packages/ui/src/{Palette.tsx,jump.ts,jump.test.ts,keys.ts}`,
  `packages/ui/src/components/{Key.tsx,Logo.tsx,Tile.tsx,avatar.ts}`.
- Changed: `packages/ui/package.json` (Astryx), `pnpm-workspace.yaml`
  (`allowBuilds`), `pnpm-lock.yaml`; `packages/ui/src/{App.tsx,Wrapped.tsx,
  theme.ts,help.ts,route.ts,index.css}`, `charts/common.tsx`,
  `components/{Name.tsx,SaveCard.tsx}`, every screen in `screens/`;
  `packages/data/src/{types.ts,source.test.ts}`;
  `apps/local/{vite.config.ts,tsconfig.node.json}`,
  `apps/local/e2e/screens.spec.ts`, `apps/local/scripts/{screens,demo}.mjs`;
  `crates/commitscape-web/src/{api.rs,lib.rs,report.rs}`,
  `crates/commitscape/src/main.rs`; `flake.nix`; `README.md`; `STATE.md`.

## Phase 25 findings

1. **Subjects in the index (Rust change, in plain words).** Each commit now
   keeps its subject line: the message's first line, trimmed, at most 200
   bytes, cut where a character ends (`message::subject_of`). They are
   stored the way each commit's changes already were: one long byte string
   on the Index (`Index::subjects`) and, on each commit, where its piece
   starts and how long it is (`CommitMeta::subject_start`, `subject_len`).
   Every place that moves commits around moves their subjects the same way:
   the builder, the merge of new commits into cached ones, the older months
   read later, each month's block in the cache file, and the web filter
   (which leaves them out: no filtered screen needs them). The cache schema
   is now 10, so every cache rebuilds once. The walk reads each message
   already, for its Commit Kind, so nothing new is read from git.
2. **Tests, worked by hand.** Every cache test now compares subjects too
   (a warm load, an update, a late-merged older branch, a recent-first load
   completed later), with messages written into the scripted repositories;
   a unit test covers the 200-byte cut at a two-byte character; a server
   test checks `/api/commits` on four scripted commits column by column
   (newest first, Alice seen first so person 0, the kinds by their labels,
   lines unknown rather than 0 without a line pass, the GitHub link).
3. **The Commit List (`/api/commits`).** Every loaded commit, newest first,
   whatever the Window, sent as columns (ids, author times, time zones,
   person, subject, kind, merge, files, lines added and removed) rather than
   an object per row. People are listed once, with their addresses locally
   (hosted lists will carry none, Phase 27). Each row links to GitHub when
   the remote is there. A Report carries the same list under the same key,
   so the Commits screen works from a one-file Report too.
4. **The Commits screen** is the sixth (`6`). Every word typed must appear
   in the subject or in the name, login or address of who made it; the
   Window, the person filter and dates narrow it, and a kind selector.
   The folder filter says it does not apply (the list keeps no files).
   `/` focuses its search box. Only the rows in view are drawn. Typing
   searches at the first keystroke and then at most every 100 ms; the text
   stays in the search box and reaches the address with
   `history.replaceState`, so a keystroke does not re-render the page.
5. **Measured** (`apps/local/scripts/search-time.mjs`, headless Chromium,
   keys 150 ms apart so each searches at once; from the key to the count
   changing on screen):

   | Repository | Commits in the list | List | Gzipped | Per keystroke, median |
   |---|---|---|---|---|
   | facebook/react (partial clone, lines not counted) | 35,275 | 5.1 MB | 1.5 MB (43 B a commit) | 13 ms on the page; 18 ms through the worker |
   | rust-lang/rust (lines counted) | 345,135 | 45.0 MB | 16.2 MB (47 B a commit) | 50 ms, in the worker |

   The search alone takes 2 to 3 ms at React's size (Node, 20 runs). The
   first version took 62 ms a keystroke: each one re-rendered the whole
   page through the route. The worker's round trip costs about 5 ms, so it
   now starts at 50,000 rows rather than 20,000: ADR-0019 is amended with
   these numbers. React's list is its every branch, not only its main line
   (21,708).
6. **The cache** (release build, `--summary --window all`, fresh caches):

   | Repository | Schema 9 | Schema 10 | Warm start, median of 10 |
   |---|---|---|---|
   | rust-lang/rust | 44.4 MB | 62.5 MB (+41%) | 41 → 42 ms |
   | Linux | 128.2 MB | 217.0 MB (+69%) | 58 → 56 ms |

   rust-lang/rust's cold index took 24.2 s before and 21.4 s after (one run
   each: no cost to see). A warm start reads only the months it needs, so
   it does not grow with the subjects.
7. **Tests now:** 245 Rust, 11 vitest (2 for the search), 15 Playwright (2
   for Commits: typing, `/`, an address finding its person's commits, and a
   one-file Report searched with no server).

Files created, changed or deleted in Phase 25:
- Created: `packages/ui/src/{search.ts,search.test.ts,searcher.ts,search.worker.ts,worker.d.ts,leading.ts}`,
  `packages/ui/src/screens/Commits.tsx`, `apps/local/scripts/search-time.mjs`.
- Changed: `crates/commitscape-core/src/{index.rs,lib.rs}`;
  `crates/commitscape-index/src/{message.rs,source.rs,build.rs,scripted.rs,gix_source/walk.rs,cache/format.rs,cache/mod.rs}`,
  `crates/commitscape-index/tests/cache.rs`;
  `crates/commitscape-metrics/tests/support/mod.rs`;
  `crates/commitscape-web/src/{api.rs,lib.rs,report.rs,filter.rs}`,
  `crates/commitscape-web/tests/server.rs`; `crates/commitscape/src/main.rs`;
  `packages/data/src/types.ts`; `packages/ui/src/{App.tsx,route.ts,keys.ts,index.css}`;
  `apps/local/e2e/screens.spec.ts`; `docs/adr/0019-commit-search-runs-in-the-browser.md`;
  `STATE.md`.

## Phase 26 findings

1. **The Site (`apps/site`, ADR-0014).** TanStack Start 1.168.58 with
   React 19, on Cloudflare's Vite plugin 1.60.1 and Wrangler 4.140.0:
   - **Every page is a static asset.** Start runs in SPA mode and writes
     one shell, `index.html`; Wrangler serves it for every path with no
     file of its own (`not_found_handling: "single-page-application"`),
     so a page view never runs Worker code and is not billed.
   - **Only `/api/*` reaches the Worker** (`run_worker_first`). The
     Worker's entry (`src/server.ts`) sends `/api/*` to `src/api.ts`,
     a small hand-written router with no framework in the way, and anything
     else to Start's handler.
   - **Verified before building:** TanStack Start documents SPA mode and
     Cloudflare documents Start on Workers, and both worked as written. One
     surprise: the shell must hold no page. Start pre-renders it from the
     `/` route, and a browser opening `/gh/…` then hydrates the landing
     page's HTML with another page (React error 418). Every page is now
     drawn in the browser behind one shared placeholder (`Client.tsx`), so
     the shell matches whatever path it is served for. `/privacy` is
     therefore drawn in the browser too, like the rest.
   - Astryx under Start works as under Vite, with the same theme; the theme
     mode now comes from `useSyncExternalStore`, so a page written ahead
     of time starts as "system" and then takes the stored mode, without a
     mismatch.
2. **Pages.** `/` (the one line, the paste box with examples, the three
   ways with their commands, install), `/gh/<owner>/<repo>` (the six
   screens from the stored Report through the fetched-Report Data Source,
   or a plain "no Report yet"), `/privacy` (what is kept, where, how long
   and who reads it, for public lookups, Shared Reports and sign-in, as the
   ADRs decide them). The top bar has the Connect menu's "Share from your
   terminal"; sign-in comes with Phase 29. `packages/data` gained
   `parseGitHub` (a link, `git@…`, or `owner/name`), tested.
3. **D1 through Drizzle.** `src/db/schema.ts` has `repositories`,
   `builds` and `rate_limits`; `drizzle-kit generate` wrote
   `drizzle/0000_init.sql`, which `wrangler d1 migrations apply`
   applies. Later phases add their tables as new migrations.
4. **Rate limits: a counter in D1** (ADR-0014's fallback). Cloudflare's
   rate-limiting binding is not documented for the free plan, counts per
   location, and is "intentionally designed to not be used as an accurate
   accounting system". `api/limits.ts` counts per action, per hashed
   address, per window, with one `INSERT … ON CONFLICT … RETURNING`; the
   address itself is never kept; the Cron Trigger (Phase 28) sweeps old
   windows. Unit-tested against the real SQL on Node's built-in SQLite
   (`src/test/d1.ts`, a D1 stand-in over `node:sqlite`).
5. **`commitscape report --data`** writes the Report's data alone as
   gzipped JSON (the same JSON a one-file Report inlines): 6,644 bytes for
   the `ownership` fixture. The Worker passes a Report from R2 to the
   browser without reading it, as `application/gzip`; the Data Source
   gunzips it in the browser.
6. **CPU of every API handler** (`apps/site/scripts/cpu.test.ts`: the
   real handlers in Node against SQLite and an in-memory R2, 200 requests
   each after 20 warm-ups; SQLite's work is counted, which D1's never is on
   Cloudflare, so these are upper bounds). Wrangler's local traces give
   wall time only (40 to 450 ms locally, most of it the local D1).

| Handler | Status | CPU, median | CPU, 99th percentile |
|---|---|---|---|
| GET /api/repos/:owner/:name (stored) | 200 | 0.18 ms | 1.67 ms |
| GET /api/repos/:owner/:name (unknown) | 200 | 0.15 ms | 2.50 ms |
| GET /api/reports/:owner/:name (6644 bytes) | 200 | 0.14 ms | 4.21 ms |
| GET /api/nope | 404 | 0.02 ms | 1.08 ms |

   Budget: 10 ms. CI runs this and fails a handler whose median passes it.
7. **Under `wrangler dev`** (`apps/site/e2e/start.ts` writes the
   fixture's Report with the real binary, applies the migrations and
   stores it in fresh local D1 and R2 under `target/`, then starts
   `wrangler dev`): 5 Playwright tests pass: the landing page (a bad paste
   says why; a link goes to the repository), a repository page from the
   stored Report on three screens including Commits' search, a repository
   with no Report, `/privacy`, and the API's answers (404 and 400 in plain
   words, the Report as gzip, an unknown page served as the app). Unit
   tests: 3.
8. **The Worker's types** come from `@cloudflare/workers-types`, with
   Wrangler generating only our `Env` (389 bytes, rather than a 604 KB
   file with the runtime's types in it).
9. **Screenshots** (fixture Report): `target/preview/site/`.

Files created, changed or deleted in Phase 26:
- Created: `apps/site/` (`package.json`, `vite.config.ts`,
  `wrangler.jsonc`, `worker-configuration.d.ts`, `tsconfig.json`,
  `.oxlintrc.json`, `drizzle.config.ts`, `drizzle/0000_init.sql` and
  `drizzle/meta/`, `vitest.config.ts`, `playwright.config.ts`,
  `public/favicon.svg`, `e2e/{start.ts,site.spec.ts}`,
  `scripts/{cpu.test.ts,vitest.config.ts}`, `src/{server.ts,api.ts,router.tsx,routeTree.gen.ts,site.css}`,
  `src/api/{http.ts,limits.ts,limits.test.ts,reports.ts,reports.test.ts}`,
  `src/db/schema.ts`, `src/test/{d1.ts,r2.ts}`,
  `src/components/{Frame.tsx,Connect.tsx,Client.tsx}`,
  `src/routes/{__root.tsx,index.tsx,privacy.tsx,gh.$owner.$repo.tsx}`);
  `packages/data/src/{github.ts,github.test.ts}`.
- Changed: `packages/data/src/index.ts`; `packages/ui/src/{index.ts,App.tsx,theme.ts}`,
  `packages/ui/package.json`; `pnpm-workspace.yaml` (Astryx in the
  catalog; esbuild's and workerd's install scripts allowed),
  `pnpm-lock.yaml`; `crates/commitscape-web/src/report.rs`
  (`report::data`), `crates/commitscape/{Cargo.toml,src/main.rs}`
  (`--data`, gzip through `flate2`), `Cargo.lock`;
  `.github/workflows/ci.yml`; `.gitignore`; `README.md`; `STATE.md`.

## Phase 27 findings

1. **`commitscape report --data`, grown (Rust, in plain words).**
   - It takes a GitHub URL or `owner/name` as well as a folder, cloning
     into the cache as `health` does. The clone code moved from
     `health.rs` to its own `clone.rs`, shared by both, and can clone
     whole (`clones/`) or partially (`health/`); `COMMITSCAPE_GIT_BASE`
     points clones elsewhere, for tests.
   - `--partial` clones history without old file contents, for a large
     project, and implies `--no-lines`; `--no-lines` leaves the line
     pass out and the Report says "lines" are off.
   - `--no-emails` leaves every address out: a person's profile has no
     email, addresses or `.mailmap` lines, and the Commit List's people
     none (ADR-0019). People keep their names and GitHub logins. Two new
     integration tests check both, on the `ownership` fixture.
2. **The clone threshold** (ADR-0015 amended). From nothing to a Report:

   | Repository | GitHub's size | Full clone, lines | Partial, no lines |
   |---|---|---|---|
   | BurntSushi/ripgrep | 6 MB | 3.0 s | 4.2 s |
   | vitejs/vite | 75 MB | 15.8 s | 8.9 s |
   | astral-sh/ruff | 207 MB | 44.8 s | 18.4 s |
   | facebook/react | 1,071 MB | 212.5 s | 18.8 s |

   Full clones now stop at **100 MB** (`FULL_CLONE_UP_TO_MB`).
3. **The Builder (`apps/builder`)**: TypeScript on Node, bundled by
   esbuild into one file (`dist/builder.mjs`, 12 KB) for the VPS.
   - `POST /builds`, signed by the Site, queues a Build; one runs at a
     time (`CONCURRENCY`). `GET /health` says how busy it is.
   - A Build refuses a repository over `MAX_REPOSITORY_MB` (3,000),
     picks the clone by size, runs `report --data --no-emails --offline`
     and `card`, draws the card as a PNG with resvg (or keeps the SVG
     where resvg is missing), uploads both, and says how it ended.
   - It stops a Build after `TIME_LIMIT_SECONDS` (900): the command and
     everything it started, as one process group. The first version killed
     only the command, and its `git` kept running and holding the pipe.
   - A Connected Repository's clone is deleted after its Build. Past
     `DISK_BUDGET_GB` (20), the clones built least recently are deleted.
   - 7 unit tests: the clone choice, too big, timed out (a real process
     group), not found, a private clone deleted, the disk budget, and the
     queue only the Site can fill, one Build at a time.
4. **Signing (ADR-0015).** `packages/data/src/hmac.ts` signs a request's
   method, path, time and body with HMAC-SHA256 over WebCrypto, so the
   Worker and the Builder share it; signatures older than five minutes are
   refused. An upload is signed over its length, not its bytes (hashing a
   16 MB Report would pass the Worker's CPU budget), and carries a one-time
   token issued with its Build and stored only as a hash.
5. **The Site's side.**
   - `GET /api/repos/:owner/:name` asks GitHub for its instant facts
     (four requests; cached an hour in D1) and says whether a Build may
     start. `POST /api/builds` starts one: 20 an hour per address, and
     only for a public repository whose Report is missing or a day old,
     with nothing running and no failure in the last hour.
   - The Builder's callbacks are `progress`, `PUT report`, `PUT
     card` (streamed into R2, 64 MB and 2 MB at most) and `done`, which
     stores the Report, deletes the one it replaces, and writes the
     repository's page: the app's shell with its Open Graph and Twitter
     tags, into R2, once.
   - **`/gh/*` now runs through the Worker**, to serve that stored page
     (or the plain shell): crawlers that make link previews run no
     JavaScript, so the tags must be in the page itself. It costs one
     Worker request per repository page view, 0.1 ms of CPU; see "Open
     questions for the owner".
   - The page shows GitHub's facts at once (description, stars, forks,
     languages, the top contributors with avatars, releases), the Build's
     progress, then the Report; an older Report shows with "updating…"
     while a newer one builds; each failure has its plain words
     (`FAILURE_WORDS` in `packages/data`), and "Builds are paused" when
     the Builder does not answer.
   - A repository GitHub knows by a newer name (facebook/react is now
     react/react) keeps the address people asked for.
6. **End to end on this machine, against GitHub** (`wrangler dev` and the
   Builder, unauthenticated requests to GitHub; `target/real-run.sh`):

   | Repository | GitHub's facts on screen | First Report on screen | The Build | Again |
   |---|---|---|---|---|
   | BurntSushi/ripgrep | 1.1 s | 8.2 s | 4.9 s, full clone | 0.64 s |
   | facebook/react | 3.1 s | 25.8 s | 20.6 s, partial | 0.75 s |

   Screenshots: `target/preview/site-real/`. Locally, workerd did not
   trust GitHub's certificate until given NixOS's bundle
   (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`); Cloudflare needs neither.
7. **Tested** under `wrangler dev` with the real Builder, a stand-in for
   GitHub's API answering from responses written by hand
   (`apps/site/e2e/github/`), and the fixture as the git remote: 8
   Playwright tests: a pasted link, facts then Report; every screen with no
   address; the page's preview tags and the card; not found, private, too
   big and timed out (the Builder's real time limit, on a repository a
   wrapper makes slow); a day-old Report "updating…" then rebuilt; the
   20-an-hour limit; the API's plain answers; `/privacy`. Unit tests: the
   paused Builder; signing (8 cases).
8. **CPU of every handler** (as in Phase 26, upper bounds):

| Handler | Status | CPU, median | CPU, 99th percentile |
|---|---|---|---|
| GET /api/repos/:owner/:name (facts kept) | 200 | 0.39 ms | 2.63 ms |
| GET /api/repos/:owner/:name (facts asked of GitHub) | 200 | 0.66 ms | 4.17 ms |
| GET /api/reports/:owner/:name (6644 bytes) | 200 | 0.13 ms | 2.85 ms |
| GET /api/cards/:owner/:name | 200 | 0.16 ms | 1.16 ms |
| GET /gh/:owner/:name (the stored page) | 200 | 0.10 ms | 2.09 ms |
| POST /api/builds (asks GitHub, starts one) | 202 | 1.12 ms | 8.97 ms |
| POST /api/builds/:id/progress | 200 | 0.28 ms | 0.96 ms |
| PUT /api/builds/:id/report (200000 bytes) | 200 | 0.51 ms | 9.07 ms |
| POST /api/builds/:id/done (stores the page) | 200 | 0.70 ms | 1.80 ms |
| GET /api/nope | 404 | 0.02 ms | 0.05 ms |
9. **Decisions:** hosted Reports carry no pull-request or issue history for
   now (`--offline`: reading React's would take minutes), so Activity says
   GitHub's history is not read there; Phase 30's issue numbers come from
   `health`.

Files created, changed or deleted in Phase 27:
- Created: `apps/builder/` (`package.json`, `tsconfig.json`,
  `src/{config.ts,site.ts,run.ts,disk.ts,server.ts,main.ts,builder.test.ts}`);
  `packages/data/src/{hmac.ts,hmac.test.ts,builds.ts,lookup.ts}`;
  `apps/site/drizzle/0001_builds.sql` (and its `meta/`),
  `apps/site/.dev.vars.example`,
  `apps/site/src/api/{github.ts,lookup.ts,builds.ts,builds.test.ts,random.ts}`,
  `apps/site/src/components/Facts.tsx`,
  `apps/site/e2e/{github.ts,github/acme-ownership.json,slow-commitscape.sh}`;
  `crates/commitscape/src/clone.rs`, `crates/commitscape/tests/report_data.rs`.
- Changed: `crates/commitscape/src/{main.rs,health.rs}`,
  `crates/commitscape-web/src/{api.rs,lib.rs,report.rs}`;
  `packages/data/src/index.ts`, `packages/ui/src/index.ts`;
  `apps/site/{wrangler.jsonc,worker-configuration.d.ts,package.json,playwright.config.ts}`,
  `apps/site/src/{api.ts,server.ts,site.css,db/schema.ts,api/reports.ts,routes/gh.$owner.$repo.tsx}`,
  `apps/site/e2e/{start.ts,site.spec.ts}`, `apps/site/scripts/cpu.test.ts`,
  `apps/site/src/test/r2.ts`; `docs/adr/0015-*.md`; `flake.nix` (hash);
  `pnpm-lock.yaml`; `.gitignore`; `STATE.md`.

## Phase 28 findings

1. **`commitscape share` (Rust, in plain words; `crates/commitscape/src/share.rs`).**
   - It builds the Report on this machine (the same code as `report`, now
     shared as `make_report`), with its lines and without any email
     address, gzips it, and locks it with AES-256-GCM under a fresh random
     256-bit key and a random 96-bit nonce. What is uploaded is the nonce,
     then the ciphertext and its tag.
   - The Delete Token is HKDF-SHA256 of the key (no salt, info
     "commitscape delete"); the Site gets only its SHA-256.
   - Upload: `POST /api/shares` (size, hours, the hash) answers an id (128
     random bits) and a one-time upload token; `PUT /api/shares/<id>`
     streams the bytes into R2. It prints `<site>/s/<id>#<key>` and exits.
   - Before uploading it says what goes (file paths, names and logins,
     commit subjects; no addresses) and asks once; `--yes` skips the
     question, and without a terminal it refuses rather than guess.
     `--offline` refuses. `--expires` takes 1 to 12 hours (default 4).
     `--list` shows this machine's live links and `--delete <link>`
     takes one down; the list is `shares.json` in the cache directory, and
     `--no-cache` keeps none (it would otherwise have written to the
     default cache, under `~/.cache`).
   - The Site's origin comes from `packages/data/src/product.ts`, read by
     a new `build.rs` into the binary; `COMMITSCAPE_SITE` overrides it.
   - New crates: `ureq` 3.4 (rustls on `ring`, with Mozilla's roots
     built in, so no system certificates or extra build tools on any OS),
     `aes-gcm` 0.11, `hkdf` 0.13, `sha2` 0.11, `getrandom` 0.3.
     `cargo build`, clippy and the tests pass here on Linux; macOS and
     Windows were not built here (CI will be their first build).
2. **One test vector, two languages.** A fixed key and nonce, locked and
   turned into a Delete Token, computed first with Node's WebCrypto; the
   Rust tests and `packages/data/src/share.test.ts` both assert those
   exact strings, so the command and the browser agree byte for byte. The
   first guesses written into the tests were wrong and were replaced by the
   computed values, never the other way round.
3. **The Site.** `drizzle/0002_shares.sql` adds `shares` (size, times,
   the two hashes, whether uploaded). `api/shares.ts`: create (30 an hour
   per address; 1 to 12 hours; at most 25 MB), upload (one time, the size
   said), get (410 once expired, 404 once deleted), delete (the Delete
   Token's hash compared in constant time). The Cron Trigger (every 15
   minutes; the free plan allows 5 per account, 10 ms of CPU and 50
   subrequests a run, checked in Cloudflare's limits page) removes expired
   Shared Reports and never-finished uploads, a hundred at a time, with one
   R2 call and one SQL statement.
4. **`/s/<id>#<key>`.** The key is taken from the address and removed
   with `history.replaceState` as the app starts, before any page draws
   (`src/share-key.ts`, imported first by the root). The page fetches the
   locked bytes, unlocks them with WebCrypto, and reads them through the
   same Report Data Source; it shows when the link expires and a Delete
   button. A changed byte, a wrong key, a cut link, an expired or a deleted
   Shared Report each say so plainly.
5. **The local page's Share button** asks the local server
   (`POST /api/share`), which runs the same code as the command through a
   hook the binary gives it; the button says what will be uploaded, takes
   the hours, and shows the link to copy. `--offline` removes it, and a
   Report has none (`Meta.can_share`).
6. **Tested end to end on this machine** (the Site under `wrangler dev
   --test-scheduled`, the real binary): 5 new Playwright tests.
   - `share --yes` prints a link; the page opens it (21 commits); every
     request the page made (address, headers, body) was checked and none
     holds the key; the stored bytes do not either; the address bar has no
     `#` once the page is drawn.
   - A byte changed in transit (Playwright rewrites the response), a wrong
     key, and a cut link each fail plainly.
   - The Delete button and `share --delete` both take a link down (404
     after); `--list` shows and then drops it.
   - An expired Shared Report answers 410 and says so; the Cron Trigger,
     fired through Wrangler's local `/cdn-cgi/handler/scheduled`, removes
     it (404 after).
   - The local page's Share button uploads, and its link opens on the Site.
   And one more on the local page: no Share button with `--offline`.
7. **CPU** (upper bounds, as before):

| Handler | Status | CPU, median | CPU, 99th percentile |
|---|---|---|---|
| GET /api/repos/:owner/:name (facts kept) | 200 | 0.39 ms | 2.69 ms |
| GET /api/repos/:owner/:name (facts asked of GitHub) | 200 | 0.65 ms | 4.03 ms |
| GET /api/reports/:owner/:name (6644 bytes) | 200 | 0.13 ms | 2.06 ms |
| GET /api/cards/:owner/:name | 200 | 0.17 ms | 1.16 ms |
| GET /gh/:owner/:name (the stored page) | 200 | 0.10 ms | 1.48 ms |
| POST /api/builds (asks GitHub, starts one) | 202 | 1.10 ms | 10.40 ms |
| POST /api/builds/:id/progress | 200 | 0.28 ms | 2.82 ms |
| PUT /api/builds/:id/report (200000 bytes) | 200 | 0.51 ms | 14.51 ms |
| POST /api/builds/:id/done (stores the page) | 200 | 0.71 ms | 1.91 ms |
| POST /api/shares | 201 | 0.23 ms | 1.70 ms |
| PUT /api/shares/:id (200000 bytes) | 200 | 0.42 ms | 8.44 ms |
| GET /api/shares/:id (200000 bytes) | 200 | 0.24 ms | 7.68 ms |
| DELETE /api/shares/:id | 200 | 0.20 ms | 3.24 ms |
| GET /api/nope | 404 | 0.02 ms | 0.02 ms |
| Cron Trigger: 100 expired Shared Reports removed | – | 0.76 ms | 1.32 ms (max of 30) |

Files created, changed or deleted in Phase 28:
- Created: `crates/commitscape/{build.rs,src/share.rs}`;
  `packages/data/src/{share.ts,share.test.ts}`;
  `packages/ui/src/components/Share.tsx`; `apps/site/drizzle/0002_shares.sql`
  (and `meta/`), `apps/site/src/{share-key.ts,api/shares.ts}`,
  `apps/site/src/routes/s.$id.tsx`.
- Changed: `crates/commitscape/{Cargo.toml,src/main.rs}`, `Cargo.lock`;
  `crates/commitscape-web/src/{lib.rs,api.rs,report.rs}`;
  `crates/commitscape/tests/report_data.rs`;
  `packages/data/src/{index.ts,source.ts,source.test.ts,types.ts}`;
  `packages/ui/src/{App.tsx,index.css}`;
  `apps/site/{wrangler.jsonc,src/api.ts,src/server.ts,src/db/schema.ts,src/routes/__root.tsx,src/routeTree.gen.ts,e2e/start.ts,e2e/site.spec.ts,scripts/cpu.test.ts}`;
  `apps/local/e2e/screens.spec.ts`; `README.md`; `STATE.md`.

## Phase 29 findings

1. **Signing in, without an auth library** (ADR-0014 amended). Better Auth,
   the first candidate, has reports of free-plan Workers with D1 exceeding
   the CPU limit; the Site needs one way to sign in, so it is written out
   in `apps/site/src/api/auth.ts`:
   - `/api/auth/github` sends the person to the App's OAuth page with a
     random `state` (a ten-minute cookie); `/api/auth/callback` checks
     it, exchanges the code, asks GitHub who they are, and starts a session.
   - A session is a random token in an HttpOnly, SameSite=Lax cookie
     (Secure over HTTPS), kept in D1 only as its SHA-256; it lasts 30 days.
     A second, readable cookie holds only the login, so pages can say who is
     signed in without a request; the API never trusts it.
   - GitHub's user token (which checks access) is kept locked with the
     Site's `SESSION_KEY` (AES-256-GCM), never in the clear, and refreshed
     with its refresh token when it expires.
   - Requests that change something (sign out, "Delete my data", a private
     Build) are refused when their `Origin` is another site.
2. **The GitHub App** (`api/app.ts`, `api/crypto.ts`). The Site signs
   the App's JWT with RS256 in WebCrypto. GitHub hands out the App's key as
   PKCS#1 ("BEGIN RSA PRIVATE KEY"), which WebCrypto cannot read, so the
   Site wraps it in PKCS#8 itself; a unit test checks the wrapping equals
   Node's own export byte for byte, and that the JWT verifies with the
   public key. The key may be set as the PEM or as the PEM base64-encoded
   (one line, easier as a secret). A Build of a Connected Repository gets a
   one-hour installation token for that one repository, read-only, which
   goes to the Builder and is never stored; the Builder gives it to git
   only through git's environment (`GIT_CONFIG_COUNT`, an
   `http.extraHeader`), never a command line or a file. Signing the JWT
   costs about 3 ms of CPU, so an isolate keeps it for five of its nine
   minutes: a private Build's start went from 3.96 to 1.09 ms median.
3. **Who sees what.**
   - A repository GitHub does not show publicly is, to anyone signed out
     or not shown it by GitHub, as if it did not exist ("GitHub has no
     public repository of that name"), with a hint to sign in. The Site says
     "This repository is private" only to someone who can see it on GitHub,
     with the way to add the App.
   - Access is asked with the person's own token, `GET /repos/…`, on every
     view and remembered five minutes (`access` table).
   - A Connected Repository's Report is served `private, no-store`; it gets
     no card and no page with a social preview.
4. **`/me`** lists the person's installations' repositories as GitHub
   lists them to them, each linking to its Report; "Add repositories" goes
   to the App's installation page; "Sign out"; "Delete my data" removes the
   account, every session (and their remembered access answers), and the
   Reports of what they connected, at once.
5. **Webhooks** (`POST /api/github/webhooks`) are believed only with a
   valid `X-Hub-Signature-256`: `installation` deleted removes that
   installation's Reports, `installation_repositories` removed removes
   those repositories'. **Retention:** the Cron Trigger removes a Connected
   Repository's Report after 30 days without a view (and ends old sessions
   and access answers).
6. **Tests against GitHub's responses written by hand** (`apps/site/e2e/github.ts`
   and `github/*.json`): the stand-in plays the OAuth flow, two people,
   installations, and the App's endpoints, which check the Site's JWT
   against the test App's public key (a new key pair each run). 8 new
   Playwright tests, all under `wrangler dev` with the real Builder:
   signed out sees nothing; Alice signs in, lists her repositories, and
   her private one is built with the installation token and shown; Bob
   sees nothing, and his own private repository without the App says so;
   access remembered five minutes and asked again after; the 30-day
   retention; webhooks refused unsigned and acted on signed; "Delete my
   data"; a callback with a made-up state refused. Unit tests: sealing,
   the JWT, webhook signatures; the Builder's token handling. No test App
   exists on GitHub yet, so nothing ran against GitHub itself.
7. **Verified before building:** Better Auth on Workers' free plan (not
   used, above). A GitHub App's user authorization uses the same OAuth
   endpoints as an OAuth App, with tokens that expire in eight hours and a
   refresh token, as GitHub documents; the stand-in answers that way.
8. **CPU** (upper bounds, as before):

| Handler | Status | CPU, median | CPU, 99th percentile |
|---|---|---|---|
| GET /api/repos/:owner/:name (facts kept) | 200 | 0.41 ms | 2.42 ms |
| GET /api/repos/:owner/:name (facts asked of GitHub) | 200 | 0.68 ms | 3.95 ms |
| GET /api/reports/:owner/:name (6644 bytes) | 200 | 0.20 ms | 4.28 ms |
| GET /api/cards/:owner/:name | 200 | 0.17 ms | 1.17 ms |
| GET /gh/:owner/:name (the stored page) | 200 | 0.11 ms | 2.11 ms |
| POST /api/builds (asks GitHub, starts one) | 202 | 1.14 ms | 8.84 ms |
| POST /api/builds/:id/progress | 200 | 0.28 ms | 1.33 ms |
| PUT /api/builds/:id/report (200000 bytes) | 200 | 0.53 ms | 10.04 ms |
| POST /api/builds/:id/done (stores the page) | 200 | 0.74 ms | 1.89 ms |
| POST /api/shares | 201 | 0.22 ms | 1.22 ms |
| PUT /api/shares/:id (200000 bytes) | 200 | 0.34 ms | 10.10 ms |
| GET /api/shares/:id (200000 bytes) | 200 | 0.35 ms | 10.84 ms |
| DELETE /api/shares/:id | 200 | 0.20 ms | 1.20 ms |
| GET /api/auth/github (off to GitHub) | 302 | 0.02 ms | 0.02 ms |
| GET /api/auth/callback (signs in) | 302 | 0.49 ms | 2.20 ms |
| GET /api/me (30 repositories) | 200 | 0.41 ms | 2.27 ms |
| GET /api/repos/:owner/:name (private, access asked) | 200 | 0.69 ms | 2.71 ms |
| GET /api/reports/:owner/:name (private, access kept) | 200 | 0.45 ms | 4.64 ms |
| POST /api/builds (private: App JWT and installation token) | 202 | 1.09 ms | 2.62 ms |
| POST /api/github/webhooks (signed) | 200 | 0.10 ms | 1.09 ms |
| GET /api/nope | 404 | 0.01 ms | 0.02 ms |
| Cron Trigger: 100 expired Shared Reports removed | – | 0.80 ms | 5.04 ms (max of 30) |

Files created, changed or deleted in Phase 29:
- Created: `apps/site/drizzle/0003_accounts.sql` (and `meta/`),
  `apps/site/src/api/{auth.ts,app.ts,access.ts,cookies.ts,crypto.ts,crypto.test.ts,webhooks.ts}`,
  `apps/site/src/routes/me.tsx`, `apps/site/e2e/{signin.spec.ts,constants.ts}`,
  `apps/site/e2e/github/{user-alice,user-bob,installations-alice,installation-42-repositories,acme-private-thing}.json`.
- Changed: `apps/site/{wrangler.jsonc,worker-configuration.d.ts,.dev.vars.example}`,
  `apps/site/src/{api.ts,server.ts,db/schema.ts,routeTree.gen.ts}`,
  `apps/site/src/api/{lookup.ts,builds.ts,reports.ts,github.ts}`,
  `apps/site/src/components/Connect.tsx`, `apps/site/src/routes/gh.$owner.$repo.tsx`,
  `apps/site/e2e/{github.ts,start.ts,site.spec.ts}`, `apps/site/scripts/cpu.test.ts`;
  `apps/builder/src/{run.ts,builder.test.ts}`; `packages/data/src/lookup.ts`;
  `docs/adr/0014-*.md`; `STATE.md`.

## Phase 30 findings

1. **The numbers behind the boards come from the Report.** A Report now
   carries `stats` (`crates/commitscape-web/src/api.rs`, `Stats::of`):
   commits and people over all of history, the Bus Factor of the last year
   (the fewest people who made over 80% of its commits), maintainers (3 or
   more commits in 90 days), commits and people in the last 30 days, lines
   of code at HEAD, and lines in files nobody has changed for five years.
   The Builder reads them from the Report it just made and sends them with
   `done`, so the Worker never opens a Report. A seed's Build also runs
   `health --json` for how fast its issues get a first answer. A
   hand-worked test (`crates/commitscape-web/tests/server.rs`) checks every
   number.
2. **Seeds.** The Builder asks GitHub's search for the most starred
   repositories in each language (not archived, not forks; nine languages,
   10 each by default), paced 7 s apart without a token (GitHub allows 10
   searches a minute) and waiting out its limit up to three times. It sends
   the list to the Site (`POST /api/seeds`, signed), which marks them seeds
   and answers with that night's Builds within the budget: never built
   first, then the oldest, none built in the last day, none already
   building. When they are done the Builder asks the Site to write the
   boards (`POST /api/leaderboards/write`, signed). The Cron Trigger also
   writes them once they are a day old. `SEED_HOUR` (3 UTC unless set)
   starts a night; `node builder.mjs seed` starts one now.
3. **The boards** are one JSON document in R2, written once a day from D1
   and served as it is (`GET /api/leaderboards`, 0.04 ms): `/leaderboards`
   is a static page that reads it, and the landing page shows three of
   them. Each board says how it ranks, when it was written and from how
   many repositories, and each row links to the repository's page.
   Repositories only; no board names a person (tested). Rules: "Resting on
   one person" is a Bus Factor of 1, most stars first; "Fastest to answer
   issues" needs 10 or more issues answered; "Oldest code still running"
   needs 1,000 lines of code or more.
4. **Built on this machine against the real GitHub, 54 seeds, 53 built**
   (the gate is 50): 6 in each of the nine languages but C, which had 5.
   torvalds/linux was refused as too big (over 3,000 MB), as designed.
   The first night, every clone new:

| | |
|---|---|
| Builds | 54: 53 done, 1 too big |
| Clones | 21 full (up to 100 MB), 32 partial |
| Time for one Build | median 26 s, 90th percentile 103 s, longest 274 s (microsoft/typescript, 2.8 GB, partial) |
| Longest after it | elastic/elasticsearch 153 s, rust-lang/rust 130 s, microsoft/vscode 106 s, tensorflow/tensorflow 106 s, nodejs/node 103 s |
| The night | 2,697 s (45 min), one Build at a time |
| Disk after it | 17 GB of clones and indexes (the default budget is 20 GB) |

   Three more nights followed, each started by hand
   (`node builder.mjs seed`):

| Night | Builds | Result | Time for one Build | The night |
|---|---|---|---|---|
| 2: every Report aged two days by hand | 38 (interrupted once by a session restart, then resumed) | 36 done, 1 too big (openclaw/openclaw), 1 failed (an upload the local dev server dropped, below) | median 14.3 s, 90th percentile 27.4 s: clones kept, only new commits fetched | about 20 min |
| 3: the rest due | 58 | 58 done | median 26.2 s, 90th percentile 82.2 s, longest 280 s (microsoft/TypeScript) | 3,208 s (53 min); the disk budget started deleting the least recently used clones and indexes (22 GB of work folder before) |
| 4: two repositories rebuilt after fixes (below), with never-built seeds | 17 | 15 done, 2 too big | | 776 s (13 min) |

   The boards are now written from **107 repositories**. Screenshots of
   `/leaderboards` and the landing page, light and dark, are in
   `target/preview/site/`.
5. **Found by reading the boards, and fixed:**
   - **Bots answering issues.** The first "Fastest to answer issues" had
     elastic/elasticsearch and facebook/react-native answering in a
     minute, then ansible/ansible. Their first comments come from
     `elasticsearchmachine`, `react-native-bot` and `ansibot`, which
     GitHub types as users, not bots, so `health` took them as the project
     answering. The rules that already kept such accounts out of commit
     counts (a `[bot]` or `-bot` suffix, a list of known automation
     accounts) now live in `commitscape-core` (`bots.rs`) and apply to
     issue answers too, with `elasticsearchmachine` and `ansibot` added to
     the list. A plain "ends in bot" rule was not taken: it would catch
     people called Talbot. The recorded GitHub response in
     `commitscape-forge`'s tests gained a triage account's comment, which
     the old rule took as the answer. This also improves the local
     `health` command's answer times.
   - **A month's people stopped at 1,000.** NousResearch/hermes-agent
     showed exactly 1,000 people in 30 days; git counts 1,101 names. The
     Report's `stats` counted the Contributors ranking, which, like every
     ranking, keeps its first 1,000 (`RANKING_LIMIT`). The counts now come
     from `Analysis::activity`, which counts every commit and person. A
     test of 1,005 people failed first (1,000 and 1,000), then passed. The
     board now shows 1,136 people.
   - **"Oldest code still running" ranked abandoned projects**
     (NARKOZ/hacker-scripts, 100% of its lines untouched). It now ranks
     only projects with commits in the last year, and the "most" boards
     leave out repositories with none (no "0 maintainers" rows).
   - **The landing page suggested torvalds/linux**, which the Builder
     refuses as too big. It suggests vitejs/vite instead.
6. **Found and fixed on the way:**
   - GitHub's search answered 403 when asked for nine languages at once
     without a token. It is now paced and waits out the limit.
   - GitHub's search does not give the same list twice: its answers say
     `incomplete_results: true`, and the second night's list had, for
     Python, NVIDIA/pix2pixHD among the top six. Seeds therefore gather
     over nights (a repository stays a seed), and each night builds the
     never-built ones first. With a `GITHUB_TOKEN` the lists should be
     steadier; that is untested here.
   - During the second night the Site's local dev server dropped one
     Report upload ("Network connection lost") while the machine was busy
     with a Nix build, and the Build failed. The Builder now tries each
     call to the Site again once, two seconds later, on a dropped
     connection or a 5xx, the seed and boards requests too. Each is safe
     to repeat: the upload writes the same key, `done` after the end
     changes nothing, and seeds already queued are busy the second time.
   - The seeds handler first took 16.6 ms of CPU in the harness, building
     90 upserts through Drizzle; with one D1 statement bound again for
     each, 5.4 ms, and 2.4 ms without SQLite's share after Phase 31's
     rewrite of its reads.
   - A test's fake command runner wrote a file called `health` into
     `apps/builder/` (its `--out` lookup read `args[-1 + 1]`); fixed and
     the file removed.
7. **Tests:** 4 unit tests of the seeds and boards handlers
   (`apps/site/src/api/boards.test.ts`), 2 of the Builder's seeds and
   stats, 3 in Rust (the hand-worked stats, the 1,005 people, bots by
   name), a Playwright test end to end (the stand-in GitHub's search, a
   signed seed night through the real Builder, the stats stored, the page
   rendered and linking, no person named), and the new handlers in the CPU
   harness. At the end of Build Run 4: 255 Rust, 49 vitest, 16 local and
   22 Site Playwright tests pass.
8. **Screenshots:** `/leaderboards` and the landing page in both themes,
   in `target/preview/site/`.
9. **Decisions:** the boards are one document read by one static page
   rather than five pages ("static pages" in IDEA.md): the same result
   with one R2 object and no page per board to keep in step. A seed is
   read like any public repository: its Report is the one people see at
   `/gh/`. "Most active this month" is two boards, by commits and by
   people, as IDEA.md lists them.

Files created, changed or deleted in Phase 30:
- Created: `apps/builder/src/seeds.ts`; `apps/site/drizzle/0004_leaderboards.sql`
  (and `meta/0004_snapshot.json`), `apps/site/src/api/{boards.ts,boards.test.ts}`,
  `apps/site/src/routes/leaderboards.tsx`; `packages/data/src/boards.ts`;
  `crates/commitscape-core/src/bots.rs`.
- Changed: `crates/commitscape-web/src/{api.rs,report.rs}`,
  `crates/commitscape-web/tests/server.rs`,
  `crates/commitscape-core/src/lib.rs`, `crates/commitscape-index/src/identity.rs`,
  `crates/commitscape-forge/src/lib.rs`, `crates/commitscape-forge/tests/{acme-rocket.json,github.rs}`;
  `packages/data/src/{builds.ts,index.ts,types.ts}`;
  `apps/site/src/{api.ts,server.ts,db/schema.ts,routeTree.gen.ts,site.css}`,
  `apps/site/src/api/builds.ts`, `apps/site/src/components/Frame.tsx`,
  `apps/site/src/routes/{index.tsx,privacy.tsx}`, `apps/site/src/test/d1.ts`,
  `apps/site/drizzle/meta/_journal.json`, `apps/site/scripts/cpu.test.ts`,
  `apps/site/e2e/{github.ts,start.ts,site.spec.ts,slow-commitscape.sh}`;
  `apps/builder/src/{run.ts,server.ts,main.ts,site.ts,builder.test.ts}`; `STATE.md`.

## Phase 31 findings

1. **README** now opens with the three ways to use commitscape (on your
   machine, shared from a terminal, on the Site), has a section "On the
   Site" (any public repository, your own through the App, search,
   Leaderboards), and "What leaves your machine" rewritten in two halves:
   what the command sends (nothing unless asked: `gh`, avatars, `share`,
   `health`) and what the Site keeps when you use it. The Develop table
   names `apps/builder`, and `DEPLOY.md` is linked.
2. **`DEPLOY.md`**, written from nothing, in seven steps: the name and
   `SITE_ORIGIN`; three secrets (`openssl rand -hex 32`) and a read-only
   fine-grained token; the GitHub App (every field, the four read-only
   permissions, the two events, the callback and setup URLs, the PKCS#1
   key handed over as base64); Cloudflare (D1, R2, migrations, vars,
   secrets, deploy, custom domain, an R2 lifecycle backstop); the Builder
   on a VPS (Node 24, git, `gh`, fonts, the binary, `@resvg/resvg-js`, the
   settings file, a hardened systemd unit, Caddy for HTTPS); checks; and
   running it (updates, secrets, backups, the free plan's limits).
3. **`DEPLOY.md` followed from scratch against local stand-ins**, in a
   fresh copy of the working tree (`/srv/bulk/datasets/commitscape-br4/deploy-drill`):
   - Step 1: `SITE_ORIGIN` set to the drill's Site; `pnpm install`,
     `pnpm build` (3 tasks: local, site, builder); the binary built from
     the copy. `commitscape share` with no `COMMITSCAPE_SITE` uploaded to
     the drill's Site: the origin is read at build time, as documented.
   - Step 2 and 3: secrets from `openssl`; the App's key made with
     `openssl genrsa -traditional` (PKCS#1, as GitHub gives it) and handed
     over as `base64 -w0`, which the Site read; the e2e tests' stand-in for
     GitHub played the App.
   - Step 4: `wrangler.jsonc`'s vars edited as written, secrets in
     `.dev.vars` (the local form of `wrangler secret put`), migrations
     applied locally, `pnpm build`, and `wrangler deploy --dry-run`, which
     read every binding: **the Worker is 3,228 KiB, 743 KiB gzipped**,
     under the free plan's 3 MB.
   - Step 5: `builder.mjs` copied into an empty folder with only
     `npm install @resvg/resvg-js@2.6.2` beside it; the settings file as
     written (mode 600); the unit file passes `systemd-analyze verify`, and
     the Builder ran as a systemd service with the unit's hardening
     (`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths`). Caddy
     is not on this machine, so HTTPS in front was not tried.
   - Step 6, "Check it", every check passing (one failed first on the
     drill script's own mistake, a field name): a Build (the Report in
     4.8 s), the Report served gzipped, the page's `og:image`, the card as
     a PNG (resvg), signing in through the App's OAuth flow, `/api/me`
     listing the installation's repositories, a signed webhook taken and
     an unsigned one refused (401), the Cron Trigger, `share`, `share
     --list` and `share --delete` (then 404), and `node builder.mjs seed`
     writing the boards.
   - Found and fixed on the way: `share` printed "It works in any browser
     until in 3 h 59 min"; it now says "and expires in 3 h 59 min". The
     seed check first needed an inline signing script, now a command,
     `node builder.mjs seed`.
4. **The security pass** read every endpoint, the Builder and `share`,
   each finding checked against the code before it was fixed. Nothing
   high; four medium, seven low, all fixed:

| Finding | Severity | Fix |
|---|---|---|
| One address could queue 20 large Builds an hour, 900 s each, one at a time: hours of work for the Builder | medium | The Site refuses a Build while 30 of people's Builds wait or run; the Builder refuses past 250; people's Builds go ahead of the night's seeds |
| An IPv6 client has a /64 of addresses, each with its own limits; 30 Shared Reports an hour of 25 MB could fill R2's 10 GB | medium | Limits count an IPv6 address by its /64; all Shared Reports together are capped at 4 GB ("try again in an hour or two") |
| A Connected Repository's index (names, subjects, paths) stayed on the Builder's disk after its Build; indexes were never pruned | medium | A private Build gets its own cache folder, deleted, clone and index, when it ends; the disk budget counts indexes |
| A private Report could be served to anyone once its name passed to a new public repository | medium | The Site keeps GitHub's repository id; access needs the same id (ADR-0017 amended) |
| `$'` in a description garbled the stored `/gh/` page (no script ran) | low | The replacement is a function |
| A public Report stayed readable at `/api/reports` after the repository went private | low | Facts an hour old are asked again before a public Report is served |
| Deleting an installation of over 100 repositories, or a person with many sessions, passed D1's limits | low | Deletes in chunks of 50, and one statement for access answers |
| Lookups were unlimited: each unknown repository costs four GitHub requests | low | 300 lookups that ask GitHub per address an hour (429 after); names GitHub had none for are forgotten after a week |
| `/gh/%E0/x` threw (Cloudflare's error page) | low | Caught: the app's shell; the API says 400 |
| The Builder's secrets reached git and commitscape's environment | low | Commands get an allow-listed environment; `health` gets `GH_TOKEN` by name |
| `shares.json` (links with their keys) was written readable by others | low | Written mode 600 on Unix |
| (Correctness) `.github` passed the Site but not the Builder | – | The Builder takes names starting with a dot, but not `.` or `..` |

   Checked and found right: the HMAC over method, path, time and body
   (±300 s), upload tokens compared by hash, R2 keys from D1 rather than
   the request, names rejected before any path or URL, OAuth state tied to
   a cookie, sessions and tokens hashed or sealed, cookies HttpOnly and
   SameSite=Lax, Origin checks on every change, webhook HMACs, the
   Builder on 127.0.0.1 with 64 KB bodies, the process-group kill, Shared
   Reports' keys never sent and removed from the address bar, no
   `dangerouslySetInnerHTML`, escaped card text, and no `@` anywhere in a
   hosted Report (tested).
5. **Found by the security work, beyond the review:** the seeds handler
   bound one value per due repository, up to twice the budget, past D1's
   100 a statement (a budget of 60 is 120). It is one query now, each
   repository joined to its last Build, with a new index on
   `builds(repo_id, requested_at)`, which every lookup's last-Build query
   uses too (migration `0005_security`).
6. **CPU of every handler**, measured again with the machine quiet, after
   the fixes (`apps/site/scripts/cpu.test.ts`: the real handlers in Node,
   200 runs each). The harness now counts SQLite's own share, which is
   D1's on Cloudflare and not the Worker's, and asserts that both the
   whole median and the Worker's own are under 10 ms. Every median is,
   the heaviest the nightly seeds (2.4 ms of the Worker's own) and the
   boards (2.1 ms). The 99th percentiles swing from run to run (76 ms once
   for a two-query handler): Node's garbage collector and compiler count in
   `process.cpuUsage()`, so they are an upper bound, not a prediction. The
   two nightly requests are retried once by the Builder should one ever be
   cut off.

| Handler | Status | CPU, median | CPU, 99th percentile | Without SQLite, median | Without SQLite, 99th |
|---|---|---|---|---|---|
| GET /api/repos/:owner/:name (facts kept) | 200 | 0.50 ms | 76.16 ms | 0.39 ms | 75.79 ms |
| GET /api/repos/:owner/:name (facts asked of GitHub) | 200 | 0.92 ms | 5.59 ms | 0.67 ms | 4.21 ms |
| GET /api/reports/:owner/:name (6644 bytes) | 200 | 0.24 ms | 2.02 ms | 0.20 ms | 1.74 ms |
| GET /api/cards/:owner/:name | 200 | 0.18 ms | 1.18 ms | 0.16 ms | 1.16 ms |
| GET /gh/:owner/:name (the stored page) | 200 | 0.10 ms | 2.13 ms | 0.08 ms | 1.50 ms |
| POST /api/builds (asks GitHub, starts one) | 202 | 1.41 ms | 8.65 ms | 1.00 ms | 8.01 ms |
| POST /api/builds/:id/progress | 200 | 0.28 ms | 1.27 ms | 0.24 ms | 1.22 ms |
| PUT /api/builds/:id/report (200000 bytes) | 200 | 0.52 ms | 16.24 ms | 0.47 ms | 16.11 ms |
| POST /api/builds/:id/done (stores the page) | 200 | 0.83 ms | 2.00 ms | 0.66 ms | 1.80 ms |
| POST /api/shares | 201 | 0.25 ms | 1.96 ms | 0.17 ms | 1.89 ms |
| PUT /api/shares/:id (200000 bytes) | 200 | 0.43 ms | 6.13 ms | 0.38 ms | 6.08 ms |
| GET /api/shares/:id (200000 bytes) | 200 | 0.35 ms | 5.57 ms | 0.23 ms | 5.54 ms |
| DELETE /api/shares/:id | 200 | 0.20 ms | 3.19 ms | 0.16 ms | 3.09 ms |
| GET /api/auth/github (off to GitHub) | 302 | 0.02 ms | 0.02 ms | 0.02 ms | 0.02 ms |
| GET /api/auth/callback (signs in) | 302 | 0.46 ms | 3.23 ms | 0.41 ms | 3.18 ms |
| GET /api/me (30 repositories) | 200 | 0.39 ms | 1.40 ms | 0.34 ms | 1.35 ms |
| GET /api/repos/:owner/:name (private, access asked) | 200 | 0.71 ms | 2.10 ms | 0.56 ms | 1.95 ms |
| GET /api/reports/:owner/:name (private, access kept) | 200 | 0.49 ms | 1.50 ms | 0.40 ms | 1.41 ms |
| POST /api/builds (private: App JWT and installation token) | 202 | 1.26 ms | 9.00 ms | 0.86 ms | 7.85 ms |
| POST /api/github/webhooks (signed) | 200 | 0.10 ms | 0.66 ms | 0.10 ms | 0.66 ms |
| POST /api/seeds (90 seeds, all due) | 200 | 4.44 ms | 31.10 ms | 2.37 ms | 28.20 ms |
| POST /api/leaderboards/write (90 built) | 200 | 3.25 ms | 9.52 ms | 2.05 ms | 6.06 ms |
| GET /api/leaderboards | 200 | 0.04 ms | 0.30 ms | 0.04 ms | 0.30 ms |
| GET /api/nope | 404 | 0.02 ms | 0.99 ms | 0.02 ms | 0.99 ms |
| Cron Trigger: 100 expired Shared Reports removed | – | 0.86 ms | 5.64 ms (max of 30) | 0.47 ms | 3.81 ms |
| Cron Trigger: the boards written again (90 built) | – | 3.42 ms | 10.44 ms (max of 30) | 2.23 ms | 8.67 ms |

7. **Checks:** `cargo fmt`, clippy, 255 Rust tests (after `cargo xtask fixtures --force`), 49 vitest, 16 local and 22 Site Playwright tests, `cargo xtask
   check-layering`, `pnpm check` (typecheck, lint, test and build of
   every package through Turborepo), actionlint with shellcheck on both
   workflows, and `nix build` (the pnpm hash unchanged; the binary is
   13.4 MB, 10.9 MB before Phase 28's `share`). None has run on GitHub's
   CI: that happens when the owner pushes.
8. **Decisions:** the drill used `wrangler deploy --dry-run` and `.dev.vars`
   in place of a deploy and `wrangler secret put`, and a systemd user
   service in place of a system one; nothing reached Cloudflare or GitHub.
   Limits chosen: 30 people's Builds waiting Site-wide, 250 on the
   Builder, 300 lookups an hour per address, 4 GB of Shared Reports.

Files created, changed or deleted in Phase 31:
- Created: `DEPLOY.md`; `apps/site/drizzle/0005_security.sql` (and
  `meta/0005_snapshot.json`), `apps/site/src/api/security.test.ts`.
- Changed: `README.md`; `docs/adr/0015-*.md`, `docs/adr/0017-*.md`;
  `crates/commitscape/src/share.rs`;
  `crates/commitscape-metrics/src/people.rs`, `crates/commitscape-web/src/api.rs`,
  `crates/commitscape-web/tests/server.rs` (the 1,000-person cap, found on
  the boards);
  `apps/site/src/{api.ts,server.ts,db/schema.ts}`,
  `apps/site/src/api/{access.ts,auth.ts,boards.ts,boards.test.ts,builds.ts,github.ts,http.ts,lookup.ts,reports.ts,shares.ts,webhooks.ts}`,
  `apps/site/src/routes/{index.tsx,privacy.tsx}`, `apps/site/src/test/r2.ts`,
  `apps/site/drizzle/meta/_journal.json`, `apps/site/scripts/cpu.test.ts`,
  `apps/site/e2e/site.spec.ts`;
  `apps/builder/src/{run.ts,server.ts,disk.ts,site.ts,seeds.ts,main.ts,builder.test.ts}`;
  `STATE.md`.
- Deleted: none (a stray `apps/builder/health`, written by a test in
  Phase 30 and never tracked, was removed).

## Phase 32 findings

1. **The grey-then-blue flash was Astryx injecting the theme in the browser.** `Theme` writes a theme's CSS in `useInsertionEffect` unless the theme is marked built, so the server's page had the neutral theme's accent until hydration. `themeCss()` (`packages/ui/src/theme.ts`) now generates the same CSS with Astryx's own `generateThemeCSS`, in the same layers, and the root route puts it in a `<style>` in the head; the theme passed to `Theme` is marked `__built`, so nothing is injected (tested: no `style[data-astryx-theme]` element, and no "runtime style injection" warning).
2. **The chosen mode lives in a cookie** (`commitscape-theme`), not `localStorage`, so the server writes `<html data-theme="dark">` when someone chose dark. "Follow the system" needs nothing: Astryx's colours are `light-dark()` under `color-scheme: light dark`, which the browser resolves before the first paint.
3. **One `Theme`, one header.** The root route draws the theme, the toasts and the frame (logo, a box that takes a username or `owner/repo`, Leaderboards, sign-in or the viewer's avatar, the mode); pages draw only their content, so the header never remounts on navigation. The logo (`.github/logo.svg`) is `public/favicon.svg` and the `Logo` component; the old three-rectangle mark and the empty favicon are gone.
4. **Charts drew twice because they measured themselves.** Every chart rendered nothing until a `ResizeObserver` gave it a width, so the server's page had empty boxes that filled after hydration. The column chart is now plain HTML and CSS with percentage geometry (`charts/Columns.tsx`), drawn by the server once; the line, hour, week and calendar charts and the Map draw in a fixed coordinate space scaled by `viewBox`.
5. **Releases are thinned to those that fit** (`charts/marks.ts`): newest first, a release line only 3.5% of the width from the last one drawn, a label only 13% from the last label, and the note says how many were drawn ("12 of 79 releases drawn, where they fit" on ripgrep). Labels are hidden under 760 px. Hand-worked tests in `charts/columns.test.ts`.
6. **Streaming with Suspense.** A screen's answer now comes through `useSuspenseQuery`; `@tanstack/react-router-ssr-query` streams each boundary's data into the page as it resolves, so nothing is fetched twice. A missing answer is a value, not a throw, so a screen still says "This Report was written without it". Changing the Window keeps the old screen at 60% opacity (`useDeferredValue`) instead of falling back to a skeleton. Each screen's skeleton has its final layout: tiles and blocks have fixed heights (`.tile` 104 px, the chart 262 px, contributors 380 px). Layout shift, measured by a `PerformanceObserver` over `layout-shift` in Playwright, is 0.0000 on all ten pages tested. Two causes were found and fixed on the way: `.app` had `margin: 0 auto` inside a flex column, which turns off stretching, so it was as wide as its content until the table hydrated (0.0235 on ripgrep's People); and on short pages the footer arrived inside the viewport once the stream finished (0.0589), so the content area is now at least the viewport's height.
7. **No request after hydration repeats the server's.** Playwright records every `/_serverFn/` request after `load` on each page; there are none. The Commit List is the one answer asked in the browser on purpose (`useLazyData`): it can be megabytes, and putting it in the page would make every repository page that heavy.
8. **The repository page, trimmed.** Gone from the Site: the story so far, Did you know, Worth a look, Code age and the Risk screen (`screens/Risk.tsx` deleted; Risk stays in the CLI, and in the MCP server's `read_report`, which still reads the stored Report's risk answer). Kept: the stat tiles, one chart of commits with releases, Contributors (avatar, commits, share, lines added and removed), Languages, People, Activity, the Map and Commits. Hidden when empty: Kinds of work when fewer than a quarter of commits can be told, pull requests and issues when GitHub's history was not read, and any People column that would be all dashes; "Folders held" is gone. The header draws GitHub's facts at once (owner's avatar, stars, forks, main language, licence, created), and the Report streams in under it.
9. **Avatars everywhere, from logins the Builder finds.** Builds run `--offline`, so the engine knew GitHub logins only for noreply addresses; ripgrep showed colour squares. After a Build the Builder now reads the Report's people and each one's newest commit, asks GitHub's GraphQL API which account that commit belongs to (50 people a request, the 500 with most commits who have none), and stores the repository's people in Postgres (`repo_people`, migration `0001_repo_people`). ripgrep: 442 of 484 people found in 10 requests. Someone with no account gets their initials (`Face`). Those rows are also what Profiles and Standings join on later.
10. **Search across the page**: ⌘K or the Search button finds people, folders and files, and always offers "Commits that mention …", which opens Commits with that search.
11. **CSRF.** TanStack Start's `createCsrfMiddleware` now guards server functions (it warned on every page before).
12. **Mobile.** Under 640 px the header keeps the logo, search hidden, and Sign in; the tabs scroll; the Window and Search wrap under them; contributors drop the lines column.

Files created: `apps/site/src/lib/target.ts`, `apps/site/e2e/foundation.spec.ts`, `apps/builder/src/github.ts`, `apps/builder/src/people.ts`, `apps/builder/src/people.test.ts`, `packages/ui/src/mode.ts`, `packages/ui/src/charts/marks.ts`, `packages/ui/src/charts/columns.test.ts`, `packages/ui/src/components/Face.tsx`, `packages/ui/src/components/login.ts`, `packages/ui/src/components/skeletons.ts`, `packages/server/drizzle/0001_repo_people.sql`. Deleted: `packages/ui/src/screens/Risk.tsx`, `apps/site/src/components/Connect.tsx`. Changed: the root route, `Frame`, `States`, every page route, `Facts`, `functions/account.ts`, `functions/repos.ts`, `server/repos.ts`, `start.ts`, `site.css`; in `packages/ui` `App`, `data`, `theme`, `route`, `keys`, `jump`, `Palette`, `format`, `help`, `index.css`, every chart and screen, `Name`, `Logo`, `Loading`; the Builder's `job.ts` and `main.ts`; the schema.

## Phase 33 findings

1. **A Profile is read in two stages, and kept as two copies** (ADR-0023). Stage one is the person and their yearly `contributionsCollection`s; stage two is their pull requests, searched by date range. Each is stored in `profiles` (migration `0002_profiles`) as soon as it is read, with GitHub's raw answers so stage two never repeats stage one. The public copy never holds a private repository's name or a private pull request's title; the person's own copy (`scope = self`), read with their own token, names their private work to them alone, with a "private: only you see this" badge. Server logic is `apps/site/src/server/profiles.ts`; server functions `functions/profiles.ts`.
2. **Reading pull requests.** Paging `user.pullRequests` with each one's reviews took 5 s a page, one page after another: gaearon's Profile took 70 s. Search by year, then by month, was 43 s and missed the owner's busiest year. The kept strategy asks a date range and, when GitHub says it holds more than 100, splits it in two and asks both halves, ten requests at a time, up to 3,000 pull requests; reviewers come from one separate request over the newest 100. Concurrent searches are slow on GitHub's side (a lone page 2 to 4 s, ten at once 3 to 10 s each), so stage two stays slow and the page no longer waits for it.
3. **Measured on this machine, against GitHub, cold, with a normal browser** (`stages.local.mjs`, not in the repository):

| Profile | Hero | Tiles (stage one) | Everything (stage two) | Warm, everything |
|---|---|---|---|---|
| devchaudhary24k (617 pull requests, 6 years) | 0.81 s | 3.9 s | 19.0 s | 0.65 s |
| gaearon (3,569 pull requests, 16 years) | 0.86 s | 9.2 s | 34.5 s | 0.56 s |
| torvalds (85 pull requests, 15 years) | 0.62 s | 3.1 s | 5.0 s | 0.62 s |

4. **GitHub requests per view.** Cold: 1 for the hero when no copy is stored, then stage one is 1 + ⌈years ÷ 2⌉ and stage two is one per date range searched plus one: devchaudhary24k 23, gaearon 103 (every pull request read), torvalds 17. Warm (a copy under a day old): 0. GitHub's GraphQL budget is 5,000 points an hour per token, so the Site's token covers roughly 50 cold busy Profiles an hour; signed-in viewers use their own (ADR-0020). Tests assert the counts on hand-written answers (`profiles.test.ts`).
5. **Bots get the whole page.** TanStack Start streams to browsers and waits for everything for bots (by user agent), so link previews see the numbers and the title. Headless Chromium calls itself a bot, which hid streaming from my first measurements; the Playwright config now sends a normal browser's user agent, so the gates measure what people see.
6. **What a Profile shows** (`packages/ui/src/profile/sections.tsx`, shared with later pages): the hero (avatar, name, login, bio, company, location, joined, followers); tiles for pull requests merged (of opened), reviews given, commits, lines added and removed in merged pull requests, time to merge (the middle one), active days and the longest streak with the one running now; the last year's calendar (quantile steps, as GitHub does); contributions over the years; where their work is (each repository with merged pull requests, commits, reviews and lines merged, a column each); languages year by year (each repository's main language weighted by their commits, the six most used in the fixed palette order, the rest as Other); and the people they work with most (who reviewed theirs, whose they reviewed, bots left out). "Unknown" is "—", never 0, and the foot says when it was read and how many pull requests were.
7. **Private contributions** GitHub reports as `restrictedContributionsCount` are a line under the work list ("Also 4,387 private contributions, counted in the totals and never named") and part of the totals. A public copy's totals depend on whose token last refreshed it (ADR-0023's consequence).
8. **The "Read user profile" permission is not needed.** Everything a Profile reads is public, or read with the person's own token for their own copy. A GitHub App user token sees private work only in repositories the App is installed on, so someone's own copy shows the private work they connected; that is the honest limit and the page does not claim more.
9. **The landing page** is about the person now: the headline, a box that takes a login, `@login`, a profile link, `owner/repo` or a repository link (`parseTarget`, tested), "See your own" (through `/you`, which sends a signed-in person to their Profile and anyone else to sign in), four example Profiles with avatars, what the Site does in three lines, and the install commands.
10. **Organizations and unknown names** each say so plainly; an organization's page shows its card and points to its repositories.

Files created: `apps/site/src/server/graphql.ts`, `apps/site/src/server/profiles.ts`, `apps/site/src/server/profiles.test.ts`, `apps/site/src/functions/profiles.ts`, `apps/site/src/components/Boundary.tsx`, `apps/site/src/routes/u.$login.tsx`, `apps/site/src/routes/you.tsx`, `apps/site/e2e/graphql.ts`, `apps/site/e2e/profile.spec.ts`, `packages/data/src/profile.ts`, `packages/ui/src/profile/sections.tsx`, `packages/server/drizzle/0002_profiles.sql`, `docs/adr/0023-a-profile-is-read-in-two-stages-and-kept-as-two-copies.md`. Changed: the landing page, `lib/queries.ts`, `server/viewer.ts`, `e2e/github.ts`, `e2e/start.ts`, `playwright.config.ts`, `site.spec.ts`, `foundation.spec.ts`, `packages/data` (`github.ts`, its test, `index.ts`), `packages/ui` (`charts/Grid.tsx`, `components/Loading.tsx`, `index.ts`, `index.css`), the schema.

## Phase 34 findings

1. **The engine** (built by a delegated agent, reviewed here; ADR-0022's "As built" section has the rules). `commitscape surviving [REPO] --person <ID>... [--budget-seconds N] [--cache-dir DIR] [--partial] [--offline]` prints one JSON line: the head and, per person, `counted` with Surviving Lines and lines added, `over_budget` (no number), or `unknown_person`. Person ids are the Report's `PersonRef.id` for the same cache and head (tested). New code: `crates/commitscape-index/src/{blame,similarity,surviving}.rs`, `cache/blame_store.rs`, `gix_source/blame.rs`, `crates/commitscape/src/surviving.rs` and its tests; `Surviving` types in `api.rs`, so `packages/data/src/types.ts` is regenerated.
2. **The hand-worked fixture** (`survival`, in `docs/fixtures.md`; `git blame --ignore-revs-file` agrees on every line). With the Bulk threshold at 3: Alice 5 surviving of 11 added, Bob 10 of 13, Carol 5 of 7. At the default threshold of 50: Alice 1, Bob 17, Carol 2, added 11, 29, 7. It has an overwritten file, a moved-and-edited file, a Bulk reformat, an ignored commit, a lockfile, a Markdown file and a merge.
3. **Measured** (release build, a Ryzen 5 3500, index warm from `report` as on the Builder, budget 3,600 s while measuring):

| Repository | Person (rank by commits) | Files blamed | Cold | Warm | Surviving of added |
|---|---|---|---|---|---|
| BurntSushi/ripgrep | 1st, Andrew Gallant | 189 | 0.16 s | 0.00 s | 61,148 of 106,349 |
| BurntSushi/ripgrep | 11th, Thayne McCombs | 4 | 0.04 s | 0.00 s | 271 of 275 |
| facebook/react | 1st, Joe Savona | 1,943 | 4.86 s | 0.02 s | 140,099 of 608,336 |
| facebook/react | 12th, Ruslan Lesiutin | 374 | 1.84 s | 0.00 s | 22,213 of 103,680 |
| facebook/react | 50th, Keyan Zhang | 50 | 0.91 s | 0.00 s | 1,338 of 31,244 |
| rust-lang/rust | 1st, Ralf Jung | 4,514 | 48.5 s | 0.05 s | 65,167 of 242,853 |
| rust-lang/rust | 10th, Michael Goulet | 8,648 | 123.3 s | 0.05 s | 132,293 of 273,312 |
| rust-lang/rust | 50th, Noah Lev | 1,049 | 30.7 s | 0.03 s | 11,404 of 29,230 |

   Three people in one call: react 6.6 s cold, 0.09 s warm; rust 166.5 s cold, 0.62 s warm. Through the Site's Builder on this machine, ripgrep's top person was counted in 1.3 s from the click.
4. **The budget is 60 s** (`SURVIVING_BUDGET_SECONDS`). It counts everyone measured on ripgrep and react, and rust's 1st and 50th; rust's 10th needs 124 s cold and three 60 s tries never finish, because each try restarts the walk from the head and keeps only finished files. Saving a walk's progress is the follow-up (open item for Build Run 6); until then a Builder for huge repositories can raise the budget.
5. **On the Site.** The Builder takes counts from a new pg-boss queue (`survival`), one job per request, and runs the command on its own clone's path (an `owner/name` fetches and resets first, which could move the head and renumber people), else the name. Answers go to `surviving` (repository, Report, person; migration `0003_surviving`): `counted`, `over_budget`, `not_counted` (a history read without old files, as `--partial` repositories are: anything over `FULL_CLONE_UP_TO_MB`, facebook/react included at the default 100 MB), `failed` or `stale` (the Report was replaced). A Profile asks for the counts it lacks (12 repositories at once, 60 asks an hour per address), re-asks anything unanswered after 30 minutes, and polls every 3 s only while something is counting.
6. **Streaming without hydration mismatches.** Polling the same query the server streamed changed it before React hydrated a later boundary, so the client drew "61k" where the server drew "counting…". The page now keeps the streamed snapshot and polls a separate query that only hydrated components read (`useHydrated`, `liveEngineQuery`).
7. **What the Profile shows.** A "lines that still run" tile, second after pull requests merged (it leads, being the hardest to inflate), with Survival when it is a share; and "In the repositories commitscape has read": each repository with the person's commits, Lines Changed, Surviving Lines (or why not) and Survival, from the repository's own history under every address they commit with.
8. **Decision: Survival is not shown above 100%.** `added` is exactly Lines Changed (no Bulk Commits), while Surviving Lines can keep an import's lines, so the share can pass 100%. Rather than cap it, it is not shown then (`survival()`, tested). Prose counts in `added` but not in Surviving Lines, so people who write docs get a lower Survival; CONTEXT.md says what both count.
9. **Six Builders at once.** My restarts used `pgrep -f "^node dist/builder.mjs work"`, which never matched the real command line, so old Builders kept taking jobs and the new pull-request step looked broken. Found by `pgrep -af`; worth knowing for anyone running the Builder by hand.

Files created: the Rust files in finding 1, `crates/commitscape/tests/surviving.rs`, `apps/builder/src/survival.ts`, `apps/builder/src/survival.test.ts`, `apps/site/src/server/engine.ts`, `apps/site/src/server/engine.test.ts`, `apps/site/src/lib/hydrated.ts`, `packages/ui/src/profile/engine.tsx`, `packages/ui/src/profile/engine.test.ts`, `packages/server/drizzle/0003_surviving.sql`. Changed: `crates/commitscape-index/src/{source,scripted,lines,lib}.rs`, `gix_source/mod.rs`, `cache/mod.rs`, `cache/line_store.rs`, `crates/commitscape-core/src/index.rs`, `crates/commitscape-report/src/api.rs`, `crates/commitscape/src/main.rs`, `xtask/src/fixtures.rs`, `docs/fixtures.md`, `packages/data/src/{types,profile}.ts`, `packages/server/src/{queue,db/schema}.ts`, the Builder's `run.ts`, `main.ts`, `config.ts`, the Profile route, `functions/profiles.ts`, `lib/queries.ts`, `e2e/{graphql,start,profile.spec,foundation.spec}.ts`, ADR-0022, CONTEXT.md.

## Phase 35 findings

1. **The Builder keeps pull requests and reviews** (`apps/builder/src/pulls.ts`; tables `pull_requests` and `pull_reviews`, migration `0004_standings`). After each Build it queues a read (pg-boss queue `pulls`): GraphQL, 50 pull requests a page with up to 40 reviews each, newest update first, stopping at the first one older than the last read (`repositories.pulls_at`). A read past its time limit (`PULLS_TIME_LIMIT_SECONDS`, 30 minutes by default) keeps what it wrote and does not move the mark, so the next starts from the newest again. Bots are kept with `[bot]` and never ranked; a review of one's own pull request does not count.
2. **facebook/react, on this machine against GitHub:** the first read took 1,414.6 s (23.6 min) for 20,362 pull requests and 13,177 reviewer rows in 408 pages; the next, 1.5 s for one page. ripgrep's first read: 82 s for 1,168. React's first read is longer than the default time limit, so a fresh deployment needs one longer run, or several, before its Standings show all of React's pull requests: noted for the owner.
3. **Standings** (`apps/site/src/server/standings.ts`, `packages/data/src/standings.ts`): everyone the engine found in the repository's current Report, joined by GitHub login (lower case) with everyone in its pull requests and reviews. Five views (lines that still run, pull requests merged, pull requests reviewed, lines added, commits), each ranked on its own; ties share the higher place; a person with nothing in a view has no place in it; never a combined score. Surviving Lines are asked for the 30 people with most commits and anyone whose page is opened. What each person works on is the folder of their most-changed files, from their entry in the stored Report.
4. **You in this repository** (`/u/<login>/<owner>/<repo>`): the person's numbers with their place in each view ("1st of 20"), a headline when one place is in the top tenth of twenty or more ("Top 1% of BurntSushi/ripgrep's 478 contributors by commits"), and the whole Standings table, sortable by view, with the person highlighted. ripgrep's is screenshotted in both themes.
5. **Privacy.** A private repository's Standings use the same access check as its Report (GitHub must show the viewer the repository, and with the same id), remembered for five minutes. **Hiding** is a person's choice in Settings (`people` table): a hidden person is left out of everyone else's Standings, their Profile shows only that it is hidden, their engine numbers are empty to others, MCP refuses them, and they have no Cards; they still see their own, with a banner saying they are hidden. A second choice names their private work on their public Profile (it shows their own copy). "Delete my data" removes both choices and their own copy, so deleting also un-hides; the page says so.
6. **Settings** (`/me`) now has who you are, the two choices as switches, Connected Repositories and "Delete my data". **`/privacy`** is rewritten for Profiles, comparisons and staying out, Cards, repositories and pull requests.
7. **MCP**: `read_profile` (public work only, refuses a hidden person) and `read_standings` (hidden people left out), beside the repository tools. The server's description no longer mentions AI.
8. **Not tested end to end: signing in.** Better Auth's GitHub provider cannot be pointed at the fake GitHub, so Settings' switches and a signed-in person's own view are tested in vitest against PGlite, not in Playwright. Build Run 4 had the same limit.

Files created: `apps/builder/src/pulls.ts`, `pulls.test.ts`; `apps/site/src/server/{standings,people}.ts`, `standings.test.ts`; `apps/site/src/functions/standings.ts`; `apps/site/src/routes/u.$login_.$owner.$repo.tsx`; `packages/data/src/standings.ts`, `standings.test.ts`; `packages/ui/src/standings/{Standings.tsx,places.ts}`; `packages/server/drizzle/0004_standings.sql`. Changed: the Builder's `job.ts`, `main.ts`, `config.ts`; `server/{profiles,engine,mcp,me}.ts`; `routes/{me,privacy,u.$login}.tsx`; `lib/queries.ts`; the e2e specs; the schema and queue.

## Phase 36 findings

1. **The pipeline** (ADR-0021's "As built" section): Card components in `packages/ui/src/cards/Cards.tsx`, flexbox and inline styles only; `renderCard` (`cards/render.tsx`) draws the SVG with Satori, then gives it its animation, and keeps a still copy for resvg. On the Site, `server/cards.ts` takes a Card's numbers only from stored copies (a person's public Profile, the engine's counts, a repository's Standings), never from GitHub, and keeps the images in R2 for six hours.
2. **The set**: Totals, Survival ("61k of the 106k lines I wrote still run."), Top repositories, Calendar, Languages over the years, a link preview, You in a repository, and a repository's hall of fame; each light and dark, each `.svg` (animated) and `.png` (still, at twice the size). Archetype, Achievements, Versus, Race, Season, Proof of Work and Wrapped Cards come with their phases.
3. **Render time**, SVG and PNG together, warm: Totals 44 ms, Survival 39 to 44 ms, Top repositories 58 to 65 ms, Languages 53 to 59 ms, Calendar 115 to 135 ms, link preview 75 ms, You in a repository 39 ms, hall of fame 114 ms (dev server, after the avatars were fetched); the first Card after a start 57 ms in the production build. The vitest test asserts under 200 ms for every Card in both themes.
4. **Addresses**: `/api/cards/u/<login>/<card>.svg|png?theme=dark`, `/api/cards/u/<login>/<owner>/<repo>/standing.svg|png`, `/api/cards/gh/<owner>/<repo>/hall-of-fame.svg|png`, `/api/cards/site/preview.png`. Served with `cache-control: public, max-age=21600` and a content security policy that allows nothing but inline styles and data images.
5. **The gallery** (`/u/<login>/cards`): each Card in both themes, the README Markdown (a `<picture>` that follows the reader's theme, linked to the Profile), a PNG to download, and "Post on X" and "Post on LinkedIn" (LinkedIn reads the Profile's preview image). The Profile has a Cards button; a repository's Overview ends with its hall-of-fame Card.
6. **A preview image on every page**: the Profile's preview Card, a person's Standing in a repository, a repository's hall of fame, and the Site's own card for the landing page, Leaderboards, Settings and `/privacy`. The root route sets the default and pages override it.
7. **Bundling Satori.** In the production build Satori's Emscripten layout and text engines failed on `__dirname`, then on a missing `hb.wasm`; they are now external and traced whole (`nitro({ traceDeps: ["satori*", "harfbuzzjs*", "@resvg/resvg-js*"] })`, `ssr.external`), and kept out of Vite's dependency optimizer in development, which choked on resvg's native file. Satori also lays out a React fragment as a row, which broke the Survival Card's first version; Cards use plain `div`s.
8. **A Profile page was 1 MB** because the whole pull request list streamed to the browser; the page's server functions now leave it out. A busy Profile (gaearon) is 400 KB of HTML, 67 KB gzipped, in production; it holds stage one and stage two both, which is a later trim.

Files created: `packages/ui/src/cards/{Cards.tsx,kinds.ts,render.tsx,paint.ts,paint.test.ts,sizes.ts,tokens.ts,fixture.ts,cards.test.tsx}`, the fonts and their licence in `cards/fonts/`, the SVG snapshots; `apps/site/src/server/{cards,serve-card}.ts`, `cards.test.ts` and its PNG snapshots; `apps/site/src/functions/cards.ts`; `apps/site/src/components/CardBox.tsx`; `apps/site/src/lib/markdown.ts`; the Card routes under `src/routes/api/cards/`; `apps/site/src/routes/u.$login_.cards.tsx`; `apps/site/e2e/cards.spec.ts`; `packages/server/drizzle/0005_cards.sql`. Deleted: the old `src/routes/api/cards/$owner/$repo.ts`. Changed: the Builder (no card step, no resvg, its Dockerfile), `vite.config.ts`, the page routes' heads, ADR-0021.

## Phase 37 findings

1. **What it reads.** Merged pull requests through GitHub's GraphQL search (`author:<login> is:pr is:merged merged:<from>..<to>`, with `org:` or `repo:` for a client's organisation or one repository) and commits through GitHub's REST commit search (`author:<login> author-date:<from>..<to>`), up to ten pages each, 1,000 apiece; past that the page says to narrow the period. Kept in memory for ten minutes. `apps/site/src/server/work.ts`; the grouping, totals, Markdown and period presets are in `packages/data/src/work.ts` (tested).
2. **No commit counted twice.** A squash merge ends its subject with "(#123)" and GitHub's own merge commit starts "Merge pull request #123"; a commit like that in the same repository as a listed pull request is left out, since the pull request already stands for it. Nothing is guessed from prose.
3. **Checked against GitHub by hand**, for the owner's September 2026 seen by anyone (the dev Site's token is the owner's, so private work shows to it; the page strips it): `gh search prs --author devchaudhary24k --merged-at 2026-09-01..2026-09-30` finds 101, of which 67 are in the private MHS-Media-Software organisation; the page lists the other 34 with the same count in every repository (maihs-concepts-base-tempate 4, commitscape 9, hexlode 12, vidcastx 9). `gh search commits --visibility public` finds 138, 23 of them repeating a pull request; the page lists 115, the same in every repository (carbon-nix 12, dotfiles 1, maihs-concepts-base-tempate 2, commitscape 32, hexlode 33, vidcastx 35). Screenshots in both themes and the PDF's first page in `target/preview/site/phase37-*`.
4. **Private work.** The person themselves, signed in, sees their private repositories, marked "private: only you see this", read with their own token. Anyone else sees public work only. "Copy the link" copies the page's address (period and filter are in it), which shows public work to whoever opens it. When the person has private work in the period, they tick the private repositories to include and "Share" keeps a snapshot (`proofs` table, migration `0006_proofs`) at `/u/<login>/work/<id>`, with only those; they can delete it there. Tests check a link without any chosen repository holds no private item, and that nobody else can make one.
5. **Downloads**: `/api/work/u/<login>/proof.md|pdf?from&to&filter` (private work included only for the signed-in person, served `private, no-store` then) and `/api/work/s/<id>/proof.md|pdf` for a shared one. The PDF is made with pdfkit and the same Inter fonts as the Cards (exported from `@commitscape/ui/cards/fonts`), each item linked to GitHub; pdfkit is external and traced in the build as Satori is.
6. **The page**: a period (last month by default; this month, the last three months, this year, last year, or any dates up to a year), "Only in" an organisation or repository, the numbers (pull requests merged, commits, lines in those pull requests, repositories), then each month's repositories with every item linked. The Profile has a "Proof of Work" button. Pages are `noindex`.

Files created: `packages/data/src/work.ts`, `work.test.ts`; `packages/ui/src/work/WorkView.tsx`, `packages/ui/src/cards/fonts.ts`; `apps/site/src/server/{work,work-pdf,serve-work}.ts`, `work.test.ts`; `apps/site/src/functions/work.ts`; the routes `u.$login_.work.tsx`, `u.$login_.work_.$id.tsx`, `api/work/u/$login/$file.ts`, `api/work/s/$id/$file.ts`; `apps/site/e2e/work.spec.ts`; `packages/server/drizzle/0006_proofs.sql`. Changed: `e2e/{graphql,github,foundation.spec}.ts`, `vite.config.ts`, `lib/queries.ts`, the Profile route, the schema.

## Phase 38 findings

1. **Versus** (`/vs/<a>/<b>`): both heroes at once from their stored identities; the comparison streams in. Eight views (lines that still run, pull requests merged, reviews given, commits, lines added in merged pull requests, active days, longest streak, time to merge), each with its own winner: the higher number, or the lower for time to merge; a tie when equal; no winner when either side is unknown ("—"). There is no overall winner and no count of views won, on the page or the Card (a Playwright test looks for one). `versusRows` and `gapsTo` are pure functions in `packages/data/src/versus.ts`, tested on hand-worked fixtures; `apps/site/src/server/versus.ts` reads each side from its public Profile (stored, or read) and its counted Surviving Lines.
2. **Hidden people are refused**: a Versus with someone hidden says "@bob has chosen to stay out of comparisons", its Card answers 404, and their Profile says only that it is hidden. A person against themselves is refused too.
3. **The Versus Card** (640 wide, a row a known view, a dot in the brand colour for each winner) at `/api/cards/vs/<a>/<b>/versus.svg|png`, and the page's preview image. The first version used "●", which Inter's Latin subset lacks, so Satori drew a missing-glyph box; the dot is now drawn.
4. **Rivals**: "Make my Rival" on someone else's Profile (and "Compare with me"), up to five (`rivals` table, migration `0007_rivals`); Settings lists them with Remove. On your own Profile, "Your Rivals" shows the gap to each: pull requests merged this month and contributions this month (from the Profile's months, on GitHub's calendar), and lines that still run over all time when both are counted. **The brief's "312 Surviving Lines behind this month" is not possible**: Surviving Lines are counted at a head, not by month, so the monthly gaps are in pull requests and contributions and the page says so. Rivals are not told; a Rival who hides shows only that.

Files created: `packages/data/src/versus.ts`, `versus.test.ts`; `packages/ui/src/cards/values.ts`; `apps/site/src/server/versus.ts`, `versus.test.ts`; `apps/site/src/functions/versus.ts`; `apps/site/src/components/Rivals.tsx`; `apps/site/src/routes/vs.$a.$b.tsx`; `apps/site/src/routes/api/cards/vs/$a/$b/$file.ts`; `apps/site/e2e/versus.spec.ts`; `packages/server/drizzle/0007_rivals.sql`. Changed: the Cards (a Versus Card, its fixture and snapshots), `server/{cards,engine}.ts`, the Profile and Settings routes, `lib/queries.ts`, `e2e/{graphql,foundation.spec}.ts`, the schema.

## Phase 39 findings

1. **The rules** are one pure module, `packages/data/src/traits.ts`, and CONTEXT.md states them word for word (a vitest test compares the two). Eight Archetypes, tried in order: Reviewer, Janitor, Firefighter, Night Owl, Polyglot, Weekend Warrior, Marathoner, Builder; nobody under 50 contributions has one, and the first that fits is theirs, the others shown as "also". Ten Achievements: merged into a 10k-star repository, 100 and 1,000 pull requests merged, 100 and 1,000 reviews, 10k lines removed in one pull request, 30- and 100-day streaks, 10,000 lines still running, a line that has survived five years. Every threshold is tested just below and at its line (`traits.test.ts`).
2. **Night Owl needs the hours people work**, which GitHub's contribution calendar does not give. Stage two of a Profile now reads the person's newest 100 commits through GitHub's commit search (one more request), whose author dates carry each commit's own offset; the hour on that clock is what counts. The Profile keeps the histogram (`clock`), not the commits.
3. **A line that has survived five years** needed the engine: `commitscape surviving` now reports `oldest`, the author time of the oldest commit still holding one of the person's surviving lines (null unless counted and above zero; built by the same delegated agent, with hand-worked fixture values in `docs/fixtures.md`; the blame store did not change). The Builder stores it (`surviving.oldest`, migration `0008_oldest_line`) and the Site takes the oldest over a person's public repositories. On ripgrep, Andrew Gallant's oldest surviving line is from 27 February 2016.
4. **When an Achievement was reached** is shown when it is known: the merge of the first pull request into a 10k-star repository, or of the big removal; the day of the 100th merged pull request only when every pull request was read (otherwise the order is not known).
5. **On the Profile**: the Archetype as a badge in the hero (its rule on hover), and a section with the Archetype, its rule, every rule in order on request, and every Achievement, reached ones with their day and a Card link, the rest showing what reaches them. Unreached ones use the secondary text colour, not transparency, which failed contrast.
6. **Cards**: an Archetype Card and one Card for each reached Achievement (`/api/cards/u/<login>/archetype.svg`, `achievement-<id>.svg`; an unreached one answers 404), and both in the gallery.
7. **A button bug found on the way**: the Site's link colour rule also coloured Astryx's link-buttons, so a primary button with `href` showed blue text on blue. The rule now leaves `.astryx-button` alone.

Files created: `packages/data/src/traits.ts`, `traits.test.ts`; `packages/ui/src/profile/traits.tsx`; `apps/site/src/server/traits.ts`, `traits.test.ts`; `packages/server/drizzle/0008_oldest_line.sql`. Changed: `crates/commitscape-index/src/surviving.rs`, `crates/commitscape/src/surviving.rs` and its tests, `crates/commitscape-report/src/api.rs`, `packages/data/src/types.ts`, `docs/fixtures.md`; `packages/data/src/{profile,cards}.ts`; the Cards (Archetype and Achievement, fixtures, snapshots); `apps/site/src/server/{profiles,cards,engine,serve-card}.ts`, `functions/{profiles,cards}.ts`; the Profile and gallery routes; the Builder's `survival.ts` and its test; CONTEXT.md; `site.css`; the e2e specs.

## Phase 40 findings

1. **Signing in end to end, at last.** Better Auth signs its session cookie as `token.base64(HMAC-SHA256(secret, token))`, URL-encoded (better-call's `signCookieValue`). The end-to-end tests know the stand-in Site's secret, so `e2e/accounts.ts` creates a user and a session row and adds the signed `commitscape.session_token` cookie: any number of signed-in accounts without GitHub's sign-in page. Settings' switches and the signed-in flows are now tested in a browser (Phase 35's finding 8 no longer holds). Settings also no longer fails when a GitHub token cannot be read: it shows a banner where the repositories would be.
2. **Seasons** are calendar months on UTC's calendar (`seasonOf`, `seasonDates`, `previousSeason` in `packages/data/src/races.ts`, tested, February in leap years included).
3. **Races** (`/races`, `/races/<id>`): a name, a first and last day (a year at most), and the people invited by GitHub login (20 at most). The starter is in; everyone else appears only after accepting; anyone can decline, and anyone in it can invite more or leave. Before the first day there are no Standings and GitHub is not asked. **Crews** (`/crews`, `/crews/<id>`): the same invitations, compared each Season, with this Season's Standings so far and last Season's as it ended. Settings shows waiting invitations; the footer links both. Tables `races`, `race_members`, `crews`, `crew_members`, `season_standings` (migration `0009_races_and_crews`).
4. **Live Standings** for a window come from one GraphQL request for everyone at once: per person an aliased `user { contributionsCollection(from, to) }` (commits, reviews, contributions) and an aliased `search(... is:merged merged:from..to) { issueCount }` (merged pull requests). Kept 15 minutes; a finished Race's are kept for good once read after its last day; a Season's once it has ended. Each view has its leaders (ties shared, nobody when everyone has nothing), marked, and there is never one winner.
5. **Leaving is immediate**: the person's membership row is deleted, so the next read of the page and its Standings has them gone (tested in vitest and in Playwright, including the database). **Hidden people** are filtered from members and Standings wherever they appear, cannot be invited ("@bob has chosen to stay out of comparisons, so they cannot be invited.") and cannot accept while hidden.
6. **Cards**: one Card for both a Race (its finish Card once it has ended) and a Season recap (last Season, or this one so far if there is none yet), the leader of each view marked (`/api/cards/races/<id>/race.svg|png`, `/api/cards/crews/<id>/season.svg|png`), and their pages' preview images.
7. **Left for the owner**: testing with three real GitHub accounts on the deployed Site (IDEA.md's "Needs the owner"). Everything else is built and tested against the stand-ins.

Files created: `packages/data/src/races.ts`, `races.test.ts`; `apps/site/src/server/races.ts`, `races.test.ts`; `apps/site/src/functions/races.ts`; `apps/site/src/components/{WindowTable,Membership,Start}.tsx`; the routes `races.index.tsx`, `races.$id.tsx`, `crews.index.tsx`, `crews.$id.tsx`, `api/cards/races/$id/$file.ts`, `api/cards/crews/$id/$file.ts`; `apps/site/e2e/accounts.ts`, `races.spec.ts`; `packages/server/drizzle/0009_races_and_crews.sql`. Changed: the Cards (a window Card, fixture and snapshots, `CARD_DESIGN` 3), `server/{cards,viewer}.ts`, `functions/account.ts`, the Settings route, `Frame`, `site.css`, `e2e/graphql.ts`, the schema.

## Phase 41 findings

1. **The people boards** (`/leaderboards`, first on the page; `peopleBoards` in `apps/site/src/server/people-boards.ts`): most pull requests merged, most pull requests reviewed (others' pull requests reviewed at least once, counted on the day of the first review), and most Surviving Lines (at each repository's head, all time). Never one score: three boards, each saying what it counts. The window is a SegmentedControl (`?window=season|last-season|90d|all`, Seasons as in Phase 40) and the repository a select (`?repo=owner/name`), both in the address so the server draws them. Rows link to the person's Profile, or to their page in that repository when one is chosen; ties share a place.
2. **Only seed repositories**, public and built: a board of "everyone on GitHub" would need GitHub's whole history, and a board over whatever happened to be requested would rank people by who looked them up. People who chose to stay out are left out (`hiddenAmong`), and so are accounts ending in `[bot]`. Bots GitHub does not mark as such (freeCodeCamp's `camperbot`, a user account) do appear; an allow-list of bot names would be a guess, so they stay, as GitHub sees them.
3. **Surviving Lines for the boards are now counted by the Builder.** They used to be counted only when someone opened a repository's Standings, so on a fresh Site the third board was empty. After a seed repository's Build, the Builder now queues the counts for its 30 people with most commits who have a GitHub login (in jobs of 10; `queueSeedCounts` in `apps/builder/src/job.ts`, tested). Repositories built without line counts (freeCodeCamp, above the full-history size) are recorded as `not_counted` and are not on that board.
4. **The local seed night** (6 seeds queued from GitHub's search; openclaw/openclaw is over the Builder's size limit and was left out): pull requests read in one go, with `PULLS_TIME_LIMIT_SECONDS=600`: ollama/ollama 7,031 in 457.1 s, avelino/awesome-go 5,653 in 412.9 s, farion1231/cc-switch 2,231 in 177.3 s, clash-verge-rev 1,472 in 91.0 s; freeCodeCamp had 5,750 at the time limit and continues on its next read. The 180 Surviving Lines counts took under 3 s each job, from the blame caches the Builds had left.
5. **Rows say what they count without squeezing names**: a row shows "1,968 reviewed" under the board's title, and the whole wording ("1,968 pull requests reviewed") is its tooltip.
6. **Speed**: the page, all three boards and the repository boards, answers in 80 to 100 ms on this machine (152 KB of HTML); one repository and one Season in 40 ms.

Files created: `apps/site/src/server/people-boards.ts`, `people-boards.test.ts`; `apps/site/e2e/boards.spec.ts`. Changed: `apps/site/src/routes/leaderboards.tsx`, `functions/account.ts`, `lib/queries.ts`, `site.css`, `apps/builder/src/{job,main}.ts`, `job.test.ts`. Screenshots: `target/preview/site/phase41-leaderboards-{light,dark}.png`.

## Phase 42 findings

1. **Wrapped** (`/u/<login>/wrapped/<year>`, any year from 2008 to this one; the Profile links this year's): the year's contributions, merged pull requests (of those opened), reviews, commits, lines added and removed in the merged pull requests, longest streak, busiest day, most-written language, the year's calendar, month by month, and the repositories with most of their commits that year. `wrappedOf` in `packages/data/src/wrapped.ts` is a pure function over a Profile (tested on a year worked out by hand: a streak crossing New Year's Day, a pull request opened one year and merged the next); each year in a Profile now keeps its five repositories with most commits.
2. **Checked against GitHub by hand**, the owner's 2026, with an independent `gh api graphql` query and `gh search prs`: 4,000 contributions (the calendar's total and its days' sum), 483 commits, 72 pull requests opened, 2 reviews, 235 active days, busiest day 18 July with 161, a 29-day streak, and 70 merged pull requests in public repositories (`gh search prs --visibility public --merged-at 2026-01-01..2026-12-31` finds 70; all of them, private included, 512). The page shows exactly these. Screenshots in both themes and the Card in `target/preview/site/phase42-*`.
3. **Private pull requests now count everywhere the same.** A public Profile used to drop private pull requests from its list but count their lines in its totals, so a Wrapped built from the list said 2 where the Profile said 3. The public copy now keeps each private pull request as an unnamed record (no repository, number or title; its dates, sizes and the stars of its repository), so every page counts it and none names it. Firefighter leaves unnamed ones out (their titles are unknown), and an Achievement reached in one says "a private repository".
4. **Cards**: the Wrapped Card (1200 by 630, for posting: the year, four numbers and a strip of the year's calendar) and the year's calendar Card, at `/api/cards/u/<login>/wrapped/<year>/wrapped.svg|png` and `wrapped-calendar.svg|png`, and the page's preview image.

Files created: `packages/data/src/wrapped.ts`, `wrapped.test.ts`; `apps/site/src/server/wrapped.ts`; `apps/site/src/routes/u.$login_.wrapped.$year.tsx`; `apps/site/src/routes/api/cards/u/$login/wrapped/$year/$file.ts`; `apps/site/e2e/wrapped.spec.ts`. Changed: the Cards (two Wrapped Cards, fixture, snapshots), `server/{profiles,cards}.ts`, `functions/profiles.ts`, `packages/data/src/{profile,traits,cards}.ts`, the Profile route, the profile test, `site.css`, README, DEPLOY.md.

## Decisions made during implementation, not in any ADR

1. **`bincode` pinned to `=2.0.1`.** `cargo add` resolves to 3.0.0, which is a
   *tombstone release* — its `lib.rs` contains only a compiler error. Upstream
   archived the GitHub repo in August 2025 and moved to sourcehut. 2.0.1 is the
   last real release and its format is stable. ADR-0002 names bincode and is
   satisfied as written; the supply-chain risk is flagged as a proposed
   amendment rather than silently swapped for another crate.
2. **`gix` with `default-features = false`.** Explicit feature list:
   `sha1`, `mailmap`, `parallel`, `max-performance-safe`. Two reasons: keep the
   network clients out of the binary entirely, and drop `blob-diff`, which
   ADR-0004 forbids us from using in the walk. Features get added only when a
   compile error demands one, so the list doubles as a record of what we use.
3. **The fixture generator shells out to the `git` binary.** Declared exception
   to ADR-0001, which governs how the *product* reads repositories, not how the
   test suite writes them. No product code path reaches `xtask/src/fixtures.rs`.
   This is not the "silent fallback to git" failure mode — it is test tooling
   and it is written down here.
4. **Four crates exist, not five.** `commitscape-tui` is deliberately absent
   until Phase 7. Creating an empty crate now would be scaffolding that looks
   like progress.
5. **The benchmark harness refuses a debug build** and reports `SKIPPED` rather
   than a pass when a benchmark's inputs are missing. A benchmark that silently
   measures nothing is worse than one that fails.
6. **Workspace lints deny `unwrap`/`expect`/`panic` via clippy**, applied to
   every crate including xtask.
7. **Commits store a Signature, not a person.** Resolution to people is a pure
   function of the signature table and the mailmap (`resolve_authors`), so a
   `.mailmap` edit re-resolves in memory (`reresolve_authors`) instead of
   reindexing. A person is shown under their most-used signature, so an
   incremental index and a full one display the same names. Recorded as a
   consequence in ADR-0006 and as a term in `CONTEXT.md`.
8. **Deleted and re-added at the same path is the same file.** A file lives at
   one path at a time; only a rename frees a path. Recorded in `CONTEXT.md`
   under File Identity.
9. **Cache sizes per diff thread: 16 MB objects, 48 MB delta bases.** Larger
   caches (32 and 96 MB) were about 10% faster and cost about 500 MB more peak
   memory.
10. **The cache lives in the platform cache directory**, never in the
    repository: `COMMITSCAPE_CACHE_DIR`, then `$XDG_CACHE_HOME` or `~/.cache`
    on Linux, `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows. The
    key is a hash of the canonical git directory; a different project cloned
    to the same path is caught because none of the cached commits exist in it.
11. **Bulk and window are applied at read time; the cache is keyed only by
    what git says.** A refs fingerprint (every history ref's stored target,
    unpeeled, plus HEAD) decides warm versus update. A mailmap fingerprint
    decides re-resolution.
12. **The binary loads a 90-day window by default** and prints a summary of
    the index and the rankings, or with `--json` one JSON document. The
    summary stands in for the TUI (Phase 7). `--window` takes 30d, 90d, 1y or
    all; `--top` sets the JSON's rows per ranking (default 20);
    `--coupling-support` and `--max-changeset-size` set the thresholds.
13. **The Complexity Proxy detects each file's indentation unit**: a tab, or
    the most common step between consecutive space-indented lines. Levels,
    not characters, so indentation style does not rank files.
14. **Classification rules carry a version** (`CLASSIFIER_VERSION`). A cache
    classified by older rules has its HEAD table read again on the next load;
    its history is kept.
15. **Commit and blob ids serialize as byte strings**, one copy each rather
    than twenty separate bytes.
16. **Ownership counts only commits that touched a file people wrote and that
    exists at HEAD**, excluding merges and bulk commits. Knowing a deleted file
    or a lockfile is not knowing a directory. Directories with fewer than 10
    commits in the Window are not reported (`ownership_min_commits`).
17. **Staleness buckets**: under a week, under 30 days, under 90 days, under a
    year, a year or more, counted back from the Window's anchor.
18. **Code Age is per file for now**: each code file's lines count toward the
    quarter it first appeared. Line-level age needs blame, which ADR-0004
    defers to `--deep`.
19. **The interface is a state machine** (`commitscape_tui::App`): events in,
    commands out, and every frame drawn from the state alone. The runtime runs
    commands on threads; tests run them in place, through the same
    interface. Findings are computed once per Window, off the main thread,
    except the first Window's, which is computed before the first frame so
    that frame shows findings (ADR-0002).
20. **The rest of history is read eagerly**, in the background, once the
    first frame is up. Switching Window is the point of the tool and should
    not wait; on Linux this costs about 180 MB whether or not anyone switches.
21. **Keys**: `1` to `7`, the arrow keys or Tab choose a Panel; `↑↓`, PgUp,
    PgDn, Home and End move; Enter opens a row; Esc goes back; `w` and `W`
    step the Window forward and back; `q` quits.
22. **The interface opens only when stdin and stdout are both terminals.**
    Otherwise, or with `--summary`, the binary prints the summary; `--json`
    prints the document.
23. **`commitscape-tui` depends on core and metrics only.** Older history
    arrives through `Session::older`, a function the binary provides, and
    `cargo xtask check-layering` now asserts the interface cannot reach gix or
    `commitscape-index`. Since Phase 11 it also depends on
    `commitscape-forge`, for GitHub's numbers, which the binary asks for
    through `Session::github`.
24. **ratatui's `unstable-rendered-line-info` feature is on**, for
    `Paragraph::line_count`: a panel's opening paragraph and the help window
    are exactly as tall as their wrapped text. The API is marked unstable;
    `Cargo.lock` pins the version it was written against.
25. **Keys since Phase 11**: `1` to `9` choose a screen; `j` and `k` move as
    `↓` and `↑` do; `/` searches; `c` changes the Map's colours; `?` opens
    help. Decision 21 still holds for the rest.
26. **The browser keeps where it is in the address's `#`** (screen, Window
    or dates, filters, the profile, folder or file open), so back, reload
    and a copied link all keep it. `1` to `5` choose a screen, `?` shows
    the explanations.
27. **What a report holds**: every screen for every Window, the Map's first
    two levels, and the profiles of the 30 people with most commits in each
    Window. More would make a big repository's report tens of megabytes.
28. **The person filter lists the people in the Window being looked at**,
    not all of history's: on rust-lang/rust the all-time list is 286 KB
    and 250 ms, and nobody is filtered for who has no commits in view.
29. **The saved PNG is drawn at twice the card's size** (2,160 by 1,368), so
    it stays sharp on a high-density screen.
30. **`health` clones with the `git` command**, as the fixture generator
    does: gix is built without network clients (Decision 2), and a partial
    clone is what the brief asks for. Reading stays with gix. `health`
    never counts lines: that would fetch every old file's contents.
31. **gix's `revision` feature is on**, for `check`: reading the staging
    area and finding a branch's merge base. It adds `gix-index`.
32. **The problem-solvers' thresholds**: `check` needs 5 focused commits
    and 8 in 10 (Phase 20 finding 2 says why); a Maintainer has 3 commits
    in 90 days; `who` halves a commit's weight every 180 days and calls
    someone gone after 90 days without a commit.
33. **Wrapped's year is the calendar year**, 1 January to 31 December or
    today, on each commit's own clock for days and hours, as the Overview
    counts them.
34. **ADR-0003's `linux-arm64` is a static musl build** (it runs on any
    ARM Linux, Alpine too), and Linux x64 has both a glibc and a musl
    package, picked by npm's `libc` field and the starter.
35. **The starter becomes the binary with `process.execve` where Node has
    it**, and drops Node's warning that the call is new: ADR-0003's "a shim
    that execs", at 25 ms rather than 36.
36. **Release binaries are built with the `dist` profile**, stripped; the
    `release` profile keeps its debug information for benchmarks and
    profiles.
37. **The Playwright tests use `CHROMIUM`, else NixOS's Chromium where it
    exists, else Playwright's own**, so the same config runs here and on
    CI.

---

## Open questions for the owner

Build Run 4 took the most conservative option for each and carried on.

1. **The Site's origin.** No domain is bought, so `SITE_ORIGIN` in
   `packages/data/src/product.ts` is `https://commitscape.invalid`, which
   never resolves: `commitscape share` without `COMMITSCAPE_SITE` fails
   plainly rather than uploading anywhere. Set it before the first deploy
   (`DEPLOY.md`, step 1).
2. **Repository pages through the Worker.** A link preview needs its tags
   in the page itself, so `/gh/*` runs as Worker code (0.1 ms of CPU) to
   serve each repository's stored page. That is one of the free plan's
   100,000 daily requests per repository page view, beside the two API
   requests every view already makes. Taking `/gh/*` out of
   `run_worker_first` in `wrangler.jsonc` saves it and loses the previews.
3. **A test GitHub App.** Phase 29 is tested against GitHub's responses
   written by hand, and Phase 31's drill against the same stand-in.
   Creating a test App (`DEPLOY.md`, step 3) and signing in once through
   `wrangler dev` would check the real thing.
4. **Astryx's weight.** The page grew by 0.75 MB (174 KB more gzipped),
   more than ADR-0018 expected. It is kept, since the ADR chose Astryx for
   every component. If it matters, the date inputs are the cheapest part
   to replace (a native date field would save roughly a fifth).
5. **The seed list moves.** GitHub's search does not give the same "most
   starred" list twice (`incomplete_results`), so seeds gather over nights
   and a repository stays a seed. If the boards should be a fixed set, a
   list kept in the repository would do it; with a `GITHUB_TOKEN` the
   search may also be steadier (untested).
6. **Bots by name.** "Fastest to answer issues" leaves out answers by
   GitHub's Bot accounts and by accounts named as automation (`-bot`,
   `[bot]`, a list in `crates/commitscape-core/src/bots.rs`). A project's
   own triage account under another name would still rank it first; add
   it to the list when one shows up.
7. **Hosted Reports have no pull-request or issue history** (Phase 27:
   `--offline`, since reading React's takes minutes). The Activity screen
   says so on the Site.

---

## Open uncertainties for review

- **`bincode` is on life support.** It works and its format is frozen, but
  upstream is archived. Candidates if we ever need to move: `postcard`
  (actively maintained, serde-based) or the `rkyv` escape hatch ADR-0002
  already names. Not urgent; flagged so it is a decision rather than a surprise.
- **ADR-0002's range-readable body may not need a general serialization format
  at all for the two history-sized arrays.** `CommitMeta` and `FileChange` look
  fixed-width, which would make a range read pure offset arithmetic and reduce
  the month-granularity offset table to a time→index map. This is an
  implementation technique *within* the ADR's stated requirement, not a
  deviation from it, but it is worth a second opinion before Phase 2 commits to
  a layout.

---

## Where to pick up

Build Run 5 (Phases 32 to 42) is done and uncommitted in this worktree, on branch `t3code/rethink-repository-insights`. Every phase's gate, findings and files are above ("Build Run 5" table, then "Phase N findings"). New decisions that are hard to reverse: ADR-0023 (a Profile read in two stages, kept as two copies); ADR-0021 and ADR-0022 have "As built" sections. CONTEXT.md states every Archetype and Achievement rule (a test keeps it in step with the code).

Checks at the end of the run, on this machine: `pnpm check` (typecheck, lint, every vitest suite, build), `cargo test --workspace` (265 tests), `cargo clippy --workspace --all-targets -- -D warnings`, and Playwright (`pnpm e2e`, every page's layout shift under 0.05 among them). CI on macOS and Windows runs when the owner pushes.

Database migrations added in this run, in order (all generated with `pnpm db:generate`, none edited): `0001_repo_people`, `0002_profiles`, `0003_surviving`, `0004_standings`, `0005_cards`, `0006_proofs`, `0007_rivals`, `0008_oldest_line`, `0009_races_and_crews`. The Builder applies them when it starts.

### Left for the owner (IDEA.md, "Needs the owner")

1. **Deploy**, when you choose: both images, the Site and the Builder, then let the Builder apply the migrations. The Site's `GITHUB_TOKEN` is now required (Profiles, Proof of Work, Races and Crews read GitHub's GraphQL API, which always needs a token); a token with no scopes is enough. The Builder takes two new settings, `SURVIVING_BUDGET_SECONDS` (60) and `PULLS_TIME_LIMIT_SECONDS` (1800), in `DEPLOY.md`.
2. **An embed in a real README** (Phase 36's gate): in a test repository on GitHub, paste a Card's Markdown from `/u/<you>/cards` (it is a `<picture>` with a light and a dark SVG), and check that GitHub's image proxy shows it animated, in both themes, and that it refreshes within six hours of a change. Nothing else of the Cards needs you.
3. **Three real accounts for Races and Crews** (Phase 40's gate): it passes end to end with three stand-in accounts; on the deployed Site, start a Race and a Crew with two friends, accept, check the live Standings, and have one leave a Crew.
4. **The "Read user profile" permission is not needed** (Phase 33, finding 8).
5. **Watch the first big pull-request reads**: facebook/react's first read took 24 minutes, under the default limit of 30; much busier repositories may need `PULLS_TIME_LIMIT_SECONDS` raised for their first read, once.

### Follow-ups found during the run

- Surviving Lines on rust-sized histories: some people need more than the 60 s budget, and retries restart the walk. Saving a walk's progress between requests would fix it (Phase 34, finding 4).
- A busy Profile page carries both stages' data (gaearon's is 67 KB gzipped); it could carry only the full one once it is there (Phase 36, finding 8).
- Rivals' monthly gaps are in pull requests and contributions, not Surviving Lines, which are counted at a head, not by month (Phase 38, finding 4).
- Per-commit times come from GitHub's commit search for Night Owl; commits GitHub does not index (forks, some private work) are not in it.
- **Lines are counted for every repository, however big** (owner's requirement, 2026-10-04; uncommitted). The Builder no longer clones anything over 100 MB without old file contents: every Build is a full clone with Lines Changed counted (`FULL_CLONE_UP_TO_MB` and `--partial` are gone from the Builder; `MAX_REPOSITORY_MB` is now unset by default, an opt-in guard). A Build past its time limit is queued again under the same id and goes on from the counts the line store kept, each attempt given twice the time (`TIME_LIMIT_SECONDS`, then x2, x4, x8; four attempts, then `timed_out`). A Surviving Lines count over budget is queued again per person with twice the budget, up to four hours, going on from the files already counted; the kill timer gives cloning and loading `TIME_LIMIT_SECONDS` of their own and counts the budget once per person in the job (it was budget + 120 s for the whole job, which cut large groups short). A count is never `not_counted` any more, even for a Report read without lines (the value stays in the types for old rows). The Site re-asks `over_budget` counts like lost ones after 30 minutes, and old `not_counted` rows once their repository has a Report with lines; a Report stored with `report_lines = false` is stale, so the next visit or the nightly seed builds it again. Pruning leaves the clone and cache folder of any public repository with a Build or count still to come. The survival queue's jobs may now run up to 24 hours (the Builder sets it when it starts). No migration. Files: `apps/builder/src/{config,run,job,survival,disk,main,seeds}.ts` and their tests, `packages/server/src/queue.ts`, `apps/site/src/server/{engine,standings,repos}.ts` and tests, `DEPLOY.md`. **The dev Builder must be restarted to pick it up.** A clone killed part way no longer poisons the retry: `crates/commitscape/src/clone.rs` clones into a hidden `.<name>.cloning` folder and renames it into place only when `git clone` succeeds, re-clones a folder whose HEAD, fetch or reset is broken (keeping the old one until the new clone lands), and runs git with `GIT_CEILING_DIRECTORIES` so a broken `.git` can never make git act on a repository above the clone folder (tests in `crates/commitscape/tests/unit/clone.rs`). Open: the Site's `busy()` treats a Build as lost after 30 minutes, so a visit during a long retry attempt can queue a second Build of the same repository (harmless: both go on from the same line store).

### The Site's UI, rebuilt (2026-10-05, uncommitted)

The owner asked for a from-scratch UI and UX rewrite of the Site, customizable Cards, and line counts for every repository (the last is the "Lines are counted for every repository" entry above). Every page was redesigned on Astryx 0.6.5 (upgraded from 0.6.3) with Tailwind, Recharts and lucide-react; no shadcn component was needed. Data logic is mostly unchanged.

- **Frame:** a new top bar with client-side navigation for every link (`components/RouterLink.tsx` through Astryx's LinkProvider), a ⌘K / `/` search palette with GitHub's people and repositories (`server/search.ts`, `functions/search.ts`, tested) and recent visits, a theme menu, an account menu, a navigation progress bar, and a footer. The viewer is asked of the server once per page load (`lib/viewer.ts`): before, every navigation, even a search-parameter change, called `getViewer`.
- **Pages:** home (hero search with suggestions, a fan of live Cards, a bento of what the Site does, the command line); Profile (avatar-glow hero, Archetype pill, headline numbers, last year, over the years, languages, code that survived with each repository's Lines Changed, repositories with lines still running, Archetype and Achievements, people, commit clock); the Card studio (`/u/<login>/cards`); Versus and a new `/vs` picker; the Standing page (places in each view, who is next, a Leaderboard); Leaderboards (podiums, tabs for people and repositories); Wrapped; Proof of Work; Races, Crews; Settings; Privacy; the repository page and its five screens; the Shared Report; error and not-found pages. The page kit is `packages/ui/src/kit/layout.tsx`; profile pieces are `packages/ui/src/profile/view.tsx`; standings are `packages/ui/src/standings/view.tsx`.
- **Cards:** a style travels in each Card's address: `preset` (classic, midnight, sunset, forest, grape, ocean, mono, paper, neon), `accent` (any hex), `bg` (plain, glow, gradient, aurora, grid, dots) and `corner` (`packages/ui/src/cards/style.ts`, tested). Styled copies are stored under their own key; an accent outside the offered swatches is drawn each time and never stored. `CARD_DESIGN` is 4, so every stored Card is drawn again. The studio (`components/CardStudio.tsx`) previews a Card in either theme without flashing, and gives the README Markdown, links, PNGs and posts with the style in every address; `ShareButton` opens it on Versus, Wrapped, Standing, repository, Race and Crew pages. The site's own link preview was redrawn.
- **Fixes found on the way:** a person with several identities in one repository showed it once per identity (`mergeRepo` in `server/engine.ts`, tested); org avatars came back as GitHub's default (avatars now come from `github.com/<login>.png`); Astryx avatars' `size-24`-style classes collided with Tailwind utilities (`styles/app.css` excludes them); the Site's search and the Report's palette both answered ⌘K; the hall-of-fame Card's columns ran together; the calendar ramp and the light brand green failed contrast (now validated). `site.css`, `report.css`, `CardBox`, the old profile sections, `Standings.tsx`, `Tile`, `Columns` and other dead code are gone.
- **Checks:** `pnpm check` (17 tasks), `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, and `pnpm e2e` (57 tests; the specs were updated to the new pages, the theme's accessibility checks included). Card snapshot tests were re-recorded; in the PNG test the snapshot is now checked before its 200 ms budget, which fails when the machine is busy.
- **Needs the owner:** the dev Site's `BETTER_AUTH_URL` is `localhost`, so starting a Build from the Site opened by another address (such as the Tailscale IP) answers "Not from this Site"; that is the origin check working as designed. facebook/react's Report was written without line counts, so its page says a fresh read is coming; that full clone is about 1.1 GB.

### The Site's UI, second round (2026-10-05, uncommitted)

The owner reviewed the rebuilt Site and listed gaps; this round fixed them and the logic bugs behind some of them.

- **Motion:** `motion` (Framer Motion) for simple animation and GSAP for sequenced scenes, from `@commitscape/ui/motion`: timings in `constants.ts`, `Reveal`, `Stagger`, `CountUp`, `Lift` in `primitives.tsx`, `useScene` in `scene.ts` (a scoped GSAP timeline that plays on screen, pauses off it, and stops on a still frame with reduced motion), and `Nothing`, the empty-state mascot. `MotionProvider` sits at the root.
- **Home:** a new hero (two-tone headline, live Card stack), a ruled feature grid whose tiles are live HTML scenes (`apps/site/src/home/scenes/`), a typed terminal scene, and a new footer (`components/Footer.tsx`) with Damn Labs and Pixelact Studio. The scenes' numbers for gaearon, acdlite and react/react are copied by hand into `home/scenes/data.ts` and will drift.
- **Profile:** a streak cell with a flame and a colour per length, an eye button opening the last year's breakdown and the Archetype's rules in dialogs, pull requests per month under the contributions, a denser languages view for careers under four years, pages of 12 in the repository table, a weekday-by-hour commit heat map, equal-height rows, and hidden or mascot empty sections. A failed GitHub commit search is no longer saved as "no commit times" for a day (`fetchClock` in `server/profiles.ts`, tested).
- **Versus:** a two-sided header without blurred avatars or Swap, and Short / Full views (`?view=full`) with calendars, years, pull requests, streaks, languages, shared repositories, commit hours, Archetypes and Achievements (`server/versus.ts` `versusFullOf`).
- **Leaderboards:** the counted repositories are listed with a "How these boards work" dialog; boards are aligned row for row. Counting fixes: a renamed repository counted twice, bots on the lines board, shared places for ties.
- **Proof of Work and Wrapped:** one period switcher with a Custom range calendar, a repository/organisation dropdown, one header, kinds of work, grouped lists that load as you scroll, and a PDF that opens with a one-page summary. Wrapped gained month, running-total, weekday, ring, outcome and tile charts.
- **Repository page:** the screen tabs are part of the header and stick under the top bar; Overview adapts to one to three people; "Where the work is" is a drill-down sunburst (`charts/Sunburst.tsx`); Kinds of work shows only when 30% of commits are conventional; a new heat map and Map scale; the repository Card shows the owner, description, stars, forks and language. `CARD_DESIGN` is 5.
- **Renamed repositories:** one row per GitHub repository under its current name; earlier names live in `repo_names` (migration `0010_repo_names`) and redirect. `settleRepository` in `packages/server/src/repos.ts` merges duplicates when GitHub reports a new name. On the dev database facebook/react became react/react this way.
- **Origin check:** `sameOrigin` also accepts an Origin equal to the request's own address, so Builds start from the dev Site opened by IP.
- **Standing page:** no more dead end: a button to read the repository, live Build progress, and clear states for private, missing and absent people. The Leaderboard's "you" now means the signed-in viewer only; the page's person is highlighted, and two people with one name show their logins.
- **Checks:** `pnpm check` (17 tasks) and `pnpm e2e` (57 tests). No Rust changed.

On this machine the dev stack was `pnpm services`, `pnpm dev:builder` and `pnpm dev:site` with `apps/site/.env` and `apps/builder/.env` (not in the repository; `GITHUB_TOKEN` was the owner's `gh` token, so the dev Site's "public" numbers include what that token can see, as finding 7 of Phase 33 explains).

Seams signed off by the user and not open for revision (from earlier runs) still hold: `RepoSource` (fake and real), `Index`, the `Analysis` methods, `--json` golden files, the TUI render via `insta`, the forge, the HTTP API, generated types, the problem-solvers, the browser screens through Playwright. This run added two of its own: `BlameSource` and `BlameThreads` beside `RepoSource` (with scripted fakes), and the Card pipeline (`renderCard`: a component, Satori, the paint's animation, resvg).
