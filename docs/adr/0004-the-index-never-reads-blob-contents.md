# The history walk never reads blob contents

The commit walk reads tree structure only — paths and object ids, never file contents. Blobs are read exactly once, in a separate pass over the HEAD tree. This single rule is what makes the cold-index budget reachable, and it is the reason three separate features are absent from v0.1.

## Status

accepted for the history walk. Its "No line counts" is amended by ADR-0012: lines are counted by a separate pass after the first screen, never by the walk.

## Context

Comparing two trees to find which paths changed requires only comparing entry object ids; identical subtrees are skipped wholesale without ever decompressing anything. Determining *how much* a file changed, or who wrote which line, requires decompressing and diffing the blobs themselves. On a repository with a million commits averaging a handful of touched files each, that is millions of decompress-and-diff operations versus a graph walk that touches almost no file data at all. The gap is one to two orders of magnitude, and it lands entirely inside the cold-index budget.

`gitoxide`'s own crate status lists `gix-blame` as incomplete, with three outstanding performance items — a custom graph walk, commit-graph tree access, and bloom filters — before it is competitive. Blame is not merely expensive for us; it is not yet fast upstream.

## Decision

The walk collects name-status data only. Three consequences follow, and we accept all three:

- **No blame.** Line-level survival and true line ownership are a v0.3 feature behind an explicit `--deep` flag.
- **No line counts.** Ownership is commit-weighted, not line-weighted. The interface states this rather than implying otherwise.
- **Exact renames only.** A file that moved without changing is followed across the move, because that is a tree-entry-id comparison. A file that moved *and* changed starts a new history, because detecting that requires similarity scoring over blob contents.

## Consequences

- Ownership carries a known bias: fifty one-line commits out-weigh three commits that wrote the module. This is a real accuracy cost, paid deliberately for the startup budget. The tool must never present commit-weighted ownership as though it were line-weighted.
- The `Changeset` schema reserves an optional line-delta field from day one. Adding `--numstat` collection later is a population, not a migration.
- Move-plus-edit renames sever history. Similarity detection can be added later without changing the file-identity model, since exact and similarity renames resolve to the same stable identity.
- Commit-size distribution (v0.2) and agent diff volume (v0.3) both need line counts, and both therefore arrive with `--deep` rather than in the default path.
