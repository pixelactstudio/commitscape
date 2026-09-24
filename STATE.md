# STATE

Running log for Build Run 1 (Phases 0 to 7). Written so a fresh session with
no context can read this plus `docs/adr/` and continue without asking anything.

**Current position:** Build Run 3 in progress (Phases 13 to 22); see the Build Run 3 table.
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
| 22 | Distribution (npm, Homebrew, Nix) and launch material | not started |

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

Start Build Run 3 at Phase 13 and follow `IDEA.md` in order. The earlier list
of next steps is folded into it:
- **Distribution** is Phase 22.
- **The PNG card** comes from the browser (ADR-0010), so `resvg` is no longer
  needed.
- **Agent-era metrics are dropped.** The owner removed everything
  AI-related.
- **GitLab, `--deep` blame, a smaller head write and replacing `bincode`**
  are listed under "Later" in `IDEA.md`.
- **The classification gaps** still stand.

Seams signed off by the user and not open for revision:
`RepoSource` (fake + real), `Index`, the `Analysis` methods, `--json` golden
files, TUI render via `insta`/`TestBackend`. Phase 10 added one: the forge,
tested with a response written by hand and one GitHub really sent. Build Run 3
adds, as pre-agreed seams:
- the HTTP API, tested through a real local server
- the generated TypeScript types, checked for drift in CI
- `check`, `who`, `health` and `wrapped` as `Analysis`-level functions with
  hand-worked fixture values
- the browser screens, through a small set of Playwright tests against a
  fixture repository
