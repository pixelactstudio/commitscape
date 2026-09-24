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
npm test
```

To work on it against real data, start `commitscape --web` and point the
dev server at the link it printed:

```sh
COMMITSCAPE_URL='http://127.0.0.1:7878/?token=…' npm run dev
```
