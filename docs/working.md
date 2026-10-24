# How the pieces work together

commitscape has one engine and three places it runs: the CLI on someone's
machine, the Builder on the owner's server, and the Site, which never runs
git. This page follows a Report from a repository to a browser in each case,
then says how to work on each piece.

## The pieces

| Piece | Where | Does |
|---|---|---|
| The engine | `crates/commitscape-index`, `-metrics`, `-report` | Reads a local checkout with gix, counts lines with imara-diff, and writes the Report |
| The CLI | `crates/commitscape` | `share` (and a bare `commitscape`), `report`, `surviving`, `health`, and the hidden `signatures` |
| The Builder | `apps/builder` | Takes Builds from the pg-boss queue, clones, runs the binary, stores what it wrote |
| The Site | `apps/site` | Serves Profiles, Reports, Shared Reports, Cards and the API from Postgres and R2 |
| Shared code | `packages/server`, `packages/data`, `packages/ui` | The schema and storage, the Report's types and Data Sources, every screen |

The binary makes no network calls during a Build: the Builder clones and
asks GitHub, and passes the binary a folder and files. Only `share` uploads,
and only `health` asks GitHub (through `gh`), both on a person's machine.

## A Build, step by step

A visitor opens `/gh/<owner>/<name>`. The Site reads GitHub's facts (through
the Postgres cache, see [github-api.md](./github-api.md)), and when there is
no Report, or it is more than a day old, it queues a Build. Then the Builder:

1. **Claims the Build** in one database update, on the `builds` queue, or
   `builds-large` for a repository over `LARGE_REPOSITORY_MB`.
2. **Starts two clones at once**: a quick clone without old file contents
   (`git clone --filter=blob:none`) into the Build's scratch folder, and the
   full clone, kept under `WORK_DIR/repos/<owner>/<name>/full` for a public
   repository and fetched next time.
3. **Finds logins.** `commitscape signatures` lists each author address with
   its newest commit. A noreply address gives the login; for the others the
   Builder asks GitHub who made that commit, kept in `github_cache` for a
   year. It writes `accounts.json` in the scratch folder. Addresses never
   leave that folder, which is deleted at the end.
4. **Publishes the quick Report**: `commitscape report <quick clone>
   --no-lines --accounts accounts.json --out … --commits-out …`. The Report
   goes to R2 under `reports/gh/<repo>/<build>-quick/`, its people to
   `repo_people`, and it becomes the repository's Report at once, marked
   without lines. (Skipped when the repository already has a Report with
   lines.) When the repository has no Stored Index yet, `commitscape export
   --no-lines` loads one so every screen can answer.
5. **Loads the Stored Index, then publishes the full Report.** `commitscape
   export` writes the Index as `COPY` files: everything after a rebuilt
   cache, else only the commits after the ones the Stored Index holds
   (`--after`, `--lineage`). `loadExport` merges them in one transaction
   ([ADR-0027](./adr/0027-the-index-is-kept-in-postgres.md)). The full
   Report is then published with its index and people only: the Site
   answers every screen from the Stored Index. Then the git data: branches,
   tags and branch details as rows, the text of files at HEAD in R2 (each
   blob once, recorded in `repo_blobs`), and pull request diffs. The Build
   ends `done`.
6. **Queues Surviving Lines** for seeds' top people; each count reuses the
   full clone and the same accounts, so person ids match the Report.

If the full phase fails after the quick one was published, the Build still
ends `done`, partial, with the reason. A timeout is queued again with twice
the time, four attempts in all. A reaper every five minutes fails Builds whose
job is gone and resends queued ones whose job was lost.

## How the Site reads a repository

- `apps/site/src/server/answers.ts` reads a repository's Stored Index into
  memory once per load (`loadView`) and works every screen's answer out of
  it with `@commitscape/data/answers`, for any dates. A repository built
  before Stored Indexes still reads its Report's answers from R2.
- The Commits screen asks `GET /api/reports/<owner>/<repo>/commits` for 50
  rows at a time: `q`, `person`, `kind`, `from`, `to`, `cursor`, `limit`,
  read from `index_commits` and cached by ETag.
- The Code screen's tree, coupling and history, and the Universe's
  `log.json`, are worked out from the Stored Index; branches are rows.
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

`report` and `export` are hidden: they are the Builder's. `report` writes the
Report as gzipped JSON, `export` the Index as Postgres `COPY` files, and
`--accounts FILE` (`{"<email>": "<login>"}`) joins identities on those
logins for both. `COMMITSCAPE_SITE` points `share` at another Site.

## Cards

The Site draws every Card (`/api/cards/...`). A README can embed a Card's
address directly, or keep a copy in the repository with the
[card action](../actions/card), which fetches the Cards listed in its
`cards` input on a schedule and commits them when they change.

## Working on it

```sh
pnpm install
pnpm services                  # Postgres on :5434 and s3mock on :9100
cargo xtask fixtures --force   # the test repositories, once
pnpm dev:builder               # needs a commitscape binary: COMMITSCAPE_BIN
pnpm dev:site                  # http://localhost:3100
```

| To check | Run |
|---|---|
| Rust | `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` |
| TypeScript | `pnpm check` |
| `packages/server` against the real services | `TEST_DATABASE_URL=postgres://commitscape:commitscape@localhost:5434/commitscape TEST_S3_ENDPOINT=http://localhost:9100 pnpm --filter @commitscape/server test` |
| The Site and the Builder together | `cargo build --release -p commitscape`, then `pnpm e2e` |
| The Report's types after a Rust change | `COMMITSCAPE_UPDATE_TYPES=1 cargo test -p commitscape-report` |

When you run the binary on a real repository, set
`COMMITSCAPE_CACHE_DIR` to a folder under `target/` so the cache stays in
the checkout.

### Changing the Report

1. Change the screen in `crates/commitscape-report/src/api.rs`.
2. Regenerate `packages/data/src/types.ts` (above).
3. Read it in `packages/ui`. A field no screen reads should not be in the
   Report.

### Changing the database

Edit `packages/server/src/db/schema.ts`, then `pnpm db:generate`. The Builder
applies migrations when it starts.

### Limits worth knowing

| Limit | Where | Value |
|---|---|---|
| Stored Report, without its commits | `REPORT_MAX` in `apps/builder` | 64 MiB gzipped |
| Shared Report | `crates/commitscape/src/share.rs` | 25 MB locked |
| Lines counted per file | `MAX_BYTES` in `commitscape-index` | files up to 1 MiB |
| Commits page | the commits API | 50 rows, 200 at most |
| GitHub logins asked per Build | `LOGINS_ASKED` | 300 |
