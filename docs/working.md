# How the pieces work together

commitscape has one engine and three places it runs: the CLI on someone's
machine, the Builder for the Site, and the engine service, which answers the
Site's questions from what the Builder wrote. The Site never runs git. This
page follows a repository from a Build to a browser, then says how to work
on each piece.

![Who talks to whom](./diagrams/system.svg)

## The pieces

| Piece | Where | Does |
|---|---|---|
| The engine | `crates/commitscape-index`, `-metrics`, `-report` | Reads a local checkout with gix, counts lines with imara-diff, and works out every metric |
| The CLI | `crates/commitscape` | `share` (and a bare `commitscape`), `surviving`, `health`, and the hidden `signatures`, `build`, `export` and `report` |
| The Builder | `apps/builder` | Takes Builds from the pg-boss queue, clones, runs `commitscape build`, loads the Stored Index and uploads the pack |
| The engine service | `apps/engine` | Answers the Site's questions about a repository from its pack, kept on disk and in memory |
| The Site | `apps/site` | Serves Profiles, Reports, Shared Reports, Cards, the API and MCP from Postgres, R2 and the engine service |
| The landing page | `apps/landing` | Static HTML drawn at build time, served by a Cloudflare Worker (`apps/landing/worker`) |
| Shared code | `packages/server`, `packages/data`, `packages/ui` | The schema and storage, the Report's types and Data Sources, every screen |

The binary makes no network calls during a Build: the Builder clones and
asks GitHub, and passes the binary a folder and files. Only `share` uploads,
and only `health` asks GitHub (through `gh`), both on a person's machine.
The engine service never reads git either: it reads packs.

## A Build, step by step

![A Build](./diagrams/build.svg)

A signed-in person opens `/gh/<owner>/<name>`. The Site reads GitHub's facts
(through the Postgres cache, see [github-api.md](./github-api.md)), and when
there is no Report, or it is more than a day old (built, or found unchanged,
`checked_at`), it queues a Build. A push
to a repository the App is installed on, the nightly seeds and
`node builder.mjs rebuild` queue Builds too. Then the Builder:

1. **Claims the Build** in one database update, on the `builds` queue, or
   `builds-large` for a repository over `LARGE_REPOSITORY_MB`.
   One `git ls-remote` asks for the remote's HEAD and every branch and tag
   (annotated tags peeled; pull requests' refs left out), and a fingerprint
   of the branches and tags is kept with the Report it publishes
   (`repositories.report_refs`). When the Report is whole (its pack, every
   Mainline line counted and none left, built within a week), HEAD is
   still the head it was built from and every branch and tag is as that
   Build saw them, the Build ends there, without a clone, the engine or an
   upload, and `repositories.checked_at` records that the Report is
   current. Quiet Builds and retries skip the check. Seeds keep their
   weekly check of the default branch's head by GraphQL.
2. **Starts two clones at once** on a cold Build: a quick clone without old
   file contents (`git clone --filter=blob:none`) into the Build's scratch
   folder, and the full clone, kept under `WORK_DIR/repos/<owner>/<name>/full`
   for a public repository and fetched next time. A warm Build (a kept
   clone, or a Stored Index that already has its lines) fetches or clones
   once and runs one `build`.
   Once a public repository's Lines Changed and its Report's Surviving
   Lines are all counted, its Builds read a lean clone instead
   (`WORK_DIR/repos/<owner>/<name>/lean`): blobless and without files
   written out, fetched with `--filter=blob:none`, so only new commits and
   trees arrive. Before the engine runs, the Builder lists the file
   versions the Build reads that the clone lacks (every file at HEAD, and
   both sides of each change in the commits past the last export's
   frontier, Bulk Commits left out) and fetches them by id in requests of
   20,000; the full clone is then deleted. A version still missing leaves
   its commit's lines to count later, never an error. git data reads the
   same clone: git fetches what `diff` and `merge-tree` need itself. The
   count of Surviving Lines fetches every version of the files changed
   since its last count the same way; a count that still meets a version
   the clone lacks fetches it and counts once more before it is queued
   again on a full clone, and a count reads the lean clone only once a
   lean Build has deleted the full one. A cold Build keeps its quick
   blobless clone as the repository's lean clone, so it is never cloned
   blobless a second time. A retry reads the full clone. linux, 19 days behind:
   36 MB of commits and trees and 105 MB of file versions, against 214 MB
   fetched in full; the kept clone is 2.4 GB instead of 6.6 GB.
   git's own upkeep is off for every git the Builder runs (`gc.auto=0`,
   `maintenance.auto=false`), so no fetch repacks a clone in the middle of
   a Build. Instead tidy merges the small packs of any kept clone holding
   more than 16 into one, as `git repack --geometric=2` would (git 2.39
   refuses that in a blobless clone): one thread, a 64 MB delta window,
   holding its repository and let in by `ENGINE_MEMORY_MB`, the largest
   pack never rewritten.
