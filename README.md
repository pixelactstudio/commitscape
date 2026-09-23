# commitscape

Reads a git repository and shows its story in the terminal: how big and old
it is and what it is written in, who writes it and when, a map of its code,
and what changes what you do next: the code that is both changed often and
deeply nested, the files that change together across folders, the folders
one person holds, and how much has gone untouched for a year. With the
GitHub CLI signed in, it adds the repository's stars, pull requests, issues
and releases.

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

| Screen | Shows |
|---|---|
| 1 Overview | The repository at a glance: its size, age and languages, commits over time, who writes the code, facts worth sharing, and what is worth a look |
| 2 Activity | Commits by day, a calendar, the hours of the week people work, what kind of work the commit messages say, and the team's rhythm |
| 3 People | Everyone who committed, with a profile for each: when they work, what they work on, and which folders rest on them |
| 4 Map | The code as rectangles sized by lines, coloured by where the work is, how long since it was touched, or who holds it |
| 5 Hotspots | Files that change often and are deeply nested |
| 6 Coupling | Files that keep changing in the same commits |
| 7 Ownership | Who made the commits under each folder, and how few people it rests on |
| 8 Age | How long since each file was touched, and when the code was written |
| 9 GitHub | Stars, forks, pull requests, issues and releases |

| Key | Does |
|---|---|
| `1` to `9`, `←` `→`, Tab | Choose a screen |
| `↑` `↓`, `j` `k`, PgUp, PgDn, Home, End | Move through a list |
| Enter | Open what is selected: a file, a pair of files, a folder, a person |
| Esc | Go back |
| `w`, `W` | Step the Window: 30 days, 90 days, a year, all of history |
| `/` | Find a file, folder or person in a list |
| `c` | Change the Map's colours |
| `?` | Help: what the screen shows and what every word means |
| `q` | Quit |

The GitHub screen needs the [GitHub CLI](https://cli.github.com), signed in
once with `gh auth login`. commitscape asks it one question after the first
frame is drawn, and `gh` keeps the answer for an hour. Nothing else needs the
network; `--offline` never asks. Repositories on other hosts, such as GitLab,
show everything but that screen.

Other ways to run it:

```sh
commitscape --window 1y .    # start on a different Window: 30d, 90d, 1y or all
commitscape --offline .      # never ask GitHub
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
cargo xtask preview path/to/repository   # every screen as SVG and PNG, in target/preview
```

Interface snapshots live in `crates/commitscape-tui/tests/snapshots/`. After a
deliberate change, run the tests with `INSTA_UPDATE=always` and review the
diff before committing it.

Where to read next: `CONTEXT.md` defines the terms, `docs/adr/` records the
decisions, `docs/fixtures.md` works out the expected values the tests assert,
and `STATE.md` is the build log with every measured number.
