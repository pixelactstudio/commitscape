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

Where a browser can be opened (a desktop, or `$BROWSER` set, as VS Code
and Cursor set it over Remote-SSH) this opens the browser interface;
otherwise the terminal interface, on the last 90 days of history. The
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

### The browser interface

`commitscape --web` serves it on `127.0.0.1:7878` (or any free port) and
prints a link with a secret token; the page keeps the token in a cookie
and the server answers only to the address it printed. Nothing leaves the
machine.

- **VS Code or Cursor over Remote-SSH:** just run `commitscape`; the editor
  opens the link on your laptop and forwards the port.
- **Plain ssh:** run `commitscape --web` on the server, and paste the
  `ssh -N -L …` line it prints on your laptop, then open the link there.
- **Tailscale or a LAN:** `commitscape --web --listen 100.x.y.z` serves on
  that address; the link still carries the token.
- `--tui` always opens the terminal interface; `--port` chooses the port.

It has five screens (`1` to `5`): Overview, with the project's story on a
line; Activity; People, each with a profile; the Map; and Risk. A row of
filters narrows every screen to one person, one folder or a range of
dates. Press `?` to see what every number means. The theme follows the
system, or choose Light, Dark or Midnight. "Save the card" downloads the
card as a PNG.

To send the whole thing to someone, write it as one file that needs no
server:

```sh
commitscape report .                    # writes <repository>-report.html here
commitscape report . --out story.html   # somewhere else
```

The report holds every screen for every Window, the first two levels of the
Map, and the profiles of the 30 people who made most commits. Filters and a
file's details need the live interface. Run `commitscape github .` first to
include pull requests.

To share a repository's story, draw its card:

```sh
commitscape card .                   # writes <repository>-card.svg here
commitscape card . --out story.svg   # somewhere else
commitscape card . --window 90d      # the last 90 days instead of all of history
```

The card is a 1,080 by 684 pixel SVG: the repository's name, size, age and
languages, commits over time, who writes the code, and facts worth sharing.
Its text stays text, so it can be searched and copied.

`commitscape github .` fetches the repository's pull requests, issues and
releases from GitHub now; the interfaces do it in the background, and a
fetch that stops resumes next time.

### Questions it answers

**What did I forget?** Before you commit, `commitscape check` looks at what
is staged and names the files that nearly always change with the ones you
changed, with the evidence:

```text
$ commitscape check
Probably forgotten:
  You changed src/schema.ts. 9 of the last 10 commits that did also changed a file in migrations/.
```

It says nothing unless the evidence is strong (at least 8 of the file's last
10 focused commits). `--branch main` checks what a branch changed since it
left `main`, `--pr 123` a pull request (through `gh`), `--commit REV` one
past commit. `--strict` exits with 1 when something looks forgotten, and
`--format markdown` writes a pull request comment:
[`actions/check`](actions/check/README.md) is a GitHub Action that posts it.

**Who do I ask?** `commitscape who src/api` lists who worked on a file or
folder most, and most recently, and says when the first of them has stopped
committing and who to ask instead.

**Can I rely on this project?** `commitscape health https://github.com/owner/name`
(or `owner/name`) keeps a partial clone in the cache, history without old
file contents, and says whether it is alive and whether it depends on one
person: who kept it going in the last 90 days, its Bus Factor over the last
year, how often it releases, how fast issues get a first answer, and whether
it is getting busier or quieter. It draws the project's card too.

`who` and `health` take `--json`, and `check` takes `--format json`.

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
(cd web && npm ci && npm run build)   # the browser interface, embedded by cargo build
(cd web && npm run e2e)        # its screens in Chromium, after the fixtures and a release build
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
