# Git access sits behind a `RepoSource` trait

`gix` is our only git implementation, and `gix` types appear in exactly one crate. Everything above the index layer sees plain data types and never learns that gitoxide exists.

## Status

accepted

## Context

The original argument for the seam was insurance: `gix` might have gaps, and we'd want to fall back to `git2` or to shelling out. That argument is weaker than it looks. `onefetch` completed a full migration off `libgit2` to `gix` and came out 3–23% faster on the Linux, git, and WebKit repositories — on very nearly our workload. `gitoxide`'s own crate status lists commit-graph read access, tree diffing, rename tracking, and mailmap as complete. The gaps we were insuring against are mostly not there.

One adapter means a hypothetical seam. Two adapters means a real one. On the insurance argument alone, we'd be building a hypothetical seam.

## Decision

We build the trait anyway, because the second adapter is not `git2` — it is the **test fixture**. A scripted in-memory `RepoSource` lets the entire index layer be tested deterministically and instantly, with no temp directories, no `git` subprocess, and no fixture repository to keep in sync. That is a real second adapter, so this is a real seam.

The interface is **push-based**: callers hand in sinks and the implementation drives them. It does not return iterators or borrowed git objects, because either would leak `gix` lifetimes and types straight back through the seam we just built, and because push-based traversal is what keeps peak memory independent of history length.

## Consequences

- The trait's shape is dictated by what makes a *fake* easy to write, not by what `gix` happens to expose. If a method is awkward to fake, it is the wrong method.
- Falling back to `git2` remains possible but is explicitly not why this exists. If we ever need it, the seam is already load-bearing and tested.
- A push-based interface is less ergonomic than an iterator for ad-hoc use. We accept that; the index layer is the only caller.
