# commitscape check, on pull requests

Comments on each pull request with the files it probably forgot to change:
files that nearly always change with the ones it changed, from the
repository's own history. One comment, updated as the pull request changes,
and removed once nothing looks forgotten. Nothing is uploaded anywhere but
that comment.

```yaml
# .github/workflows/commitscape-check.yml
name: commitscape check
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: <owner>/commitscape/actions/check@v1
        with:
          strict: false   # true fails the check when something looks forgotten
```

It checks out all of history (the evidence is in it) and runs
`npx commitscape check --branch origin/<base> --format markdown`. The same
check runs locally before you commit: `commitscape check` looks at what is
staged.
