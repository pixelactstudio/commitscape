# Cache format, time-sliced reads, and frontier invalidation

The cache stores facts only, never findings. The body is laid out so that a bounded time slice can be read without deserializing all of history, which is what lets the Overview panel show real findings at first paint. Incremental indexing resumes from a **set** of indexed commit ids, not from a single last-indexed sha.

## Status

accepted — supersedes the eager-summary design in the first draft of this ADR. How the files are written, and how a resume finds new commits, are refined by ADR-0008.

## Context

### A single sha is not a valid resume point

"Store the last-indexed commit sha and walk everything since" fails on merges. When a long-lived branch is merged, it introduces commits whose author and commit dates are *older* than the last-indexed commit. Anything resuming by date, or assuming newly-reachable commits are newer than the recorded sha, silently drops that branch's entire history and reports success.

### The eager-summary design contradicted the Overview requirement

The first draft proposed a tiny eagerly-loaded summary to hit first paint, with the bulk deserialized in the background. That is incompatible with the requirement that Overview show findings rather than counts. Bus-factor-1 directories, the top hotspot, and the top cross-directory coupled pair are all window-scoped outputs computed over the changeset arena. None of them fit in a small blob of precomputed counts. A summary that *could* be tiny would necessarily contain exactly the file-count-and-commit-count trivia the tool exists to avoid.

### The cost is deserialization, not computation

Resolving the contradiction turned on separating two costs that the first draft had conflated.

Computing an `Analysis` over a **short** window is cheap. For a 90-day window on `rust-lang/rust` that is on the order of thousands of commits and tens of thousands of changes; churn, staleness, and ownership are linear scans, and coupling's support-prune leaves a few hundred candidate files before any pair is generated. This is tens of milliseconds.

Deserializing the **whole body** is not cheap, and it scales with total history rather than with the window. At Linux scale — over a million commits — it is the single largest item in the startup path, and the warm-start budget must hold there.

So the expensive thing is reading history we are not going to look at. The short-window `Analysis` was never the problem.

### What is sized by history, and what is not

Only two structures grow with history length: the commit array and the change arena. The path table, the author table, and the HEAD file table are all sized by *file count*, which is smaller by orders of magnitude and roughly constant across windows.

## Decision

**Format:** `bincode`, with the body **range-readable by commit time**.

Commits are stored in ascending time order, changes in a parallel arena, and a coarse offset table (monthly granularity) maps commit time to byte offsets in both. Startup then reads:

- the path, author, and HEAD file tables in full — file-count sized, small at any history length; and
- the suffix of commits and changes covering the active window.

That is enough to compute a real `Analysis` and paint genuine findings. The remainder of the body loads on a background thread, which is what the all-time window needs.

**Invalidation:** the cache records a schema version, the repository identity, and a **frontier** — the set of commit ids bounding what has been indexed. Incremental indexing walks back from current refs and stops at any commit already in the known set, which is correct across merges regardless of dates. A history rewrite is detected when a previously-indexed commit is no longer reachable, and triggers a full reindex. Any failure to read, deserialize, or validate degrades to a full reindex; the cache is never a source of user-visible errors.

### Why not precompute the findings at index time

Precomputing `Analysis` for the default window and serializing the findings into the cache was the leading alternative, and it fails structurally rather than on performance.

`Analysis` is defined in the metrics crate. Writing its output into the cache would require the index crate to depend on the metrics crate — inverting the layering this project is built around — or else hoisting the finding types down into the core crate, which smears the metrics layer into the data model and makes "no computation outside the metrics layer" unenforceable exactly where it was supposed to be enforced by the compiler.

It also introduces a staleness bug that the time-sliced design does not have. Findings precomputed at index time are anchored to index time. Open the tool the next morning against an unchanged repository and the cache is valid, so the 30-day window has silently shifted by a day while the findings have not. Recomputing on anchor drift would put the slow path on the first run of every day — precisely the habitual use the budget exists to protect.

**Progressive skeleton rows** were the second alternative. They optimize the measured number while degrading the actual experience: the most common interaction is open, glance, close, and skeletons would occupy the glance. Retained as the degradation path, not as the design.

**Stating a two-number budget** — 100ms to paint, 400ms to complete — is honest, and it is kept below as the documented worst case. But adopting it as the answer is choosing not to solve the problem, and warm start is the product.

## Consequences

- **Filter changes do not invalidate the cache.** This follows from storing facts rather than findings, and it requires one schema change to guarantee: `CommitFlags` carries `MERGE` only. Bulk is *derived* at metrics time from the changeset length, never stored. `MERGE` is a fact about a commit; bulk is a threshold applied to a fact. Consequently `--max-changeset-size` changes recompute an `Analysis` in milliseconds and never re-read git. The user sees a redraw, not a reindex.
- The window anchor is resolved live at startup, so there is no drift between a cached finding and the window it claims to cover.
- The cache gains an offset table and a defined ordering invariant. Commits must be written in ascending time order, which the walk does not naturally produce and which therefore requires a sort before write. That cost lands in indexing, not in startup.
- Incremental merges must preserve the ordering invariant. Appending is not sufficient when a merge brings in older commits; the affected range is re-sorted and its offsets rebuilt.
- The frontier is a set, so it grows with active ref count, not with history length.
- Indexing all refs rather than HEAD's ancestry means a merge can make "a few hundred new commits" mean twenty thousand. The progress indicator must reflect real work rather than an assumed small delta.
- Two files written per update means a torn write must present as a stale cache rather than a corrupt one: write to temporary files and rename atomically.

## Budget

- **Warm start under 100ms to first paint, at every scale including Linux.** Gating, and not negotiable.
- Warm start with a few hundred new commits: under 300ms.
- Cold index on `rust-lang/rust`: under 60s. Gating.
- Cold index on Linux: published as an honest stress number. Not gating.
- Worst case, when the time-sliced read still misses: Overview paints skeleton rows and completes within 400ms. This is the documented degradation, not the target.

The size and timing figures above are estimates. The Phase 0 benchmark harness exists to replace them with measurements before any of this is optimized, and the eager-findings design remains the fallback — at the documented cost of hoisting finding types into the core crate — if the measurements contradict the reasoning.
