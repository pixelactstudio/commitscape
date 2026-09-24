# commitscape

Reads a git repository and shows its story in the terminal: how big and old
it is and what it is written in, who writes it and when, a map of its code,
and what changes what you do next: the code that is both changed often and
deeply nested, the files that change together across folders, the folders
one person holds, and how much has gone untouched for a year. With the
GitHub CLI signed in, it adds the repository's stars, pull requests, issues
and releases.

Where it is going next is in [`IDEA.md`](IDEA.md): a browser interface,
commands that answer "who do I ask?" and "what did I forget to change?",
and a year in review.

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
| 1 Overview | The repository at a glance: its size, age and languages, commits over time, who writes the code, how old the code is, what is unusual about it, and what is worth a look |
| 2 Activity | Commits over time by person with releases marked, a calendar, the hours of the week, what kind of work the commits were (judged from their files first), the team's rhythm and GitHub's pull requests and issues |
| 3 People | Everyone who committed, with their commits, lines added and removed, and the folders that depend on them; bots listed apart; a profile for each |
| 4 Map | The code as rectangles sized by lines, coloured by activity, by age, or by who holds it |
| 5 Risk | Hotspots, groups of files that change together, and folders only one person knows, with who could take each over |

| Key | Does |
|---|---|
| `1` to `5`, `←` `→`, Tab | Choose a screen |
| `↑` `↓`, `j` `k`, PgUp, PgDn, Home, End | Move through a list |
| Enter | Open what is selected: a file, a pair of files, a folder, a person |
| Esc | Go back |
| `w`, `W` | Step the Window: 30 days, 90 days, a year, all of history. What is open stays open |
| `/` | Find a file, folder or person in a list |
| `c` | Colour the Map by activity, age or owner |
| `u` | On a person: undo a merge of their identities, or redo it |
| Mouse | Click a screen, a Window, a row or a Map block; the wheel scrolls |
| `t` | Colours: the terminal's own (the default), dark, or light |
| `?` | Help: what the screen shows and what every word means |
| `q` | Quit |

GitHub's numbers need the [GitHub CLI](https://cli.github.com), signed in
once with `gh auth login`. commitscape asks it one question after the first
frame is drawn, and `gh` keeps the answer for an hour. Nothing else needs the
network; `--offline` never asks. Repositories on other hosts, such as GitLab,
show everything but those numbers.

To share a repository's story, draw its card:

```sh
commitscape card .                   # writes <repository>-card.svg here
commitscape card . --out story.svg   # somewhere else
commitscape card . --window 90d      # the last 90 days instead of all of history
```

The card is a 1,080 by 684 pixel SVG: the repository's name, size, age and
languages, commits over time, who writes the code, and facts worth sharing.
Its text stays text, so it can be searched and copied.

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
