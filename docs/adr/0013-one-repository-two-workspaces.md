# One repository, two workspaces: Cargo for Rust, pnpm and Turborepo for TypeScript

The repository becomes a monorepo holding everything commitscape ships:
- the Rust crates, a Cargo workspace as before
- a TypeScript workspace managed by pnpm and Turborepo, with:
  - the local web app, which the binary embeds
  - the hosted Site
  - the Builder's job runner
  - the screens they share

The screens live in one package that every app imports, so the local page and the Site are the same code, not two lookalikes.

## Status

accepted (2026-09-25, Build Run 4 plan). Amends ADR-0010's "The web app lives in `web/`".

## Context

Build Run 4 adds a hosted Site (ADR-0014) and a Builder (ADR-0015) next to the local browser interface. The owner wants the local and hosted experiences to feel like one application. The cheapest way to guarantee that is one copy of every screen.

The web app's TypeScript types are generated from the Rust API types, and a test fails when they drift (ADR-0010). Keeping Rust and TypeScript in one repository keeps that contract checked on every change. The owner is a TypeScript developer and asked for Turborepo.

## Decision

The layout:

```
crates/            Rust, unchanged (Cargo workspace)
xtask/             Rust repository automation, unchanged
apps/local/        the Vite app the binary embeds (was web/)
apps/site/         the hosted Site: TanStack Start on Cloudflare (ADR-0014)
apps/builder/      the Builder's job runner, for the owner's server (ADR-0015)
packages/ui/       every screen, chart and component, on Astryx (ADR-0018)
packages/data/     the generated API types, the Report format, and the Data Sources
```

- **pnpm workspaces with Turborepo** run `build`, `typecheck`, `lint` and `test` across the TypeScript packages, with caching. pnpm is pinned through `packageManager` and corepack.
- **`packages/data` owns the one seam every screen reads through**, the Data Source:
  - `get(path, params)`, `card(window)` and `listen(onChange)`
  - an optional `changePerson`, which only a live local server offers
- **It has three Data Sources:**
  - **the local server**, as today
  - **an inlined Report**, `window.__COMMITSCAPE__`, as today
  - **a fetched Report,** downloaded (and decrypted, for a Shared Report) and then read exactly like an inlined one
- **The screens never call `fetch` themselves.** They receive a Data Source through React context.
- **The generated types are written to `packages/data/src/types.ts`.** The Rust drift test points there.

## Consequences

- **Every path that names `web/` moves together:**
  - `crates/commitscape-web/build.rs` and `src/assets.rs`
  - `flake.nix` (`buildNpmPackage` becomes a pnpm build, `pnpm.fetchDeps` with a new hash)
  - `.github/workflows/ci.yml` and `release.yml`
  - `web/scripts/*`
  - `.gitignore`
  - the README's "Develop" section
- **`cargo build` still works without the TypeScript build.** The binary serves the page that says how to build it.
- **CI gains Turborepo's `typecheck lint test build` across the workspace.** The Rust jobs are unchanged and still run on Linux, macOS and Windows.
