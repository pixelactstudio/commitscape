# Identities merge on strong evidence, visibly, and can be unmerged

A person's Signatures now merge automatically when GitHub links them to the same account, or when they carry the same full display name. Every merge is shown and can be undone. This supersedes ADR-0006's rule that nothing beyond `.mailmap`, email equality and the noreply normalization merges.

## Status

accepted (2026-09-24, Build Run 3). Supersedes the "Nothing else merges" part of ADR-0006; the rest of ADR-0006 stands.

## Context

ADR-0006 chose to under-merge. The reasoning: a wrong merge produces a bus factor that is confidently wrong. Duplicates would be surfaced as a hint that asks the user to write a `.mailmap`.

Real repositories showed the cost of that choice:
- **pixelactstudio:** its owner appears twice. They have the same name, "Dev Talan", under a Gmail address and a GitHub noreply address.
- **maihs:** the owner's 984 commits are split in two. Ryan's 665 to 680 are split across five or six Signatures.

The leaderboard, the shares and the bus factor were all wrong in the under-claiming direction. The owner's reaction was that this is the first thing a new user notices, and nobody writes a `.mailmap` for a repository they are just looking at. The hint helps owners; it does nothing for visitors.

## Decision

Resolution runs in this order:

1. **`.mailmap`,** exactly as git defines it.
2. **Case-insensitive email equality.**
3. **GitHub noreply normalization.**
4. **GitHub accounts.** When `gh` is available and the remote is GitHub, commits are linked to the accounts GitHub resolved them to. Signatures that resolve to the same account merge.
5. **Same full display name.** The names are equal ignoring case, accents and extra spaces, have two or more words, and are not on a list of generic names (`root`, `ubuntu`, `admin`, `builder`, `Your Name`, `unknown`, and similar). Signatures that match merge.

Weaker signals are suggested, never merged:
- a single-word name
- the same email local-part under different domains
- similar names

Bots are recognized by the `[bot]` suffix and known automation accounts. They form their own group and are excluded from people rankings by default.

Every merge is visible:
- Screens show "merged 2 identities" with the Signatures listed.
- An undo is stored in the cache directory, never in the repository.
- An action writes the equivalent `.mailmap` lines for owners who want the fix to apply to every tool.

## Consequences

- Two different people with the same two-word name in one repository would be fused. This is rare, visible and undoable. We accept it in exchange for correct numbers in the common case.
- Resolution stays a pure function of the Signature table plus the mailmap, the GitHub account links and the user's undo list. Changing any of them never requires re-reading history.
- Without `gh`, rule 4 is skipped and single-word names stay split. The suggestion tells the user.
