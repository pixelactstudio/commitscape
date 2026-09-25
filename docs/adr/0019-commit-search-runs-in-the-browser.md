# Commit search runs in the browser over the Commit List; no search service

Searching commits by message, person and date runs in the browser, over a Commit List that the local server serves and every Report carries: one compact row per commit. There is no Algolia, no search server and no index to host. On the Site, the Commit List shows people's names and GitHub logins, never email addresses.

## Status

accepted (2026-09-25, Build Run 4 plan).

## Context

The owner wants a page to search all of a repository's commits, as fast as npmx.dev's package search. npmx is fast because of client-side technique, not because of Algolia:
- the first keystroke acts at once (a leading-edge 100 ms debounce)
- only visible rows are rendered
- results are prefetched

A repository has at most about a million commits, and typically under 50,000. Scanning 50,000 short strings takes a few milliseconds in a browser. The index keeps each commit's Commit Kind, but not its message.

## Decision

- **The index keeps each commit's subject line** (its first line, capped at 200 bytes). The cache schema version is bumped. The size increase is measured on rust-lang/rust and Linux, and recorded.
- **The Commit List** is `GET /api/commits` locally and a section of every Report. Each row holds:
  - the short and full id
  - the Author Identity (as its merged person)
  - the author time and Local Time offset
  - the subject and the Commit Kind
  - files changed, and lines added and removed when counted

  It is served gzipped and cached by the browser.
- **Search runs in a Web Worker** when the list has more than 20,000 rows, otherwise on the main thread:
  - case-insensitive substring and word-prefix matching on the subject
  - filters by person, date range and Commit Kind
- **The list is virtualised,** with a leading-edge 100 ms debounce. `/` focuses the search box.
- **A commit links to GitHub** when the remote is on GitHub.
- **Email addresses:**
  - Locally, the person filter matches email addresses too, since the data is the user's own.
  - Hosted Commit Lists carry no email addresses. People appear by name and GitHub login, so the Site can't be used to harvest them.
- **Budget:** keystroke to updated results under 16 ms at 25,000 commits (facebook/react). The rust-lang/rust list size and search time are measured and recorded.

## Consequences

- **Reports grow by the Commit List,** about 30 bytes per commit gzipped (estimated; measure).
- **The Commits screen becomes a sixth Panel** in the browser interface only. The terminal UI stays frozen.
