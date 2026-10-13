# The Index is kept in Postgres, and the Site answers any Window from it

On the Site, a repository's Index (every commit with its Changeset, its people, its folders, and its HEAD) is kept as rows in Postgres, with a daily summary beside it. The Site computes every screen's answer from these rows, for any Window, on request. R2 keeps only things that are files: file text, pull request patches, Cards and Shared Reports. A Report is no longer written for the Site; it is what a Shared Report carries.

## Status

accepted (2026-10-18, owner review of the Universe, Code and Branches screens; built the same day). Replaces the hosted half of ADR-0024 and the stored Report of ADR-0015. ADR-0016 (Shared Reports) and ADR-0008 (the cache) stand.

## Context

The Site only knows what the Report was written with: about 200 answers, each for one of four Windows (30 days, 90 days, a year, all time). Every screen that wants more is starved by this.

- The Universe draws a repository from four numbers per folder, made by subtracting one Window from another. Its timeline stretches thirteen years and the last 30 days to the same width, and "a star lights when the file is first touched" is a guess inside a quarter.
- The Code screen's history and Change Coupling come from a second walk of the history in TypeScript (`history.json`). It keeps only files alive at HEAD, stops at 60,000 commits, and records no time or person.
- The Commit List is in Postgres (ADR-0024) but holds only how many files a commit touched, not which.
- Each Build deletes every commit row and inserts them again. In the development database this left 644 MB of index under 94,000 rows.

The engine already has everything (every Changeset with its Lines Changed, File Identity across renames, every Signature), in its cache on the Builder's disk, where the Site cannot read it.

Measured on 2026-10-14 against Postgres 17: a Changeset kept as one row per file change costs 104 bytes a change with its two indexes; kept as an `int4[]` per commit with a GIN index it costs 39 bytes a change, and a file's commits are found in 0.3 ms. facebook/react has 133,000 file changes, freeCodeCamp 759,000, BurntSushi/ripgrep 5,000.

## Decision

