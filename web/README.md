# commitscape's browser interface

A static React app (Vite, TypeScript) that the `commitscape` binary serves
and embeds (ADR-0010). It reads the JSON API in
`crates/commitscape-web/src/api.rs`; `src/api/types.ts` is generated from
it by that crate's tests and must not be edited by hand.

```sh
npm ci
npm run build      # into dist/, which `cargo build` then embeds
npm run typecheck
npm run lint
npm test           # unit tests (vitest)
npm run e2e        # every screen in Chromium against the ownership fixture
```

`npm run e2e` needs `cargo xtask fixtures` and a built binary
(`cargo build --release`, or `COMMITSCAPE_BIN`); it uses Chromium from
`CHROMIUM`, or `/run/current-system/sw/bin/chromium`. Two scripts measure
and look at real repositories:

```sh
node scripts/first-chart.mjs <commitscape> <repository> [runs]  # the 1 s budget
node scripts/screens.mjs <commitscape> <repository> <out dir>   # every screen, both themes
```

To work on it against real data, start `commitscape --web` and point the
dev server at the link it printed:

```sh
COMMITSCAPE_URL='http://127.0.0.1:7878/?token=…' npm run dev
```
