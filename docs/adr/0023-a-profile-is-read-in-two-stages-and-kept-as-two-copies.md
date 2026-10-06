# A Profile is read in two stages and kept as two copies

A Profile is read from GitHub's GraphQL API in two stages: the person and their yearly totals first, then their pull requests. Each stage is stored as soon as it is read. Postgres keeps two copies per login: the public one, which anyone sees, and the person's own, which only they see.

## Status

accepted (2026-10-04, Phase 33). Builds on ADR-0020.

## Context

Reading a busy person's pull requests takes GitHub tens of seconds: gaearon's 3,569 take about 35 s through search, however the requests are split, because GitHub answers concurrent searches slowly. The person, their year totals, calendar and languages take 3 to 9 s. Nobody should wait 35 s for a tile that needs 3.

ADR-0020 also says private work is named only to its person, and a signed-in viewer's own token reads for them, so what a token can see differs from viewer to viewer.

## Decision

- **Stage one** asks for the person (`repositoryOwner`) and every year's `contributionsCollection`, two years a request, all at once. It gives the identity, totals, calendar, streaks, languages, and each repository's commits, reviews and opened pull requests. It is stored at once with GitHub's raw answers, so stage two never asks for them again.
- **Stage two** searches the person's pull requests by date range, newest year first: a range holding more than 100 is split in two and both halves asked, ten requests at a time, up to 3,000 pull requests; and one request reads who reviewed their newest 100. It adds lines merged, time to merge, merged pull requests per repository, and partners.
- **The page streams both.** The hero comes from the stored identity (or one request); stage-one sections suspend on the quick query, stage-two sections on the full one, each in its own boundary.
- **Two copies.** `profiles(login, scope)`: `public`, which any token may refresh but never holds a private repository's name, title or pull request (only totals that include private work, as GitHub reports them to that token); and `self`, read with the person's own token and shown only to them. Both are read again after a day.
- **Bots** (link previews, crawlers) get the whole page at once, which TanStack Start does by itself.

## Consequences

- A cold Profile shows its hero in under a second and its tiles in 3 to 9 s; the rest follows. A warm one is drawn whole in under a second, with no request to GitHub.
- A public copy's totals depend a little on whose token last refreshed it: GitHub counts contributions a token can see. Names never leak; numbers may differ by a viewer's visibility. Using only the Site's token for the public copy would remove that, at the cost of the Site's rate limit.
- Pull requests beyond 3,000, or beyond 1,000 in one day, are not read; the page says how many were.
