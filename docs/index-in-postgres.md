# Plan: the Index in Postgres

How ADR-0027 gets built, in the order it ships. Each phase leaves the live
Site working: new tables fill beside the old ones, and a screen moves only
when its answers match the Report's.

## Where it stands (2026-10-26)

Every phase is built, and [ADR-0028](./adr/0028-the-engine-service-answers-from-immutable-packs.md)
changed where answers come from. The Stored Index is now for row lookups:
the Commit List and its search, a person's commits on a day, branches,
tags, pull requests and the files at HEAD. Every screen's answer comes from
the engine service, from the pack each Build writes beside the rows, and
the Site holds no Stored Index in memory. The four daily summary tables were
dropped with export format 3: nothing read them. Since 2026-10-27 a search
of the Commit List by its words asks the engine service which commits match
(it holds every subject), and reads only that page's rows from Postgres; the
whole-table scan is left for a Report with no pack. What else differs from
the plan below:

- **Phase 2** worked the answers out in TypeScript from the Stored Index held
  in memory, a port of the engine's `Analysis`, rather than in SQL. Since the
  engine service (2026-10-25) the answers come from it, from a pack the Build
  writes, and the TypeScript is gone: its answers on every fixture are kept
  as golden files the engine's tests compare against
  (`apps/engine/tests/golden/`). Any dates can be chosen on every screen of a
  repository with a Stored Index.
- **Phase 3** keeps the HEAD listing and blob upload in the Builder
  (`gitdata/files.ts`) and records the kept blobs in `repo_blobs`; the tree,
  coupling, history and folder listings are worked out by the engine
  service from the pack; branches, tags and branch details are rows. Squash and rebase merges are
  found with `git merge-tree` and by the pull request's `head_ref`.
- **Phase 4** stops writing answer objects for a Build whose Stored Index
  loaded (since the engine service a Build writes no Report objects at all,
  only the pack), and drops the `commits` table: commit pages, a person's commits on
  a day and the commit count on Cards read `index_commits`. The old answer
  objects stay for repositories not built since, which show their commits
  after their next Build.
- **Phase 5** replaced the six Universe scenes with one Universe that replays
  the whole history (`log.json`), redid the Code explorer's layout, folder
  listing and history, and rebuilt Branches around what each branch needs.

## Where we start

| What | Today | After |
|---|---|---|
| Commits | `commits`: one row per commit per Report, deleted and inserted again every Build | `index_commits`: appended per head, with the Changeset as arrays |
| Which files a commit touched | `history.json` in R2: HEAD files only, ≤ 60k commits, no time | `index_commits.files`, every file that ever existed |
| Screens' answers | ~200 JSON objects per Report in R2, four Windows | Computed by the Site from Postgres, any Window, cached by head |
| Files at HEAD, coupling | `tree.json`, `coupling.json` in R2 | `index_head_files`, `index_coupling` |
| Branches, tags | `branches.json`, `branches/{i}.json` in R2 | `index_branches`, `index_branch_files`, `index_tags` |
| Pull request files | `pulls/{n}.json` in R2 | `pull_files` rows; the patch text stays in R2 |
| File text | `blobs/{sha}` in R2 | unchanged |
| Who reads history | Rust (Report) and TypeScript (`gitdata/files.ts`) | Rust only |

## The tables

All live in `packages/server/src/db/schema.ts`. `si` is a Stored Index id
(`integer`), so the big tables never repeat the repository's text id and a
rename touches one row.

**`stored_indexes`**: `id` serial, `repo_id` → repositories, `lineage`
(the engine cache's identity), `kept` (whether that cache was written, so
the next export may append), `head`, `frontier` (the heads the export was
made at), `commits`, `lines` (whether the Mainline's Lines Changed are all
counted), `lines_left` (commits the line pass has not reached yet), `pack`
(the R2 key of the current pack), `mark` (where the last loaded export left
the Stored Index: the next export writes only the Mainline that moved and
the Lines Changed counted after it), `state` (`loading`, `live`),
`built_at`, `loaded_at`. `repositories.index_id` points at the live one.

**Facts, appended**

- `index_commits`: `si`, `sha` bytea, `at`, `offset`, `author_delta`,
  `signature`, `kind`, `flags` (merge, bulk, ignored by blame, reachable
  from HEAD, first-parent), `arrival` (Main Arrival), `subject`,
  `files int4[]`, `changes int2[]` (added, modified, deleted, renamed).
  Keys: `(si, sha)`; `(si, at)`; `(si, signature, at)`; GIN `(si, files)`
  with `btree_gin` (GIN on `files` alone where the extension is missing, as
  in PGlite). `added int4[]` and `removed int4[]` are no longer written and
  go with the per-file arrays.
- `index_commit_lines`: `si`, `sha`, `added`, `removed`: each commit's Lines
  Changed, summed, once counted. A narrow row of its own, so counting the
  lines of a commit already loaded inserts a row instead of writing the
  whole commit row again. Key: `(si, sha)`.
- `index_files`: `si`, `file` (File Identity), `path` (where it is now, or
  was last, with a hash index), `folder` (id), `born`, `last`, `alive`.
  `index_file_paths`: `si`, `file`, `path` for every earlier path, so
  renames are followed.
- `index_folders`: `si`, `id` (given by the loader, stable for the
  lineage), `path`, `parent` (id), `depth`.

**People, replaced each Build**

