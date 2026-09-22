# The cache appends, and one small pointer file swaps it

ADR-0002 keeps its format and its rules: facts only, a body read by time range, a frontier-set resume, and every failure degrading to a rebuild. This records how the files are written and how a resume finds new commits, both of which changed once they were measured.

## Status

accepted. Refines the write mechanism in ADR-0002's consequences ("write to temporary files and rename atomically").

## Context

Three measurements on this project's benchmark machine (btrfs, SATA SSD):

- **Renaming over an existing file forces its data to disk first on btrfs.** Writing a 67 MB file took 45ms; renaming it over the previous one took 1.2 to 4.4 seconds. Rewriting the body and renaming it into place, as ADR-0002 describes, put that on every update.
- **Rewriting everything on each update wrote about 110 MB on Linux** (history, commit ids, tables) to record a few hundred commits, and its cost varied from 55 to 350ms with kernel writeback.
- **A resume that hides the frontier with gix's hidden-commit walk paints from every hidden tip.** Linux has about 950 tags reaching back 20 years, so a resume with nothing new took 11 seconds, and rust-lang/rust 2.4 seconds.

## Decision

- **Heads get new names; one pointer file swaps them.** Each write creates `<generation>.head`, then replaces `index.current`, a few bytes naming the live generation. That is the only rename.
- **History and commit ids live in an append-only data file.** An update appends only the months its new commits landed in, re-encoded, and one sorted run of the new ids. Bytes already written never change, so the previous head stays valid and a crashed append leaves only unreferenced bytes. When unreferenced bytes outweigh referenced ones, the next write compacts into a fresh file.
- **A resume stops its walk at the first indexed commit on each path.** The index is closed under ancestry, so membership in the stored id runs is an exact stop condition, and the walk costs time proportional to the new commits.
- **Rewrite detection walks newest-first from the current tips**, down only to the age of the cached tips that went missing.
- **One writer at a time** holds a file lock; a second process skips saving rather than waiting.

Every head and every extent of the data file carries a checksum, so damage of any kind reads as stale and triggers a rebuild, as ADR-0002 requires.

## Consequences

- Warm start measured 23ms on rust-lang/rust and 23ms on Linux (medians of 20 runs), against the 100ms budget.
- A warm start that absorbs 625 new commits on rust-lang/rust measured 165 to 257ms, against the 300ms budget.
- The data file can hold up to twice the live data before compaction, and the previous generation's head is kept so a concurrent reader is not cut off mid-read.
- An update still rewrites the head, about 13 MB for either benchmark repository, because the path and author tables change in place.
