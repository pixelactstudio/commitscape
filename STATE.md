# STATE

Running log for Build Run 1 (Phases 0–6). Written so a fresh session with no
context can read this plus `docs/adr/` and continue without asking anything.

**Current position:** Phase 1 implemented, tests and CI checks green. Cold walk
recorded at 114s, **over ADR-0002's 60s gating budget** — Phase 1 is not
closed until that is resolved (see Phase 1 measured numbers).

---

## Gate table

| Phase | Gate | Status |
|---|---|---|
| 0 | Benchmark harness runs and records a number | **PASS — `startup` median 0.95ms** (min 0.56, max 1.05, n=20) |
| 1 | Cold walk time on `rust-lang/rust` recorded | **Recorded — 114.2s, FAILS ADR-0002's 60s budget** |
| 2 | Warm start measured, in ms | NOT YET RUN |
| 3 | Top-10 largest and top-10 hotspots contain no lockfiles / drizzle snapshots / `routeTree.gen.ts` | NOT YET RUN |
| 4 | Metric values match hand-worked fixture literals | NOT YET RUN |
| — | Throwaway ratatui spike, captured then deleted | NOT YET RUN |
| 5 | Pair-map size + changeset histogram reported; `--max-changeset-size` chosen from data | NOT YET RUN |
| 6 | `--json` run against ≥3 structurally different repos | NOT YET RUN |

### Phase 0 measured numbers

```
startup   min 0.56ms   median 0.95ms   mean 0.87ms   max 1.05ms   n=20
```

Process launch to exit, release build, doing no work. This is the floor under
ADR-0002's 100ms warm-start budget: **~99ms remains for actual work**, before
the Node shim from ADR-0003 adds its own startup on top.

### Phase 1 measured numbers

```
cold-walk-rust   114228ms   n=1   (budget: 60s, gating)
index: 345,135 commits (108,403 merges), 4,763,555 changes,
       147,524 paths, 8,523 authors
merge commits account for 3,396,533 of 4,763,555 changes (71.3%)
throughput: 3,021 commits/sec   time ordered: true
wall 2m02s, user 2m18s — effectively single-threaded
```

Two things stand out. **Merges are 31% of commits but 71% of changes**, which
is finding 3 at scale: each merge re-reports its whole branch. Not diffing
merges (or storing only the flag) is likely the single largest saving, and it
is the open merge question below, now with a number attached. Second, user
time ≈ wall time, so the tree diffs run on one core; the walk is
embarrassingly parallel per commit.

---

## Environment

- Rust 1.98.1 stable. `gix` 0.87.1, `gix-diff` 0.67.1, `bincode` 2.0.1.
- Benchmark clone: `rust-lang/rust` at `../.commitscape-bench/rust`
  — **339,854 commits, 62,817 files at HEAD**, full history (not shallow), 1.5G.
  Override the location with `COMMITSCAPE_BENCH_REPOS`.
- Fixtures: `cargo xtask fixtures --force` → `fixtures/` (gitignored).
- `cargo xtask` is aliased in `.cargo/config.toml` to a release build of the
  xtask crate.

---

## Phase 1 findings

1. **`gix`'s ergonomic tree-diff API is gated behind `blob-diff`.**
   `gix::object::tree::diff` / `Tree::changes()` — and `gix_diff::Rewrites`, the
   rename tracker — all require gix's `blob-diff` feature. Enabling it would
   compile blob-diffing machinery into a binary whose central performance
   decision is that the walk never touches blob contents. We use
   `gix::diff::tree` instead, the structure-only API, which is not gated. It is
   not merely sufficient; it is what makes ADR-0004 structural rather than a
   promise.
2. **Exact renames are paired in the builder, not by gix.** A rename with
   identical content is a deletion and an addition sharing a blob id, so
   detecting it is an id comparison. ~40 lines in `build.rs`, tested against
   five cases including copy-to-two-places and move-plus-edit. This is also why
   `blob-diff` stays off.
3. **A merge's diff against its first parent re-reports everything the merged
   branch changed.** Discovered by the `merges` fixture failing: `side.txt`
   showed 3 rather than the 2 I had documented. The code was right and the
   document was wrong. Two consequences are now recorded in `docs/fixtures.md`:
   merge changesets are as large as the branch they merge (so they trip the
   bulk filter too), and staleness is the one metric where counting the merge is
   arguably more truthful. **Whether to store merge changes at all is a genuine
   open question** — see uncertainties below.
4. **Shallow clones have absent parent objects.** Reading the parent tree of a
   boundary commit fails with `NotFound`. Now handled by diffing against the
   empty tree via `try_find_object`, so a shallow clone indexes rather than
   erroring. Caught by the `shallow` fixture.
5. **`gix::Tree` implements `Drop`**, so its `data` cannot be moved out; it has
   to be cloned. Minor, but it is a per-commit allocation in the hot path and a
   candidate if the walk needs optimising.

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

Phase 1 code is written: `commitscape-core` data model, the `RepoSource`
trait with both adapters (`GixRepo` and the scripted fake), and the full
history walk. What remains is getting the cold walk on `rust-lang/rust` under
60s. First decide the merge question (store only the `MERGE` flag vs. the full
first-parent diff), then consider parallelising tree diffs. Re-run with
`cargo xtask bench --filter cold-walk`.

Re-read `docs/adr/0001-git-access-behind-a-trait.md` and
`docs/adr/0004-the-index-never-reads-blob-contents.md` from disk before starting
— not from memory.

Seams signed off by the user and not open for revision:
`RepoSource` (fake + real), `Index`, the `Analysis` methods, `--json` golden
files, TUI render via `insta`/`TestBackend`.