- `index_people`: `si`, `signature`, `name`, `person` (the id the
  Report's people use), `person_name`, `colour`, `login`, `bot`. No email
  address ever leaves the Builder (ADR-0019). `repo_people` stays as it is.

**Daily summaries, by Landing Day** (dropped with export format 3: nothing
read them)

- `index_days`, `index_signature_days`, `index_folder_days`,
  `index_signature_folder_days`.

**HEAD, replaced each Build**

- `index_head_files`: `si`, `file`, `blob` sha, `bytes`, `lines`, `class`,
  `language`, `indent` numbers.
- `index_coupling`: `si`, `file`, `other`, `together`, `degree` (top six per
  file, as today).
- `index_code_age`: `si`, `year`, `quarter`, `lines`.
- `index_branches`, `index_branch_commits`, `index_branch_files`,
  `index_tags`, `pull_files`: what `gitdata/branches.ts` and `pulls.ts`
  write to R2 today, as rows.

A custom migration adds `btree_gin` and the GIN index. Partitioning was
left out: at the measured sizes (ADR-0027) one table per kind is enough.

## Phase 1: export and load, beside today's pipeline

1. **`commitscape export`** (hidden, `crates/commitscape`): reads the cache
   like `report` does and writes one `COPY` text file per table into a
   folder, plus `manifest.json` (generation, head, first new `seq`, the
   Landing Days it touched, counts). `--after <sha>` exports only commits
   after that head and the summaries of the days they touched; without it,
   or when the sha is not an ancestor, everything. Folder ids and Landing
   Days are computed here, where the data already is.
2. **The loader** (`apps/builder/src/index-load.ts`): `COPY` each file into
   an unlogged staging table with `pg-copy-streams`, then in one
   transaction insert new commits, upsert files, folders and Signatures,
   fill Lines Changed for commits that had none (the quick phase exports
   without them), replace the summary rows of the touched days, replace
   People and HEAD, and move `stored_indexes.head`. A new generation loads
   under a new `stored_indexes` row and swaps `repositories.index_id` at
   the end; the old one is deleted after.
3. **Run it in every Build** after the Report is published, failing soft
   like the git data does today. Nothing reads the tables yet.
4. **Measure** on ripgrep, react, freeCodeCamp and torvalds/linux: time to
   export, time to load cold and warm, rows and bytes per table. Write the
   numbers into the ADR.
5. **Tests**: Rust tests for `export` on the fixtures (cold, `--after`,
   rewritten history); loader tests against PGlite for the merge, and
   against real Postgres (`TEST_DATABASE_URL`) for `COPY`.

## Phase 2: the Site answers from Postgres

1. **`apps/site/src/server/index/`**, one module per answer: `overview`,
   `activity`, `people`, `person`, `map`, `file`, `commits`. Each takes
   `Deps`, a Stored Index and a Window (`from`, `to`), and returns the
   Report's type. Sums come from the daily summaries; distinct people and
   coupling inside a Window from `index_commits`.
2. **Parity tests**: for each fixture, build the Report and the Stored
   Index from the same cache, and compare every answer for the four
   Windows field by field. A screen moves only when its parity test passes.
3. **The hosted Data Source** (`apps/site/src/lib/source.ts`) asks a new
   server function `getAnswer(owner, repo, path, params)` that uses the
   Stored Index when the repository has a live one, and the stored Report
   otherwise. The Commits screen reads `index_commits` instead of
   `commits`.
4. **Windows in the UI**: `window` stays for the four presets; `from` and
   `to` are added to the address (`?from=2025-03-01&to=2025-07-31`), and one
   range control replaces the four buttons where a Stored Index answers.
5. **Caching**: answers keyed by (si, head, path, params), an LRU in the
   Site plus `immutable` HTTP caching when the address names the head. The
   Builder warms the default answers after a load.
6. **The rest of the Site** moves too: `standings.ts`, `mcp.ts`, Cards and
   the repository's stats (`repositories.bus_factor` and the rest) read
   the Stored Index.

## Phase 3: Code and Branches from Postgres

1. `export` writes HEAD, coupling and Code Age; `gitdata/branches.ts` and
   `pulls.ts` write rows instead of JSON. Blobs and patches stay in R2.
2. `apps/site/src/server/git.ts` reads rows: the tree from
   `index_head_files` with each folder's summary, a file's history from the
   GIN index on `index_commits`, coupling from `index_coupling`.
3. Branches mark a squash-merged branch as merged when a merged pull
   request has its head, which fixes "3 of 998 merged" on facebook/react.
4. Delete `gitdata/files.ts`'s history walk and `history.json`,
   `coupling.json`, `tree.json` and the branch JSON.

## Phase 4: retire the stored Report

1. The Builder stops storing Reports and the `commits` table for
   repositories with a live Stored Index; `storeReport`, `storeCommits` and
   the `reports/` prefix go once every repository has been rebuilt.
2. `report` is hidden in the CLI; README, `docs/working.md`, DEPLOY.md and
   CONTEXT.md (Window, Report, Stored Index) are updated.
3. A cleanup removes the old R2 objects and drops `commits`.

## Phase 5: the screens

With any Window and every Changeset available, in this order:

1. **Branches**: grouped by what needs doing (in flight, waiting,
   abandoned, merged and safe to delete), behind and ahead as numbers on
   one scale, a timeline of branches against time, links to their pull
   requests.
2. **Code**: full width, a compact repository header, the panes scroll on
   their own, a file's history and timeline, a readable heat column
   instead of the dots, a folder view that lists files first.
3. **Universe**: one map, the Atlas, with a hex for every file the
   default branch ever had, laid out by folder. Scrubbing replays real
   commits from each person to the files they touched; click or search
   to fly. Strata, Orbits, Wormhole, Coral and Synapse are deleted.

## Now, before phase 1

- On production, `REINDEX TABLE commits` gives back the space the current
  delete-and-insert has bloated, until phase 4 drops the table.

## Open questions

- Whether torvalds/linux is built at all, or kept off the Site until its
  measured size is known.
- How long an `old` Stored Index is kept after a swap (proposed: deleted at
  once).
