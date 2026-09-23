# GitHub numbers come from the gh CLI, in the background

The tool can show what GitHub knows about a repository (stars, forks, issues, pull requests, releases) by running one GraphQL query through the `gh` CLI the user has already signed in with. The query runs after the first frame, never on the startup path, and `gh` caches its answer for an hour. Everything else works without it.

## Status

accepted. Reverses "no network calls" in the original brief's v0.1 scope, at the user's request.

## Context

The user asked for GitHub stats next to the history the index already has, through `gh`, GitHub first and other hosts later. Measured on this machine: one query returns every number the interface shows in 1.2 to 1.4 seconds; asked again within the hour, `gh` answers from its cache in 66ms. GitHub no longer lists individual stargazers through its API (the connection reports zero even for rust-lang/rust), so star growth over time is not available; totals are.

## Decision

- **Shell out to `gh`**, never to an HTTP client of our own. `gh` holds the user's token, handles sign-in, GitHub Enterprise and proxies, and caches responses. The binary gains no TLS stack and no credential handling.
- **One query, fixed in `commitscape-forge`,** covering totals, the latest release, languages, topics and the last hundred pull requests and issues. Arguments go through `-f`, so an owner or name is always a plain string.
- **Only after the first frame, on another thread.** Warm start stays under its 100ms budget whether GitHub is fast, slow or unreachable.
- **A missing CLI, a signed-out CLI, a private repository the account cannot see, or a remote on another host each show a plain message** saying what would make the numbers appear. None is an error.
- **`--offline` skips it.** `--json` never asks, so its output stays reproducible.
- **Hosts are a type (`Host`), not a flag.** GitLab or Gitea later means a new variant and a new adapter behind the same `Remote`.

## Consequences

- The GitHub Panel needs `gh` installed and signed in. Without it the Panel explains how to get it; nothing else changes.
- Numbers can be up to an hour old, as `gh` caches them.
- `commitscape-forge` knows nothing of git or the index, and `cargo xtask check-layering` keeps it that way.
