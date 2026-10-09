# The Builder owns git, and a Build has two phases

The Builder clones and fetches repositories itself and resolves GitHub logins itself; the commitscape binary only reads a local checkout. A Build runs two clones at once: a clone without old file contents gives a Report without Lines Changed, published at once, and a full clone gives the Report with them, which replaces it.

## Status

accepted (2026-10-09, architecture review). Amends ADR-0015.

## Context

The binary used to clone the repository it was given. Measured in the 2026-10-08 review, the clone was 66 to 70% of a cold Build: torvalds/linux took 848 s to clone, past the 900 s limit before the engine read a commit. Seeds also ran `commitscape health`, which made a second clone (4.2 GB for linux) for two numbers.

Logins were found in TypeScript after the Report was written, so identities the same GitHub account made (ADR-0011) were never joined on the Site. The Report had no email addresses (ADR-0019's privacy rule), so it could not be joined afterwards either.

## Decision

- **Two clones at once.** A blobless clone (`--filter=blob:none`, with a checkout) is much smaller and gives everything but Lines Changed; the full clone runs beside it. The quick Report is published under its own key and the Build is marked partial; the full Report replaces it. A quick Report never replaces one with lines.
- **Logins before the Report.** `commitscape signatures` lists each author address, how many commits it made, and its newest commit. A noreply address gives the login at once; for the rest the Builder asks GitHub who made that one commit, through the Postgres cache (`github_cache`), kept for a year since a commit's author never changes. The addresses live only in the Build's scratch folder and are deleted with it. `report --accounts` and `surviving --accounts` take the result, so people are joined in the Report itself and Surviving Lines count the same people.
- **Issue answer numbers** for seeds come from GitHub's REST API in TypeScript, with `health`'s definition, so there is no second clone.
- **Separate limits** for the clone and for each run of the binary, and a lane for large repositories (`LARGE_REPOSITORY_MB`) with its own concurrency, so one large Build never holds up small ones.
- **A Build always ends.** Claiming a Build is one update; a `finally` gives it a terminal state; a reaper fails Builds whose job is gone and sends again queued ones whose job was lost.
- **Clones live in known folders**: a public repository's full clone is kept and fetched next time; a private one, and every scratch folder, is deleted after its job, and a sweep removes any left behind.

## Consequences

- A visitor sees a Report as soon as the quick clone and its run finish, usually well before the full clone ends.
- A cold Build needs disk for both clones at once.
- People's ids depend on the accounts given, so a Report and the Surviving Lines counted for it must use the same accounts, and Surviving Lines rebuild them from the cache rather than from a Report built with different ones.
- The binary makes no network calls during a Build.
