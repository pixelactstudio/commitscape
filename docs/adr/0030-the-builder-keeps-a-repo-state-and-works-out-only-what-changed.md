# The Builder keeps a Repo State and works out only what changed

A Build costs what changed since the last one, not how long the history is. The Builder checks a repository's head before doing anything, keeps what it worked out (the Repo State) on its disk and, sealed, in R2, and every step of a Build starts from that State: the commit graph and its Mainline, the Atlas, and the Ownership of lines that Surviving Lines are summed from.

## Status

accepted (2026-10-27, owner decisions D1 to D3 and the tier times in the caching architecture review). Amends ADR-0022: Surviving Lines are counted for everyone once per head, not per person on request. Amends ADR-0026: the Builder still owns git, and now also keeps each repository's State apart from its clone. ADR-0028's rule that no email address leaves the Builder stands: the State in R2 is sealed with a key only the Builder holds.

## Context

Measured on two cores, a warm linux Build with nothing new took about 10 s and 600 MB in the engine, then a Postgres load, a pack upload and an Atlas the Site made again (1.16 GB, 35 CPU-s). Seeds were built every night whether or not anything moved. Losing the engine cache from disk meant reading the whole history again (185 s without lines, about 1,500 CPU-s with them). Surviving Lines were blamed person by person for every new head, nothing carried over: 1.7 to 2.1 GB and 60 s a person on linux, most over budget.

## Decision

- **Nothing new costs one question.** A Build whose Report is whole (its pack, every Mainline line counted, built within a week) asks the remote for its head with `git ls-remote`, and ends there when it has not moved; `repositories.checked_at` records it. Seeds ask GitHub's GraphQL API for a hundred heads at a time, and are built when their head moved and someone viewed them since, or weekly (D1).
- **The commit graph is kept.** The cache keeps each commit's parents by its place in the Index, and the Mainline of the last head, brought up to date from the commits added since. The Mainline walks only the new part of the first-parent line; the commits the last export's frontier reaches come from memory.
- **The Atlas is made once per pack, by the Builder,** from rows `build` writes beside the pack, with the Site's own encoder, in a process of its own that waits for an engine slot, and is stored before the pack is published. The Site only sends it.
- **The Repo State has four tiers.** Read from disk by the Build that uses it (decoded today, to be mapped in place); on the Builder's disk until unused for `STATE_DISK_DAYS` (7) or past `CACHE_BUDGET_GB` (5), least recently used first; in R2 as 8 MB chunks named by their content (zstd, then AES-256-GCM with a key made from `STATE_KEY`), uploading only chunks R2 lacks, until unused for `STATE_KEEP_DAYS` (180), cleaned up by the Builder, not a bucket rule; and nothing, which means a clean Build. A disk miss restores from R2; an R2 miss, or a history rewritten past what the State holds, builds clean.
- **Surviving Lines are a sum over the Ownership of lines** (D2). The Ownership of a head says which commit each line of each Source file came from, as blame says, and is kept per head as runs of lines. A new head that went forward along its first-parent line keeps every file whose path no first-parent commit since changed: walking back from the new head, such a file meets only first-parent commits whose first parent has it unchanged, so blame passes it straight down to the earlier head. Every other file is blamed with the same walk, which stops wherever it reaches the earlier head with a file whose ownership is known there. Lines Changed stay counted over every branch (D3).
- **Today's blame is the referee.** A test compares everyone's counts with blame person by person on scripted histories, on every fixture and, on demand, on a real repository; react agrees for all 1,997 people.

## Considered

- **A forward pass along the Mainline, with blame only for lines merged in.** In a history like linux's nearly every line arrives through a merge, so it would blame almost everything at every head, or keep the ownership of every past head to start side branches from. The carried-over blame above gives the same answer as blame by construction and costs only the files the new head changed.
- **Keeping full clones.** linux's is 6.6 GB and receiving it costs 579 CPU-s; a blobless repository is 2.4 GB. Fetching 17,127 new linux commits blobless took 36 MB and 3.1 CPU-s, and every blob their diffs name, missing ones fetched in one request by id, 105 MB and 9.6 CPU-s, against 214 MB and 16.6 CPU-s for the full fetch. The engine (gix) cannot fetch a missing blob, so the kept clone turns blobless only once the blobs it needs are fetched first, in batches; that is the next step.

## Consequences

- A repository whose head did not move is not built for up to a week; its time Windows end where its last Build ended.
- `STATE_KEY` must be set for the R2 tier and kept: a new key makes every State in R2 unreadable, and those repositories build clean once.
- The first Ownership of a large repository is the cost of blaming all of it, spread over budgeted runs that each keep what they finished; every head after it costs the files that changed.
- Surviving Lines show "counting" for a new head until its Ownership is whole.
