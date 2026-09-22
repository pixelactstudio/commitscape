# commitscape

A terminal UI that reads a git repository and reports the things about it that change what you do next. Every number it shows must either alter a decision or be interesting enough to screenshot, and every number must be enterable.

## Language

### What we measure

**Churn**:
The number of commits touching a file within the active Window. Merge Commits and Bulk Commits are excluded.
_Avoid_: activity, edits, changes, revisions.

**Complexity Proxy**:
A language-agnostic stand-in for structural complexity, derived from the indentation structure of a file at HEAD. Never called "complexity" unqualified — the qualifier is the honesty.
_Avoid_: complexity, cyclomatic complexity, difficulty.

**Hotspot**:
A file that is both heavily changed and structurally complex, scored as the product of its Churn percentile and its Complexity Proxy percentile: where it ranks among the files that changed in the Window, times where it ranks among all the files people wrote. The central finding of the tool.
_Avoid_: problem file, risk file, tech debt.

**Change Coupling**:
The tendency of two files to appear in the same commit. Reported symmetrically as a Jaccard degree, and directionally as the probability that one changes given the other did.
_Avoid_: logical coupling, dependency, correlation, co-change.

**Ownership**:
The distribution of commit counts by Author across a directory within the Window. Commit-weighted, never line-weighted — a distinction the tool states rather than hides.
_Avoid_: authorship, contribution, blame.

**Bus Factor**:
The number of Authors holding the majority of a directory's Ownership. A directory where one Author holds more than 80% of commits has a Bus Factor of 1.
_Avoid_: truck factor, key person risk.

**Staleness**:
Time since the last commit touching a file, reported in buckets. Unlike Churn, it counts Bulk Commits — a file that was touched was touched.
_Avoid_: age, freshness, last modified.

**Code Age**:
The distribution of surviving code by the quarter in which it was introduced. Distinct from Staleness, which is per-file and backward-looking from now.
_Avoid_: code lifetime, survival.

### What we measure it over

**Window**:
The active time range that every panel is computed over. One of a fixed set of spans, changeable globally at any moment. The difference between two Windows is itself a finding.
_Avoid_: range, period, timeframe, filter.

**Index**:
The complete set of facts extracted from a repository by walking its history once and reading its HEAD tree once. Everything the tool displays is derived from the Index alone.
_Avoid_: database, cache, model, store.

**Changeset**:
The set of files a single commit touched, along with how each was touched. The Index stores Changesets rather than aggregates, which is what makes the Window changeable without re-reading the repository. A Merge Commit's Changeset holds only the files it changed relative to every parent, such as a conflict resolution, never the branch it merged.
_Avoid_: diff, commit contents, file list.

**Merge Commit**:
A commit with more than one parent. Its Changeset is usually empty. Excluded from Churn, Change Coupling and Ownership.
_Avoid_: merge, pull request.

**Bulk Commit**:
A commit touching more than a configured number of files. Excluded from Churn and Change Coupling because reformats, lockfile regenerations, and vendored drops would otherwise dominate every ranking.
_Avoid_: large commit, mega commit, noise.

**File Identity**:
The identity of a file across its history, preserved through exact renames so that moving a file does not sever its past. A file lives at one path at a time. A file created later at a path another file moved away from is a different file; a file deleted and re-added at the same path is the same file.
_Avoid_: path, filename, file key.

**Author Identity**:
A single person, resolved from the several Signatures they have committed under. Resolved via the repository's own mailmap plus two narrow rules; anything less certain is surfaced as a suspected duplicate rather than merged.
_Avoid_: author, committer, contributor, user.

**Signature**:
One name-and-email pair exactly as it appears on commits. The Index records Signatures; which Author Identity each belongs to is resolved on top, so editing a mailmap never requires re-reading history.
_Avoid_: alias, raw identity, email.

**Prose File**:
A file a person wrote to be read rather than run: Markdown, reStructuredText, AsciiDoc, plain text. Counted in Churn, Ownership and Change Coupling, but never a Hotspot or among the largest files, since the Complexity Proxy and size measure code.
_Avoid_: docs, documentation file, text file.

**Generated File**:
A tracked file that no person wrote and nobody should be asked to look at — lockfiles, minified output, ORM snapshots, vendored trees. Excluded from every ranking.
_Avoid_: artifact, build output, ignored file.

### What we produce

**Panel**:
One screen of the interface, computed from the Index over the active Window. A Panel whose numbers cannot be entered should have been a command-line flag instead.
_Avoid_: view, screen, tab, page.

**Card**:
A composited image summarizing a repository, rendered for sharing rather than for reading in a terminal. The tool's growth mechanism, treated as a product feature.
_Avoid_: report, summary image, badge.

### Agent-era terms

**Context Weight**:
The proportion of a repository's tokens that exist to instruct coding agents rather than to run — agent rule files, skill definitions, and scaffolding, measured against source.
_Avoid_: prompt size, agent overhead, instruction bloat.

**Stale Rule**:
An agent instruction file referencing a path, script, or package that no longer exists in the tree.
_Avoid_: broken rule, dead config, outdated docs.

**Agent Footprint**:
The share of commits, diff volume, and revert rate attributable to coding agents rather than people, identified through trailers, co-author lines, and known bot identities.
_Avoid_: AI commits, bot activity, automation.
