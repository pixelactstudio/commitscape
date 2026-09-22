# A merge records only what it changed relative to every parent

A merge commit's Changeset is the set of paths whose content differs from **every** parent, which is what `git diff-tree -c` reports. A clean merge records nothing. A conflict resolution records the files it resolved, and a file the merge itself added is recorded as an addition.

## Status

accepted

## Context

The first version of the walk diffed a merge against its first parent. That replays everything the merged branch changed, so each file on the branch is recorded twice: once by the commit that changed it and again by the merge. On `rust-lang/rust` merges made up 31% of commits but 71% of all stored changes (3.4M of 4.8M), and diffing them was most of the 114-second cold index, over ADR-0002's 60-second budget.

Every metric that counts changes (Churn, Change Coupling, Ownership, Hotspots) excludes merges anyway, so the replay was paid for in walk time, cache size, and the window suffix read at every warm start, and then thrown away.

Three options were considered:

- **First-parent diff.** Keeps the replay. Rejected on the numbers above, and because it records the same fact twice.
- **No changes for merges at all.** Cheapest, and it matches what `git log` shows for merges by default. Rejected because it drops facts that exist nowhere else: a conflict resolution, or a file added in the merge commit, is real work that no branch commit records.
- **Combined diff.** Records exactly the merge's own work. It is also cheap: a subtree identical to the same subtree in any one parent cannot contain a path that differs from all of them, so it is skipped unread. For a clean merge almost every subtree matches one side at the first level.

## Decision

Record the combined diff. One tree walk covers every commit shape: with one parent it is an ordinary diff, with none every file is an addition, and with several it reports only paths that differ from all of them. The walk is checked against `git diff-tree -c` by `cargo xtask verify-walk`.

## Consequences

- Cold index on `rust-lang/rust` fell from 114s to about 25s, with the diffs also spread across cores. Stored changes fell from 4.8M to 1.5M. Merges now account for 8% of changes, mostly subtree syncs, where the merge's tree genuinely differs from both parents.
- Staleness no longer treats a merge as touching every file its branch touched. A file's last touch is the branch commit that changed it, not the day it landed. The earlier note in `docs/fixtures.md` that counting the merge is "arguably more truthful" for staleness no longer applies; it answered a question the tool does not ask.
- A future "conflict hotspots" finding (files that keep needing resolution) is possible from stored facts alone.
