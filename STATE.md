# STATE

Running log for Build Run 1 (Phases 0 to 7). Written so a fresh session with
no context can read this plus `docs/adr/` and continue without asking anything.

**Current position:** Build Run 1 is complete: Phases 0 to 7 all pass their
gates. The binary opens the interface in a terminal, prints the summary when
piped, and prints one JSON document with `--json`. What comes after the build
run is listed under "Where to pick up".

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
| 7 | TUI: every Panel covered by an `insta` snapshot through `TestBackend`; first paint from a warm cache measured under 100ms | **PASS**: all seven Panels and every detail they open have snapshots (19 tests, 17 snapshots); first paint median **51.2ms rust-lang/rust, 67.5ms Linux** (n=20, in a pseudo-terminal, its start-up included) |

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
    `commitscape-index`.

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

Build Run 1 is done. In rough order of value:

1. **Distribution (ADR-0003):** the npm package with per-platform binaries,
   and a release workflow. Nobody can use the tool without building it from
   source today.
2. **The Card (`CONTEXT.md`):** a shareable image of a repository's findings,
   the growth feature the glossary names.
3. **Agent-era metrics:** Context Weight, Stale Rule and Agent Footprint, as
   defined in `CONTEXT.md`.
4. **`--deep`:** blame for line-level Code Age and line counts per change,
   which ADR-0004 keeps out of the default path.
5. **A smaller head write.** The head file is rewritten on every update
   (about 15 MB for rust-lang/rust); only its changed sections need writing.
6. **Classification gaps:** a vendored tree without its own lockfile and
   license needs `linguist-vendored` in `.gitattributes`, and rust-lang/rust's
   generated shell completions and blessed MIR test output rank as code. A
   hint in the interface could suggest the `.gitattributes` lines.
7. **`bincode` is archived upstream.** It works and its format is frozen;
   moving to `postcard` or `rkyv` is a decision to make before it becomes a
   forced one.

Seams signed off by the user and not open for revision:
`RepoSource` (fake + real), `Index`, the `Analysis` methods, `--json` golden
files, TUI render via `insta`/`TestBackend`.
