# commitscape

Reads a git repository and reports what changes what you do next: the code
that is both changed often and deeply nested, the files that change together
across directories, the directories one person holds, and how much has gone
untouched for a year.

## Build

You need Rust (the version is pinned in `rust-toolchain.toml`, and `rustup`
installs it on first use) and git.

```sh
cargo build --release
```

The binary is `target/release/commitscape`.

## Use

```sh
commitscape path/to/repository
```

In a terminal this opens the interface on the last 90 days of history. The
first run reads the whole history, which takes about 25 seconds for a
repository the size of rust-lang/rust; after that a cache makes it open in
well under a tenth of a second.

| Key | Does |
|---|---|
| `1` to `7`, `←` `→`, Tab | Choose a Panel: Overview, Hotspots, Coupling, Ownership, Staleness, Code Age, People |
| `↑` `↓`, PgUp, PgDn, Home, End | Move through a list |
| Enter | Open the row: a file, a pair of files, a directory, a group of people |
| Esc | Go back |
| `w`, `W` | Step the Window: 30 days, 90 days, a year, all of history |
| `q` | Quit |

Other ways to run it:

```sh
commitscape --window 1y .    # start on a different Window: 30d, 90d, 1y or all
commitscape --summary .      # print a plain-text summary instead
commitscape --json . > report.json   # every metric as one JSON document
commitscape --help           # every option
```

The JSON document's Window ends at the newest commit rather than now, so the
same repository always produces the same document. The cache lives in your
platform's cache directory (`~/.cache/commitscape` on Linux); `--no-cache`
skips it and `--cache-dir` moves it.

## Develop

```sh
cargo xtask fixtures --force   # build the small repositories the tests read
cargo test --workspace         # every test, including the interface snapshots
cargo xtask check-layering     # the crate layering ADR-0001 depends on
cargo xtask bench              # timings; needs clones in ../.commitscape-bench
```

Interface snapshots live in `crates/commitscape-tui/tests/snapshots/`. After a
deliberate change, run the tests with `INSTA_UPDATE=always` and review the
diff before committing it.

Where to read next: `CONTEXT.md` defines the terms, `docs/adr/` records the
decisions, `docs/fixtures.md` works out the expected values the tests assert,
and `STATE.md` is the build log with every measured number.
