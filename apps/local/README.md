# commitscape's local browser interface

The static page the `commitscape` binary serves and embeds (ADR-0010). Its
screens are `packages/ui`; it hands them a Data Source from
`packages/data` (ADR-0013): the local server, or a Report written into
the page by `commitscape report`. The API's types,
`packages/data/src/types.ts`, are generated from
`crates/commitscape-web/src/api.rs` by that crate's tests and must not be
edited by hand.

From the repository's root:

```sh
pnpm install
pnpm build         # into apps/local/dist, which `cargo build` then embeds
pnpm check         # typecheck, lint, unit tests and build, every package
pnpm e2e           # every screen in Chromium against the ownership fixture
```

`pnpm e2e` needs `cargo xtask fixtures` and a built binary
(`cargo build --release`, or `COMMITSCAPE_BIN`); it uses Chromium from
`CHROMIUM`, or `/run/current-system/sw/bin/chromium`. Scripts that measure
and look at real repositories, run from `apps/local`:

```sh
node scripts/first-chart.mjs <commitscape> <repository> [runs]  # the 1 s budget
node scripts/screens.mjs <commitscape> <repository> <out dir>   # every screen, both themes
```

To work on it against real data, start `commitscape --web` and point the
dev server at the link it printed:

```sh
COMMITSCAPE_URL='http://127.0.0.1:7878/?token=…' pnpm --filter @commitscape/local dev
```
