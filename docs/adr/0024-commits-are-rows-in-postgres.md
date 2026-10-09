# Commits are rows in Postgres, read a page at a time

On the Site, a stored Report's Commit List is no longer one object the browser downloads whole and searches. The Builder writes one row per commit to Postgres, and the Commits screen asks the Site for a page of them at a time: searched, filtered and counted by the database. A Shared Report keeps its Commit List inside its locked file and is still paged and searched in the browser.

## Status

accepted (2026-10-08, architecture review). Replaces the hosted half of ADR-0019; the browser search of ADR-0019 stays for Shared Reports.

## Context

ADR-0019 put the whole Commit List in every Report. It measured about 45 bytes a commit gzipped, which is fine for facebook/react (1.5 MB) but not for torvalds/linux: 75 MB gzipped, 98% of its Report, and over the Site's 64 MiB cap. Every visitor to the Commits screen downloaded all of it, then searched it in a Web Worker.

Nobody reads a million commits. People read the newest fifty, or the fifty that match what they typed.

## Decision

- **The Builder writes the Commit List apart** (`commitscape report --commits-out FILE`) and `storeCommits` inserts it into `commits`: one row per commit, keyed by repository, Report and `seq` (its place in the list, 0 the newest). Inserts go in batches of 10,000 through `unnest`, four at a time. The list's people, kinds and link go in one small gzipped object beside the Report (`commits-meta.json`), without email addresses.
- **Old rows go when the Report changes.** After it points the repository at the new Report, the Builder drops the repository's rows of any other Report (`dropCommits`). Rows go with their repository when it is deleted, and move with it when it is renamed.
- **A page is fifty commits** (up to 200), newest first. The cursor is the last `seq` shown, so a page costs the same at the end of history as at the start (keyset pagination, never `OFFSET`). The first page carries the exact count of what matched; later pages do not count again.
- **Search means what it meant in the browser.** Every word typed must appear, in any case, in the subject line or in the name or GitHub login of who made it. Names match against the people object, so a word turns into "subject contains it, or the commit is by one of these people". Person, Commit Kind and a time range narrow it, each by an index.
- **No trigram index.** On 1.4 million generated commits, `pg_trgm` cut a rare word from about a second to 20 ms, but it made storing the list several times slower (about 30 s became over 3 minutes) and needs an extension PGlite tests would have to load. A plain scan answers a word in 0.4 to 1.4 s on Linux-sized history, and in a few milliseconds on the repositories most people look up. This is revisited if Linux-sized repositories become common.
- **Caching.** Each page has an ETag made from the Report and the query, so a repeated ask is answered `304` without touching the database. A public repository's page is `public, max-age=300`, or `immutable` when the address names the Report it was built at (`at`); a private repository's is `private, max-age=60`, after the same access check as every other answer of its Report.
- **Shared Reports stay locked.** A Shared Report is uploaded encrypted (ADR-0016) and the Site cannot read it, so it cannot have rows. Its Commit List stays inside the locked file; once the browser has unlocked it, the same pages are made in memory over the list, searched in a Web Worker above 50,000 commits. The Commits screen asks both kinds of Data Source the same way, `commits(query, cursor)`.
- **Reports stored before this** have no rows. Their Commits screen says the list shows once the Report is built again, which a Report over a day old offers anyway.

## Consequences

- A Report no longer grows with its history's length; torvalds/linux fits under the cap.
- Postgres holds every commit of every stored Report: about 500 bytes a commit with indexes, as each row repeats the repository and Report keys. Linux takes about 700 MB.
- Storing a Linux-sized list takes about 25 to 35 s in the Build.
- The Commits screen needs the Site to answer while you type; it no longer works from a downloaded copy.