- **The engine exports rows, the Builder loads them.** A hidden `commitscape export` writes the Index as Postgres text `COPY` streams: commits, files, folders, Signatures, daily summaries and HEAD. The Builder copies them into staging tables and merges them in one transaction. Rust stays the only reader of history; the TypeScript history walk is deleted.
- **A Stored Index appends.** Each Build exports only the commits after the head the Stored Index was built at, with the daily summaries of the Landing Days they touch. A Stored Index is rebuilt from nothing, under a new lineage, only when the engine's cache was rebuilt (its ids are not comparable), the cache could not be written, or history was rewritten (the old heads are no longer reachable). The lineage is a random number the cache gets when it is built from nothing and keeps through every update. Rows are never deleted to be inserted again.
- **A Changeset is three arrays on its commit**: the files it touched (`int4[]`, File Identity), how each was touched, and the lines each added and removed. A GIN index on (Stored Index, files), through `btree_gin`, finds every commit that touched a file.
- **Daily summaries make any Window cheap.** Commits, people and Lines Changed are summed per Landing Day for the repository, per Signature, per folder (every depth, counting its whole subtree) and per Signature per folder (to depth three). A Window of any length is a sum over at most a few thousand rows. Questions a sum cannot answer (distinct people, Change Coupling inside a Window, a file's own history) read the commit rows.
- **People are joined at read time.** Commits and summaries carry the Signature, which never changes inside a generation. Which person a Signature belongs to depends on the accounts a Build found (ADR-0026), so that mapping is a small table replaced by each Build, and a newly joined identity never rewrites a commit.
- **HEAD is a snapshot replaced by each Build**: the files at HEAD with their size, lines, class and blob, Ownership, Change Coupling, Code Age, languages, branches, tags and the files of pull requests. These are not sums over time.
- **The Site answers through the Data Source it already has.** A hosted repository's Data Source answers `get(path, params)` in the same shapes the Report uses (Overview, Activity, People, Person, Map, File, Stats), with `from` and `to` beside `window`, so any dates can be chosen. A Shared Report's Data Source answers from its file as before, so every screen works with both.
- **The Site holds a Stored Index in memory to answer from it.** The commits come out of Postgres once per load of the Stored Index as typed columns (`loadView`), and `@commitscape/data/answers` works every answer out of them: a line-for-line port of the engine's `Analysis`, so a Window of any length costs one pass over its commits. Views are kept in a least-recently-used cache by size, answers by (Stored Index, load, question). The daily sums stay for questions over time that need no commit, as the Universe's ranges do later.
- **Parity before cutover.** `packages/server/src/parity.test.ts` writes the Report and the export of every fixture, loads the export, and holds each of the Site's answers for every Window and the Report's `stats` equal to the Report's, field by field. It passed on every fixture, BurntSushi/ripgrep and facebook/react before any screen moved.
- **What the engine knows only from email addresses or HEAD is exported worked out.** Each person's traits and number of addresses, the suspected duplicates, the languages and Code Age at HEAD, the release tags, and each file's role, language and whether it looks generated or is a lockfile are written by `export`, so the Site never needs an address or a path rule.
- **The Code and Branches screens read rows.** The tree, Change Coupling, a file's history and a folder's newest commits are worked out from the Stored Index; branches, tags and the details of unmerged branches are rows (`repo_branches`, `repo_tags`, `repo_branch_details`), and which blobs are kept in R2 is a row each (`repo_blobs`). The second history walk in TypeScript is gone.
- **A branch merged by squash or rebase counts as merged.** It is merged when the default branch holds its commits, when `git merge-tree` of it into the default branch gives the default branch's own tree, or when its pull request (matched by `head_ref`) was merged and nothing was committed to it since.
- **R2 is a bucket.** It keeps blobs, pull request patches, Cards, Shared Reports and each Build's small Report index. A Build whose Stored Index loaded writes no answer objects. The `commits` table of ADR-0024 is dropped: commits are read from the Stored Index only, so a repository not built since shows its commits after its next Build.
- **`commitscape report` leaves the public CLI.** It stays, hidden, for tests and parity; `share` keeps writing the Report a Shared Report needs.

## Consequences

- A Window can start and end on any day, on every screen, and the Universe, the Code screen and Branches can show what really happened when.
- Postgres grows with history. Measured on 2026-10-18 (Postgres 17, row bytes per repository; indexes add about 40% on top):

  | Repository | Commits | File changes | Files | Rows | Export | Full load |
  |---|---|---|---|---|---|---|
  | BurntSushi/ripgrep | 2,327 | 5,630 | 358 | 1.2 MB | 0.1 s | 1 s |
  | facebook/react | 35,349 | 303,311 | 22,151 | 29 MB | 0.4 s | 4 s |
  | freeCodeCamp/freeCodeCamp | 43,147 | 764,109 | 179,183 | 74 MB | 0.9 s | 11 s |

  freeCodeCamp's size is mostly its 179,000 translated files with paths of 111 characters on average. Folders are kept once each with an integer id, and a file's path has a hash index, so neither long path is repeated in a btree. An append carries only the new commits and the days they touched.
- A warm Build writes only what is new, typically a few hundred rows, and the index bloat of ADR-0024's delete-and-insert goes away.
- Every metric the engine computes per Window (Ownership, Bus Factor, facts, Moments) has a TypeScript twin on the Site, held to the engine's answers by the parity test. A change to a metric in Rust is a change to its twin, and the parity test fails until both agree.
- The Site keeps the Stored Indexes it answers from in memory, up to 512 MB: facebook/react is about 15 MB of columns, freeCodeCamp about 40 MB.
- A private repository's clone and cache are deleted after its Build (ADR-0026), so each of its Builds starts a new generation and replaces its rows.
- The Builder needs `COPY` (raw SQL, allowed for bulk loads) and the Builder and the Site share one more set of tables.
