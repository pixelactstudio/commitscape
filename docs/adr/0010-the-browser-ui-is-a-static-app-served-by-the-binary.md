# The browser UI is a static React app that the Rust binary serves

The main interface moves to the browser. It is a static single-page app (Vite, React, TypeScript) built ahead of time and embedded in the `commitscape` binary, which serves it and a JSON API on a local port. There is no Node server and no Node at runtime. The terminal UI stays for machines without a browser and is frozen after one clean-up.

## Status

accepted (2026-09-24, Build Run 3). Amended by ADR-0013 (the app moves from `web/` to `apps/local`, its screens to `packages/ui`) and ADR-0018 (Astryx). ADR-0014 adds a hosted Site; this ADR still governs the local interface.

## Context

The owner's review of Build Run 2 found the terminal's limits are exactly what hurt:
- blocky charts
- no hover
- Map blocks too small to read or pick
- no smooth drill-down

The owner is a TypeScript and React developer, not a Rust developer. A browser UI written in React is code they can read and change. They proposed Next.js or TanStack Start. Both are built around a Node server. We already have a server: the Rust binary, which holds the index and answers any question about it in milliseconds. A second server would add a runtime to install and a process boundary, and it would duplicate what the binary does.

Developers often work on headless machines over SSH, so "open a browser" has to work when the browser is on another machine.

## Decision

- **The web app lives in `web/`.** It uses Vite, React and TypeScript. TanStack Router and Query are fine inside it; they are client libraries. It builds to static files.
- **A new crate serves the app and a JSON API.** The built files are embedded in the binary. That keeps one download (ADR-0003) and no Node at runtime.
- **The API's TypeScript types are generated from the Rust types.** CI fails when they drift.
- **Security:**
  - **Bind to `127.0.0.1` by default.**
  - **Every URL carries a random token,** kept in a cookie after the first load.
  - **Every request is checked** against the expected `Host` header, which blocks DNS rebinding.
  - **`--listen <addr>` binds elsewhere** (Tailscale, a LAN) and still requires the token.
- **Choosing the UI when no flag is given:**
  - **The browser opens** when one can: a desktop session, or `$BROWSER` set, as VS Code and Cursor Remote-SSH do.
  - **Otherwise the terminal UI starts** and says how to get the browser one.
  - **`--web` and `--tui` force either one.**
- **Long-running work streams to the page** as server-sent events: index progress, the background line-count pass, GitHub fetches.
- **The card's PNG comes from the browser,** replacing the planned `resvg` rasterizer. `commitscape card` keeps producing SVG for READMEs and CI.
- **`commitscape report` writes the same app as one HTML file** with the data inlined. It shows no drill-down that would need the server.

## Consequences

- **The project has two languages.** Release CI builds `web/` before the binary. A `cargo build` without the web build still works and serves a page saying how to build it.
- **The terminal UI is frozen after Build Run 3's Phase 16.** Only bug fixes land there, so the two UIs don't grow side by side.
- **The 100 ms first-screen budget (ADR-0002) still binds the terminal UI.** The browser UI's budget is "usable within one second on a warm cache", measured from the command to the first chart.
- **A local port is a new attack surface.** The token and `Host` check are not optional, and tests cover both.
- **`commitscape ssh host:path`,** where the engine runs remotely over the SSH connection and the page is served locally, becomes possible later without changing this design.
