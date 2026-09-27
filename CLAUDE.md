# commitscape

A Rust CLI that reads a git repository's history, and a website that shows
any GitHub repository's Report. `CONTEXT.md` defines the words this code
uses (Report, Build, Window, Hotspot); use them.

## Layout

| Folder | What |
|---|---|
| `crates/` | Rust: the engine, the terminal interface, the Report, the CLI |
| `apps/site/` | The Site: TanStack Start on Node (Nitro), Postgres, R2 |
| `apps/builder/` | The Builder: takes Builds from the pg-boss queue and runs `commitscape report` |
| `packages/server/` | Drizzle schema and migrations, R2, the queue, stored Reports. Used by the Site and the Builder |
| `packages/ui/` | Every screen and chart the Site shows a Report with |
| `packages/data/` | The Report's types (`types.ts` is generated from Rust) and the Data Sources |

## Commands

```sh
pnpm services                  # Postgres and an S3 stand-in (s3mock) in Docker
pnpm dev:site                  # the Site on :3100, from apps/site/.env
pnpm dev:builder               # the Builder, from apps/builder/.env
pnpm check                     # typecheck, lint, test and build every package
pnpm e2e                       # the Site end to end (needs the release binary and fixtures)
cargo test --workspace         # every Rust test (needs `cargo xtask fixtures --force` once)
cargo clippy --workspace --all-targets -- -D warnings
```

Set `TEST_DATABASE_URL=postgres://commitscape:commitscape@localhost:5434/commitscape`
and `TEST_S3_ENDPOINT=http://localhost:9100` to run `packages/server`'s tests
against the real services. Without them those tests are skipped.

## Database and migrations

- The schema is `packages/server/src/db/schema.ts`. Change it there, then
  run `pnpm db:generate` to write the migration.
- Never edit a generated migration or add comments to one.
- SQL that Drizzle cannot generate goes in a custom migration: run
  `pnpm db:custom`, which writes an empty migration file, and put the SQL in
  that file only.
- Application code queries through Drizzle's query builder. `sql` fragments
  are for expressions inside a Drizzle query. Never run a hand-written SQL
  statement string.
- The Builder applies migrations when it starts (`node builder.mjs work`).

## The Site

- Data only the Site's own pages use goes through a server function
  (`createServerFn` in `src/functions/`). Anything another program calls
  (the CLI, GitHub's webhooks, MCP clients, image and file downloads) is a
  server route under `src/routes/api/` or `src/routes/mcp.ts`.
- Server logic lives in `src/server/`, one module per concern, each
  importing `@tanstack/react-start/server-only`. Functions there take their
  dependencies (`Deps`, `Viewer`) so tests can run them against PGlite.
- Pages load their data in the route's `loader` through TanStack Query
  (`ensureQueryData`), so the server draws them with their data. Loading
  states are skeletons: Astryx's `Skeleton`, laid out with Tailwind.
- Where a page is lives in the address's query (`?screen=people&id=3`), so
  the server can draw it.
- Environment variables are declared once, with T3Env: server ones in
  `src/server/env.ts`, browser ones (`VITE_`, built into the page) in
  `src/lib/env.ts`.
- Signing in is Better Auth with GitHub only (`src/server/auth.ts`).

## Styling

Astryx (`@astryxdesign/core`) is the component library; keep its setup
and the existing CSS files. Write new components with Tailwind classes. Add
a shadcn component only when Astryx has nothing for the job.

## Comments

Write no comments, except a short JSDoc on the main exported functions
saying what the function does. No comments in migrations, configuration or
tests.

## Working here

Leave changes uncommitted: the owner reviews and commits. Never push,
publish or deploy unless asked to at that moment.
