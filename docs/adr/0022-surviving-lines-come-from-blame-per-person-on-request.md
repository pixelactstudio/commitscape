# Surviving Lines come from blame, per person, on request, and are kept per head

A person's Surviving Lines are the lines at a repository's head that blame attributes to them. They are computed only over the files that person changed, when someone asks, and kept for that head. Over a time budget the number is "not counted", never an estimate.

## Status

accepted (2026-10-04, Build Run 5 plan). Builds on ADR-0011 (identities) and ADR-0012 (line counts in a background pass); goes further than Code Age's per-file measure.

## Context

"41k of the 120k lines I wrote still run" is the number nobody else shows, since it needs the history itself, and it is the hardest one to inflate. Blaming every file of a large repository takes minutes (rust-lang/rust has over 100,000 files), and a reformat would take the credit for every line it touched.

## Decision

- **Blame at the head**, attributing each line to an Author Identity. Bulk Commits and commits in `.git-blame-ignore-revs` are passed through, so their lines go to whoever wrote them before. Generated Files and Prose Files are not counted.
- **Per person, on request:** only files at the head that the person ever changed are blamed. The result is kept per repository, head and person. A new head means a new count, starting from the files changed since.
- **A time budget per request,** measured in Phase 34. Beyond it the Profile says "not counted for this repository" next to the number.
- **Survival** is Surviving Lines divided by the lines the person added in that repository (Lines Changed). It is shown only when both are known.

## Consequences

- The engine gains a blame pass, through gix, behind the existing `RepoSource` seam with a scripted fake for tests.
- The Builder keeps clones of repositories that people have asked about, within a disk budget, so later requests don't clone again.
- Code Age keeps its per-file meaning; Surviving Lines is a separate term.

## As built (Phase 34)

- **Our own blame over gix**, not gix-blame (it has no ignored revisions and its hunks are private), behind `BlameSource` and `BlameThreads` beside `RepoSource`, with scripted fakes. One walk per person over all their files, newest commit first, sharded by folder over up to 8 threads; a one-parent commit the Index shows did not touch a pending path is passed over without reading git.
- **Renames** follow git's similarity scoring and its choice of source; a person's files widen along those renames. Against `git blame`, 0.36% of ripgrep's lines and 0.92% of react's go to a different commit, all from where git's diff is not minimal.
- **Pass-through** (Bulk Commits and `.git-blame-ignore-revs`, full or abbreviated hashes): unchanged lines go to the parent; inside a changed hunk, lines equal once whitespace is removed go to the matching parent line; every other changed line stays with the pass-through commit, as git's "unblamable" rule does. No fuzzy similarity matching, since that is a guess, and no pass-through for merges.
- **Counted:** head files the classifier calls code, under 1 MB. **Added** is exactly the person's Lines Changed added. Survival is shown only when it is at most 100% (a Bulk import can keep lines that Lines Changed leaves out).
- **Kept** per head and settings on disk; a second request for anyone whose files are blamed takes milliseconds. A new head starts over.
- **Budget** 60 s by default (`SURVIVING_BUDGET_SECONDS` on the Builder). It covers every person measured on ripgrep and facebook/react and most on rust-lang/rust; rust's 10th person needs 124 s cold, and retries restart the walk, so they never finish within 60 s. Saving a walk's progress between requests is the follow-up.
