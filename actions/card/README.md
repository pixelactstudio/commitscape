# The commitscape card, kept up to date in your README

Draws the repository's card, an SVG of its story (its size and age, its
languages, commits over time, who writes the code), and commits it to the
repository when it has changed. Nothing is sent anywhere else.

```yaml
# .github/workflows/commitscape-card.yml
name: commitscape card
on:
  schedule:
    - cron: "0 6 * * 1"   # every Monday
  workflow_dispatch:
permissions:
  contents: write
jobs:
  card:
    runs-on: ubuntu-latest
    steps:
      - uses: pixelactstudio/commitscape/actions/card@v1
        with:
          path: .github/commitscape-card.svg   # the default
          window: all                          # or 1y, 90d, 30d
```

Then show it in the README:

```markdown
![This repository's story, drawn by commitscape](.github/commitscape-card.svg)
```

The card's commit is made by `github-actions[bot]`, which commitscape counts
as a bot, so it never shows among the people who write the code. The same
card comes from `commitscape card . --out card.svg` on your own machine.
