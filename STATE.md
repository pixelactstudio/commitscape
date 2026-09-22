# STATE

Running log for Build Run 1 (Phases 0 to 7). Written so a fresh session with
no context can read this plus `docs/adr/` and continue without asking anything.

**Current position:** Phase 1 complete. Cold walk on `rust-lang/rust` is 23 to
27s against the 60s budget, and the walk matches `git diff-tree -c` on every
sampled commit of four real repositories. Phase 2 (the cache) is next.

---

## Gate table

| Phase | Gate | Status |
|---|---|---|
| 0 | Benchmark harness runs and records a number | **PASS — `startup` median 0.95ms** (min 0.56, max 1.05, n=20) |
| 1 | Cold walk time on `rust-lang/rust` recorded | **PASS: 23.1 to 26.9s** (budget 60s). First run was 114s; see ADR-0007 |
| 2 | Warm start measured, in ms | NOT YET RUN |
| 3 | Top-10 largest and top-10 hotspots contain no lockfiles / drizzle snapshots / `routeTree.gen.ts` | NOT YET RUN |
| 4 | Metric values match hand-worked fixture literals | NOT YET RUN |
| — | Throwaway ratatui spike, captured then deleted | NOT YET RUN |
| 5 | Pair-map size + changeset histogram reported; `--max-changeset-size` chosen from data | NOT YET RUN |
| 6 | `--json` run against ≥3 structurally different repos | NOT YET RUN |
| 7 | TUI: every Panel covered by an `insta` snapshot through `TestBackend`; first paint from a warm cache measured under 100ms | NOT YET RUN |

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

Phase 2: the cache. ADR-0002 is the specification: bincode, a body range-readable
by commit time with a monthly offset table, a frontier-set resume, rewrite
detection, atomic two-file writes, and every failure degrading to a reindex.
Gate: warm start measured in ms, with ADR-0002's budget of 100ms to first paint
at every scale including Linux.

Re-read `docs/adr/0002-cache-format-and-invalidation.md` from disk before
starting, not from memory.

Seams signed off by the user and not open for revision:
`RepoSource` (fake + real), `Index`, the `Analysis` methods, `--json` golden
files, TUI render via `insta`/`TestBackend`.
