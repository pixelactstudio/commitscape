# GitHub numbers come from the gh CLI, in the background

The tool can show what GitHub knows about a repository (stars, forks, issues, pull requests, releases) by running one GraphQL query through the `gh` CLI the user has already signed in with. The query runs after the first frame, never on the startup path, and `gh` caches its answer for an hour. Everything else works without it.

## Status

accepted, amended in Build Run 3 (Phase 17): see "Amendment: the whole history" below. Reverses "no network calls" in the original brief's v0.1 scope, at the user's request.

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

## Amendment: the whole history (Build Run 3, Phase 17)

The latest-hundred sample could not say who merged what or who reviews, and read "100+" for anything busy. GitHub's whole history is now read too:

- **Every pull request** (author, created, merged, closed, merged by, its first twenty reviews with reviewer and state), **every issue** (author, created, closed, and the first comment by someone other than its author, among the first five) and **every release**, a hundred to a page.
- **In the order things last changed, oldest first,** keeping where each list was read up to. A later fetch asks only for what changed since; a pull request merged since the last fetch comes back and replaces its older copy.
- **Saved after every page** in `github.json` beside the cache, so a first fetch stopped by the rate limit, a network failure or the user resumes where it stopped. Nothing is kept in the repository.
- **Never from `gh`'s cache:** a page is asked for because it may have changed.
- **In the background,** never before the first screen, and `commitscape github` runs it on demand with progress.
- The one-query summary (stars, totals, the latest release) stays as it was, cached for an hour.
- Commits are linked to GitHub accounts by address (ADR-0011, rule 4), from a few commits per address asked about by id, and kept in the identity store.

Measured on this machine: maihs (319 pull requests) 9.9 s the first time; pingdotgg/t3code (9,294 pull requests, 3,255 issues, 574 releases) 349 s the first time, about 2.6 s a page, and 2.3 s for a fetch with nothing new. Its file is 4.4 MB. A page costs one point of GitHub's 5,000 an hour. rust-lang/rust (98,677 pull requests, 63,968 issues) is about 1,630 pages: inside one hour's limit, but over an hour to read at 2.6 s a page, so its first fetch is expected to be interrupted and carried on by later runs.
