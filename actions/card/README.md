# commitscape cards, kept up to date in your repository

Fetches Cards from the [commitscape Site](https://commitscape.damnlabs.com)
and commits them to your repository when they changed, so a README can show
them from a file in the repository. It runs no code of yours and needs no
secret: a public Profile's Cards are public.

```yaml
# .github/workflows/commitscape-cards.yml
name: commitscape cards
on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:
permissions:
  contents: write
jobs:
  cards:
    runs-on: ubuntu-latest
    steps:
      - uses: pixelactstudio/commitscape/actions/card@v1
```

With no inputs it keeps the repository owner's `totals` Card in
`.github/commitscape-card.svg`. Show it in the README:

```markdown
![My work, drawn by commitscape](.github/commitscape-card.svg)
```

## Inputs

| Input | Default | What it is |
|---|---|---|
| `cards` | `u/<repository owner>/totals .github/commitscape-card.svg` | The Cards to keep, one per line: `<card> <path in repository>` |
| `site` | `https://commitscape.damnlabs.com` | The Site to fetch from, for a Site you run yourself |
| `message` | `chore: update commitscape cards` | The commit message when a Card changed |

`<card>` is the Card's address after `/api/cards/`, without its extension,
and with its query if it has one. The extension of the path picks the
format: `.svg` or `.png`. Blank lines and lines starting with `#` are
skipped.

## Several Cards, dressed

```yaml
      - uses: pixelactstudio/commitscape/actions/card@v1
        with:
          message: "chore: refresh my cards"
          cards: |
            u/octocat/totals?theme=dark .github/cards/totals.svg
            u/octocat/survival?theme=dark&preset=midnight .github/cards/survival.svg
            u/octocat/calendar .github/cards/calendar.svg
            u/octocat/preview .github/cards/preview.png
            gh/octocat/hello-world/hall-of-fame .github/cards/hall-of-fame.svg
            u/octocat/octocat/hello-world/standing .github/cards/standing.svg
```

Use `.svg` for a README: it stays sharp and is small. Use `.png` where SVG
is not allowed, such as a link preview.

The action fetches every Card before it writes any, so one that fails (a
typo, a Profile that is private or has not been built) stops the run with
the Card's address in the error and commits nothing. It tries again a few
times on a 429 or a server error. When nothing changed it commits nothing,
and the step summary lists what it kept. The commit is made by
`github-actions[bot]`.

## The Cards

Each Card is `<kind>.svg` or `<kind>.png` under its subject's address. The
Site's Cards studio, at `https://commitscape.damnlabs.com/u/<login>/cards`,
shows every Card of a person, lets you dress one, and gives the address.

| Subject | Address | Kinds |
|---|---|---|
| A person | `u/<login>/<kind>` | `totals`, `survival`, `repositories`, `calendar`, `languages`, `preview`, `archetype`, `achievement-<id>` |
| A person in a repository | `u/<login>/<owner>/<repo>/standing` | `standing` |
| A person's year | `u/<login>/wrapped/<year>/<kind>` | `wrapped`, `wrapped-calendar` |
| A repository | `gh/<owner>/<repo>/hall-of-fame` | `hall-of-fame` |
| Two people | `vs/<a>/<b>/versus` | `versus` |
| A Race | `races/<id>/race` | `race` |
| A Crew | `crews/<id>/season` | `season` |

Dress a Card with a query:

| Query | Values |
|---|---|
| `theme` | `light` (the default) or `dark` |
| `preset` | `classic`, `midnight`, `sunset`, `forest`, `grape`, `ocean`, `mono`, `paper`, `neon`, `rose`, `arctic`, `gold` |
| `accent` | a six digit hex colour without the `#`, such as `7c5cff` |
| `bg` | `plain`, `glow`, `gradient`, `aurora`, `mesh`, `holo`, `grain`, `topo`, `rings`, `horizon`, `grid`, `dots` |
| `corner` | `square`, `soft` or `round` |

## Without an Action

The Site serves every Card at a public address with cache headers, so a
README can show one without keeping a file:

```markdown
![My work, drawn by commitscape](https://commitscape.damnlabs.com/api/cards/u/octocat/totals.svg?theme=dark)
```

GitHub's image proxy caches it for a while, so it follows the Profile
without a workflow. Keep a copy in the repository with this action when you
want the README to work offline, to be reviewed in a diff, or to survive the
Site being unreachable.
