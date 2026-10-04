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
