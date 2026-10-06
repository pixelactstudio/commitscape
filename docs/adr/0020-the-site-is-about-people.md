# The Site is about people; people are compared, never scored, and can hide

The Site's centre moves from a repository's Report to a person's Profile. People are compared within a repository and with each other, view by view, with no combined score. Private work is never named to someone who can't see it, and anyone can hide from comparisons. A Profile reads GitHub's API at once and the engine's numbers stream in after.

## Status

accepted (2026-10-04, Build Run 5 plan). Reverses Build Run 4's "No scores for people. Leaderboards rank repositories." Extends ADR-0017.

## Context

The owner reviewed the live Site on 2026-10-04. A repository's Report answers an auditor's questions, and nothing on it is about the visitor, so nobody returns or shares it. The owner's original question was "how much have I put into this project", and they compare themselves with the people on their team to stay ahead. Developer tools that spread are about the person and make something they post.

Ranking people carries risks: shaming, gaming, and naming private work. GitHub's API also has rate limits: 5,000 requests an hour per token.

## Decision

- **A Profile per GitHub login** (`/u/<login>`), built from public data for anyone, and from private data only for the signed-in person themselves.
- **Two speeds.** GitHub's GraphQL API gives identity, repositories, pull requests with additions and deletions, reviews, issues and the contribution calendar at once. The engine gives Lines Changed and Surviving Lines (ADR-0022) for repositories the Site has built, streamed into their sections.
- **Tokens.** A signed-in viewer's requests use their own token. Anonymous views use the Site's token and a stored copy in Postgres, refreshed after a day. Embeds and preview images never call GitHub (ADR-0021).
- **Comparisons, not scores.** Standings, Versus, Races, Crews and the people Leaderboards show several views side by side: merged pull requests, reviews, Surviving Lines, Lines Changed, commits. They lead with the views that are hard to inflate. There is never one number for a person.
- **Privacy rules:**
  - A private repository's Standings are shown only to people who can see the repository on GitHub, checked as ADR-0017 checks access.
  - A Profile counts private work only in totals and never names a private repository, unless its person opts in.
  - A signed-in person can hide their Profile. A hidden person appears in no Versus, Leaderboard or other person's Standings, and their Profile says only that it is hidden.
  - Races and Crews include a person only after they accept.
- **The Builder keeps each built repository's pull requests and reviews,** fetched once and then only what changed, so Standings have more than commits.

## Consequences

- The App may need the read-only "Read user profile" permission. The owner adds it if Phase 33 shows it is needed.
- Postgres gains Profiles, stored GitHub copies, hiding, Rivals, Races, Crews and Seasons.
- `/privacy` is rewritten to say what a Profile shows and how to hide.
- The repository page stays, trimmed, as a secondary page.
