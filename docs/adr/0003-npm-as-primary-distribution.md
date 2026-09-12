# npm is the primary distribution channel

We ship prebuilt Rust binaries through npm using the esbuild pattern: one scoped package per platform, declared as `optionalDependencies` of the main package with `os` and `cpu` constraints, and a tiny shim that `exec`s the right binary. No postinstall compile. No Node in the hot path.

## Status

accepted

## Context

`npx commitscape` is the shortest distance between hearing about a tool and running it, and this tool's audience skews heavily toward developers who already have Node installed. `cargo install` requires a Rust toolchain and a compile; Homebrew requires a tap; neither converts a reader into a user inside one command.

The alternatives within npm are worse. A postinstall step that compiles requires a toolchain and breaks in CI and in sandboxes. A postinstall step that *downloads* breaks behind proxies and corporate registries, and fails closed in offline installs. Bundling every platform's binary in one package makes every user download six binaries to use one.

`optionalDependencies` with `os`/`cpu` fields pushes platform selection into npm's own resolver, which already handles it correctly, mirrors on private registries correctly, and caches correctly.

## Decision

- Build `linux-x64-gnu`, `linux-x64-musl`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` in CI.
- Publish each as `@commitscape/<target>` carrying its binary and nothing else.
- The `commitscape` package declares all six as `optionalDependencies` and ships a shim that resolves the installed one and `exec`s it.
- Secondary channels follow release, not precede it: `cargo install`, a Homebrew tap, AUR, a Nix flake.

## Consequences

- Publishing is atomic-ish but not atomic: platform packages must be published *before* the package that depends on them, and a failure midway leaves a version resolvable for some platforms only. Release tooling publishes platform packages first and the main package last.
- The shim must produce a clear message when no platform package resolved — an unsupported platform, or `--no-optional`, or a resolver that skipped them. This is the single most common failure mode of this pattern and it is otherwise inscrutable.
- Version numbers must be locked in exact lockstep across all seven packages.
- The binary must not depend on Node at runtime, so the shim does nothing but `exec`. Process startup through the shim costs a few milliseconds of Node boot, which is charged against the 100ms budget and must be measured as part of it.