3. **Finds logins.** `commitscape signatures` lists each author address with
   its newest commit. A noreply address gives the login; for the others the
   Builder asks GitHub's GraphQL API who made those commits, a hundred to a
   request, each answer kept in `github_cache` for a year. It writes
   `accounts.json` in the scratch folder. Addresses never leave that folder,
   which is deleted at the end.
4. **Publishes the first Report.** `commitscape build --no-lines` on the
   quick clone writes the export, `meta.json` and `pack.bin`. `loadExport`
   copies the rows into a new Stored Index
   ([ADR-0027](./adr/0027-the-index-is-kept-in-postgres.md)), which is not
   live yet, the pack goes to
   `packs/<repo>/<stored index>/<head>-<build>-quick.pack` in R2, and one
   transaction records the pack's key on `stored_indexes.pack`, makes that
   Stored Index the repository's live one (`makeLive`: `index_id` moves to it
   and every other Stored Index of the repository is deleted), and writes
   the Report's meta and stats on the repository and its people in
   `repo_people`. The old packs, screens and Atlases are deleted from R2
   only once that transaction has committed, so a publish that fails leaves
   the old Report served whole. The repository's Report shows at once, its
   Lines Changed marked as counting.
5. **Counts Lines Changed.** On the full clone, with the same `--cache-key`
   (the repository's id), so the history is not walked again, `commitscape
   build --lines-budget <LINES_BUDGET_SECONDS> --after <frontier> --lineage
   <n>` counts the Mainline first, newest first, then the commits only other
   branches and tags reach; it never counts Bulk Commits, lockfiles or
   Generated Files. Its load fills the lines into the same Stored Index,
   after the first phase's load. A new `…-lines.pack` is uploaded and
   published, and the quick pack is deleted. The Site shows Lines Changed
   once the Mainline's are counted. While the line pass runs, the git data
   is read from the full clone: branches, tags and branch details as rows,
   the text of files at HEAD in R2 (each blob once, recorded in
   `repo_blobs`), and pull request diffs. The Build ends `done` at this
   publish.
6. **Keeps the Repo State.** With `STATE_KEY` set, a public repository's
   engine cache is kept in R2 as well as on disk: before its first run of
   the engine a Build whose disk has no cache brings it back from
   `state/<repo>/` (chunks checked against their names, moved into place
   only when whole), and after a publish it uploads the 8 MB chunks R2
   does not hold yet, sealed with AES-256-GCM, then the manifest naming
   them, and deletes the chunks nothing names. `repo_states` records when
   each was used; tidy drops a State from the disk after `STATE_DISK_DAYS`
   and from R2 after `STATE_KEEP_DAYS` unused. linux: the first upload is
   128 MB for a 217 MB State, a Build with 337 new commits sends 15 MB,
   and a restore takes seconds where reading the history again takes
   minutes.
7. **Carries on.** If the budget left commits uncounted, a quiet Build is
   queued a minute later, below people's and seeds' Builds, three at most; each counts
   on from where the last stopped. A new Report queues one count of
   everyone's Surviving Lines (`commitscape surviving --everyone`), every
   person of it marked counting meanwhile. It reuses the full clone and the
   same accounts, so person ids match, and works out the head's Ownership
   of lines: kept in the cache as `ownership` (runs of lines per file, with
   the commit each came from, read in place; the renames found on the way
   beside it in `ownership.moves`), a later head along the first-parent line
   keeps every file no first-parent commit since changed and blames only
   the rest, stopping wherever a walk reaches the earlier head. Everyone's
   Surviving Lines are then a sum over it. Ownership not whole within the
   budget is kept and the count is queued again with twice the budget; a
   person asked for on the Site gets the same count for everyone. react:
   1,997 people in 16.4 s from nothing, 0.3 s for a head 20 commits on;
   linux: 31,000 people in 17 minutes and 198 MB from nothing, 5 minutes
   and 199 MB for a head 17,000 commits on. The count is asked for the
   Report's head (`repositories.report_head`, `--head`): a clone at
   another head stops it with exit code 3 and nothing is recorded, and a
   count that waited while a Build published another Report counts
   nothing.

A Build, a count of Surviving Lines and a repack of a clone each hold their
repository (its kept clones and its cache) from start to end, so none of
them reads a clone or cache another is changing; each waits for its share
of `ENGINE_MEMORY_MB` only while holding it. A fork's first Build copies
its parent's line store while holding the parent. commitscape itself holds
the cache's `index.load` lock from loading the cache until it exits, since
it rewrites mapped files in place. A Builder holds a Postgres advisory lock
while it runs, and a second one against the same database stops at once:
its locks, its share of memory and its record of disk use are its own.

Every publish sends `pg_notify`, so the Site forgets the old pack key and
warms the new pack in the engine service. If the full phase fails after the
first one was published, the Build still ends `done`, partial, with the
reason. A timeout is queued again with twice the time, four attempts in all.
A reaper every five minutes fails Builds whose job is gone and resends
queued ones whose job was lost.

## How the Site reads a repository

![A page view](./diagrams/read.svg)

- Every page needs a signed-in person, except the sign-in page, `/privacy`,
  Shared Reports and shared Proof of Work; Cards, webhooks and
  `/api/health` answer anyone (`apps/site/src/server/gate.ts`).
- A Report's standard screens (the stats, and the Overview, Activity,
  People and top of the Map of all history, the last year and the last 90
  days) are worked out once per pack: the Builder runs `commitscape screens`
  on the full pack, in a process of its own that waits for its share of
  `ENGINE_MEMORY_MB`, and stores them beside the pack in R2 as one gzipped
  object (`<pack>.screens`) before publishing it
  (`apps/builder/src/screens.ts`). The engine service fetches that object
  with the pack, keeps it on its volume, and answers those questions from
  it without working them out (cut by `top` like any answer); the Site
  asks for them as for any other, with the pack's ETag.
- Every screen's answer, for any dates, comes from the engine service
  (`apps/site/src/server/engine-service.ts`), asked with the key of the
  repository's pack (`stored_indexes.pack`, remembered for ten seconds).
  The engine service fetches the pack from R2 once, unpacks it on its disk
  with its columns laid out to be read in place (pack format 3; packs of
  format 2 are decoded into memory as before), and keeps its answers. The
  Site keeps only the answers it sent, packed with brotli, and its ETags
  come from the pack key. A repository whose Stored Index has no pack yet
  reads its old Report's answers from R2 until `node builder.mjs rebuild`
  has it built again.
- The Commits screen asks `GET /api/reports/<owner>/<repo>/commits` for 50
  rows at a time: `q`, `person`, `kind`, `from`, `to`, `cursor`, `limit`,
  read from `index_commits` and cached by ETag. A search by words, and
  commits under a folder, ask the engine service which commits (it holds
  every subject and matches the words as Postgres did), then read only
  that page's rows from Postgres.
- The Code window's tree, coupling, story and history, a folder's newest
  commits and a pull request's insight come from the engine service. The
  Universe's Atlas is made by the Builder from the pack with `commitscape
  atlas`, in a process of its own that waits for its share of
  `ENGINE_MEMORY_MB` (linux: 98 MB, 2.9 s), and stored in R2 before the
  pack is published; the Site only sends those bytes. A test checks it is
  byte for byte what the TypeScript encoder makes, on every fixture (and
  by hand on react and linux). An Atlas that failed while publishing is
  queued on `atlases` and made later from the pack in R2, and the next
  full Build makes its own anyway. The Site never makes one: for a pack
  without an Atlas (one published before this release, until `rebuild`
  has reached it) the Universe says the history is read at the next
  Build, and the Site queues the same job, once per pack. Branches, tags
  and pull requests are rows; file text is in R2.
- A Shared Report is one locked file. The browser downloads it, decrypts it
  with the key after the `#`, and pages its Commit List itself; the Site
  never sees it unlocked.

## The CLI

```sh
npx commitscape                 # asks, uploads the locked Report, opens the link
commitscape share --list        # the links this machine made
commitscape share --delete <link>
commitscape surviving . --person 3
commitscape health owner/name
```

`signatures`, `build`, `export` and `report` are hidden: they are the
Builder's and the tests'. `build` writes, from one reading of the history,
the export (the Index as Postgres `COPY` files, export format 4, with each
commit's Mainline and Main Arrival), the pack the engine service answers
from (`pack.bin`, no email addresses in it), the Report's meta, stats and
people (`meta.json`). `atlas PACK --out DIR` writes the pack's Universe
Atlas (`map.bin.br`, `names.bin.br`). `export` writes only the `COPY` files, and `report`
the whole Report as gzipped JSON, which `share` locks and uploads.
`--accounts FILE` (`{"<email>": "<login>"}`) joins identities on those
logins. `--lines-budget SECONDS` stops the line pass after that long (the
next run carries on where it stopped), `--events FILE` writes one JSON line
per finished step with its start, end and counts, and `COMMITSCAPE_THREADS`
caps the threads every step uses. `--cache-key KEY` names the cache by KEY
instead of the clone's path, so the Build's two clones share one cache and
the history is walked once. `--lines-from FILE` starts a repository with no
line store from another's: the Builder passes a copy of a fork's parent's
(`facts.parent`, public repositories only) when that cache is on its disk,
so a fork counts only its own commits' lines. Only the parent's commits
whose uncounted files (lockfiles, Generated Files) the fork leaves out too
are taken; a commit touching a file the fork keeps is counted again. `--after FILE --lineage N` writes only the
commits the frontier in FILE does not reach, and `--since MARK`, the mark
the last loaded export left, narrows the earlier commits' rows to the
Mainline that moved and the Lines Changed counted since. The mark names the
cache generation the export was read from, and the cache keeps the
generations it passed through (`index.generations`): a run appends only
when its cache descends from that generation, so a cache brought back from
an older Repo State, whose signature and file ids may differ from the rows
Postgres holds, writes a full export instead. Beside the Index
the cache keeps its commit graph (`graph`: each commit's parents by place,
and the Mainline of the head it was last worked out for); a Build brings it
up to date from the commits added since, so the Mainline and the commits
the frontier reaches come from memory instead of from walking git. Each
generation of the cache also keeps the Index's long arrays (commits,
changes, subjects, and which commits' Lines Changed are settled) in a
column file (`<generation>.cols`), laid out to be mapped and read in place:
a warm Build reads it without decoding, a Build with new commits streams
the old file and the new commits into the next one, and the line pass
counts only the commits not settled and writes them back in place. The
line store keeps the paths it was counted without beside it
(`lines.left-out`): a file that stops being left out (its attributes
changed, or a new classifier) has the commits it changed counted again,
from the kept columns or without them, never kept as having no lines.
`commitscape screens PACK --out FILE` works out a pack's standard screens
as one JSON object. `--anchor SECONDS` ends every Window there
instead of now, so the output comes out the same every time.
`COMMITSCAPE_SITE` points `share` at another Site.

## Cards

The Site draws every Card (`/api/cards/...`) from stored rows, and never
asks GitHub for one. A README can embed a Card's address directly, or keep a
copy in the repository with the [card action](../actions/card), which
fetches the Cards listed in its `cards` input on a schedule and commits them
when they change.

## Working on it

```sh
pnpm install
pnpm services                  # Postgres on :5434 and s3mock on :9100
cargo xtask fixtures --force   # the test repositories, once
cargo build --release -p commitscape
pnpm dev:engine                # the engine service on :4100, from apps/engine/.env
pnpm dev:builder               # uses ../../target/release/commitscape (COMMITSCAPE_BIN)
pnpm dev:site                  # http://localhost:3100
pnpm dev:landing               # the landing page on http://localhost:3200
```

| To check | Run |
|---|---|
| Rust | `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` |
| The engine service's answers | `cargo test -p commitscape-engine` (golden answers in `apps/engine/tests/golden/`; `UPDATE_GOLDENS=1` writes them again after a deliberate change) |
| TypeScript | `pnpm check` |
| `packages/server` against the real services | `TEST_DATABASE_URL=postgres://commitscape:commitscape@localhost:5434/commitscape TEST_S3_ENDPOINT=http://localhost:9100 pnpm --filter @commitscape/server test` |
| The Site, the engine service and the Builder together | `cargo build --release -p commitscape -p commitscape-engine`, then `pnpm e2e` |
| The Report's types after a Rust change | `COMMITSCAPE_UPDATE_TYPES=1 cargo test -p commitscape-report` |

When you run the binary on a real repository, set
`COMMITSCAPE_CACHE_DIR` to a folder under `target/` so the cache stays in
the checkout.

### Changing the Report

1. Change the screen in `crates/commitscape-report/src/api.rs`.
2. Regenerate `packages/data/src/types.ts` (above).
3. Read it in `packages/ui`. A field no screen reads should not be in the
   Report.
4. If the engine service's answers change, check the golden diff and write
   them again with `UPDATE_GOLDENS=1`.

### Changing the database

Edit `packages/server/src/db/schema.ts`, then `pnpm db:generate`. The Builder
applies migrations when it starts.

### Limits worth knowing

| Limit | Where | Value |
|---|---|---|
| A Build's line pass | `LINES_BUDGET_SECONDS` | 120 s, then up to three quiet Builds |
| Packs kept by the engine service | `PACK_DISK_GB`, `PACK_MEMORY_MB` | 10 GB on disk, 512 MB decoded |
| Answers kept by the engine service | `apps/engine` | 128 MB |
| Answers kept by the Site | `SENT_BYTES` in `apps/site/src/server/answers.ts` | 64 MB, brotli-packed |
| Shared Report | `crates/commitscape/src/share.rs` | 25 MB locked |
| Lines counted per file | `MAX_BYTES` in `commitscape-index` | files up to 1 MiB |
| Commits page | the commits API | 50 rows, 200 at most |
| GitHub logins asked per Build | `LOGINS_ASKED` | 300 |
