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
| The landing page | `apps/landing` | Static HTML drawn at build time, on Cloudflare Pages |
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
   When the Report is whole (its pack, every Mainline line counted and
   none left, built within a week), one `git ls-remote` asks where the
   default branch's head is; if it is still the head the Report was built
   from, the Build ends there, without a clone, the engine or an upload,
   and `repositories.checked_at` records that the Report is current. Quiet
   Builds and retries skip the check.
2. **Starts two clones at once** on a cold Build: a quick clone without old
   file contents (`git clone --filter=blob:none`) into the Build's scratch
   folder, and the full clone, kept under `WORK_DIR/repos/<owner>/<name>/full`
   for a public repository and fetched next time. A warm Build (a kept
   clone, or a Stored Index that already has its lines) fetches or clones
   once and runs one `build`.
3. **Finds logins.** `commitscape signatures` lists each author address with
   its newest commit. A noreply address gives the login; for the others the
   Builder asks GitHub's GraphQL API who made those commits, a hundred to a
   request, each answer kept in `github_cache` for a year. It writes
   `accounts.json` in the scratch folder. Addresses never leave that folder,
   which is deleted at the end.
4. **Publishes the first Report.** `commitscape build --no-lines` on the
   quick clone writes the export, `meta.json` and `pack.bin`. `loadExport`
   copies the rows into a new Stored Index
   ([ADR-0027](./adr/0027-the-index-is-kept-in-postgres.md)), the pack goes
   to `packs/<repo>/<stored index>/<head>-<build>-quick.pack` in R2, and one
   transaction records the pack's key on `stored_indexes.pack`, the Report's
   meta and stats on the repository, and its people in `repo_people`. The
   repository's Report shows at once, its Lines Changed marked as counting.
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
6. **Carries on.** If the budget left commits uncounted, a quiet Build is
   queued a minute later, below people's and seeds' Builds, three at most; each counts
   on from where the last stopped. Seeds' top people get their Surviving
   Lines counted, reusing the full clone and the same accounts, so person
   ids match.

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
- A screen's answer, for any dates, comes from the engine service
  (`apps/site/src/server/engine-service.ts`), asked with the key of the
  repository's pack (`stored_indexes.pack`, remembered for ten seconds).
  The engine service fetches the pack from R2 once and keeps it on disk and
  decoded in memory, and keeps its answers. The Site keeps only the answers
  it sent, packed with brotli, and its ETags come from the pack key. A
  repository whose Stored Index has no pack yet reads its old Report's
  answers from R2 until `node builder.mjs rebuild` has it built again.
- The Commits screen asks `GET /api/reports/<owner>/<repo>/commits` for 50
  rows at a time: `q`, `person`, `kind`, `from`, `to`, `cursor`, `limit`,
  read from `index_commits` and cached by ETag. Commits under a folder ask
  the engine service which commits, then read their rows from Postgres.
- The Code window's tree, coupling, story and history, a folder's newest
  commits, a pull request's insight and the Universe's rows come from the
  engine service. The Universe's Atlas is made by the Builder from the
  rows `build` writes beside the pack (`universe.jsonl`), in a process of
  its own that takes an engine slot (`node builder.mjs atlas`), and stored
  in R2 before the pack is published; the Site sends those bytes, and makes
  the Atlas from the engine service's rows only for a pack the Builder did
  not make one for. Branches, tags and pull requests are rows; file text is
  in R2.
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
people (`meta.json`) and the rows the Universe's Atlas is made from
(`universe.jsonl`, one commit, file or person a line). `export` writes only the `COPY` files, and `report`
the whole Report as gzipped JSON, which `share` locks and uploads.
`--accounts FILE` (`{"<email>": "<login>"}`) joins identities on those
logins. `--lines-budget SECONDS` stops the line pass after that long (the
next run carries on where it stopped), `--events FILE` writes one JSON line
per finished step with its start, end and counts, and `COMMITSCAPE_THREADS`
caps the threads every step uses. `--cache-key KEY` names the cache by KEY
instead of the clone's path, so the Build's two clones share one cache and
the history is walked once. `--after FILE --lineage N` writes only the
commits the frontier in FILE does not reach, and `--since MARK`, the mark
the last loaded export left, narrows the earlier commits' rows to the
Mainline that moved and the Lines Changed counted since. Beside the Index
the cache keeps its commit graph (`graph`: each commit's parents by place,
and the Mainline of the head it was last worked out for); a Build brings it
up to date from the commits added since, so the Mainline and the commits
the frontier reaches come from memory instead of from walking git. `--anchor SECONDS` ends every Window there
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
