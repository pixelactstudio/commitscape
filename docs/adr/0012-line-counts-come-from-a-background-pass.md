# Line counts come from a second pass that reads blobs, after the first screen

Lines added and removed per change are counted by a separate pass that diffs each non-merge commit's blobs, run in the background after the first screen, on by default, and kept incrementally beside the cache. The history walk still never reads a blob. This amends ADR-0004's "No line counts".

## Status

accepted (2026-09-24, Build Run 3 Phase 15). Amends ADR-0004.

## Context

The owner's review found commit counts a poor measure of contribution: one-character commits inflate them and one careful change counts once. They asked for lines added and removed, as GitHub's contributors page shows, without the noise. ADR-0004 kept blobs out of the walk to meet the cold-index budget, and that reason still holds: the walk is 25 s on rust-lang/rust.

Measured on this machine (Ryzen 5 3500, six cores, SATA SSD), `cargo xtask line-cost`, every non-merge commit of all history:

| Repository | Commits | Changes | Pass | CPU | Peak memory |
|---|---|---|---|---|---|
| rust-lang/rust | 236,732 | 1.45M | 53 s (44.5 s, plus 8.3 s for the 2,867 Bulk Commits) | 288 s | 2.1 GB |
| Linux | 1,371,396 | 3.17M | 195 s (187 s, plus 8.3 s for the 2,005 Bulk Commits) | 1,402 s | 8.7 GB, most of it the memory-mapped pack |
| pixelactstudio | 1,046 | 7,461 | 0.3 s | | |

Checked against `git diff --numstat --no-renames --diff-algorithm=myers`: 98.7% of pixelactstudio's changes and 98.6% of t3code's newest 1,500 commits' match exactly, and the totals differ by 0.11% and 0.89%. The rest are equally short diffs that line up differently.

## Decision

- **A second pass, never the walk.** `RepoSource::count_lines` diffs each commit against its one parent with the walk's own tree diff, reads the two blobs of each changed file, and counts with `imara-diff`'s Myers algorithm, git's default. Merges are not counted: their lines are the branch's, already counted.
- **After the first screen, on by default.** The first screen never waits for it; views that need lines say "counting lines…" until it finishes.
- **Kept beside the cache, keyed by commit id,** in an append-only file saved every 4,096 commits, so an interrupted first pass resumes. A commit's contents never change, so its counts survive a cache rebuild. The counts fill `FileChange::lines` in memory; the history blocks are not rewritten, which keeps ADR-0008's append-and-swap simple.
- **Not counted is not zero.** Binary files and files over 1 MB are `None`, and the interface says how many changes were not counted.
- **What people views leave out is decided when reading,** like Bulk Commits: merges, Bulk Commits, commits `.git-blame-ignore-revs` names (read from HEAD, applied in memory), lockfiles, and generated and vendored files.
- **`--json` includes lines,** running the pass if the store lacks any; `--no-lines` skips it.

## Consequences

- A first run on a huge repository does real work in the background for minutes (through the binary, rust-lang/rust 48 s, Linux 216 s), using every core. Warm runs count only new commits.
- The store grows with history: about 21 bytes a commit and 2 a change. rust-lang/rust's is 7.7 MB and Linux's 35 MB; reading and applying them adds 0.18 s and 1.1 s to a run over all of history, in the background.
- Counts can differ from git's by a line where two shortest diffs exist. The help says they are counted with git's default algorithm and can differ slightly.
- `imara-diff` is a new dependency (with `hashbrown` and `foldhash`): the line diff gix itself uses, small, and the only way to count lines as git does without writing a diff algorithm here.
