//! The seam. Everything git-shaped enters `commitscape` through this trait and
//! nothing gix-shaped leaves it (ADR-0001).
//!
//! The interface is push-based: callers hand in sinks and the implementation
//! drives them. Returning an iterator of borrowed git objects would drag `gix`
//! lifetimes straight back through the seam, and a sink keeps peak memory
//! independent of history length.
//!
//! Every method here is shaped by what makes a *fake* easy to write. If a
//! method would be awkward to implement in [`crate::ScriptedRepo`], it is the
//! wrong method.

use std::collections::HashSet;
use std::ops::ControlFlow;

use commitscape_core::Oid;

use crate::mailmap::Mailmap;

/// The tips recorded by the last index. A walk excludes every commit reachable
/// from them, as `git rev-list <tips> --not <frontier>` does.
///
/// A **set**, not a single sha. Merging a long-lived branch introduces commits
/// whose dates are older than the recorded tip; resuming from one sha, or from
/// a timestamp, silently drops them and reports success (ADR-0002). Excluding
/// by reachability rather than by date is what finds them.
pub type Frontier = HashSet<Oid>;

/// A commit, as the adapter sees it.
///
/// Name and email are bytes because git does not guarantee UTF-8 and a
/// repository with a Latin-1 author name must not be silently mangled.
#[derive(Debug, Clone, Copy)]
pub struct RawCommit<'a> {
    pub id: Oid,
    /// Committer time, seconds since the Unix epoch.
    pub time: i64,
    pub author_name: &'a [u8],
    pub author_email: &'a [u8],
    pub parent_count: usize,
}

/// How a commit touched one path, before rename pairing.
///
/// Adapters report only these three. Turning an `Added`/`Deleted` pair that
/// share a blob id into a rename is the builder's job, which means the fake
/// does not reimplement it and the logic is tested once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawChangeKind {
    Added,
    Modified,
    Deleted,
}

/// One path touched by one commit.
#[derive(Debug, Clone, Copy)]
pub struct RawChange<'a> {
    pub path: &'a [u8],
    pub kind: RawChangeKind,
    /// Blob id after the change; for a deletion, the id that was removed.
    /// This is what makes exact-rename detection an id comparison rather than
    /// a content comparison.
    pub blob: Oid,
}

/// Receives commits as the walk produces them.
///
/// Order is roughly newest first but is not a contract: the builder sorts by
/// time before it resolves anything that depends on order.
///
/// A merge's changes are the paths whose content differs from **every**
/// parent, as `git diff-tree -c` reports them. A clean merge therefore has no
/// changes; a conflict resolution, or a file added by the merge itself, does.
/// Diffing against the first parent alone would replay the whole merged branch.
pub trait CommitSink {
    /// Returns [`ControlFlow::Break`] to stop the walk early.
    fn on_commit(&mut self, commit: &RawCommit<'_>, changes: &[RawChange<'_>]) -> ControlFlow<()>;

    /// Called periodically with the commits processed so far and the total
    /// the walk will process, so a long cold index can show real progress
    /// rather than a spinner.
    fn on_progress(&mut self, _done: u64, _total: u64) {}
}

/// Receives the contents of every blob at HEAD.
///
/// This is the one place blob contents are read, and it happens once per index
/// rather than once per commit (ADR-0004).
pub trait TreeSink {
    fn on_blob(&mut self, path: &[u8], contents: &[u8]) -> ControlFlow<()>;
}

/// What a walk did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct WalkStats {
    pub commits_visited: u64,
    /// Commits skipped because they were already in the frontier.
    pub commits_skipped: u64,
    /// True when the repository is shallow, so the counts above are a floor
    /// rather than a total.
    pub history_truncated: bool,
}

/// A repository, as the index layer is allowed to see it.
pub trait RepoSource {
    type Error: std::error::Error + Send + Sync + 'static;

    /// Identity for cache-keying: canonical git dir plus root commit.
    fn identity(&self) -> Result<commitscape_core::RepoIdentity, Self::Error>;

    /// Every commit that should be walked from — all refs, not just HEAD.
    /// Indexing only HEAD's ancestry means a later merge appears to invent
    /// history.
    fn tips(&self) -> Result<Vec<Oid>, Self::Error>;

    /// The repository's mailmap, empty if it has none.
    fn mailmap(&self) -> Result<Mailmap, Self::Error>;

    /// Pushes into `sink` every commit reachable from [`tips`](Self::tips)
    /// but not from `stop_at`, with its name-status changes.
    fn walk_history(
        &self,
        stop_at: &Frontier,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error>;

    /// Reads every blob at HEAD exactly once.
    fn walk_head_tree(&self, sink: &mut dyn TreeSink) -> Result<(), Self::Error>;
}
