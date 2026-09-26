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

use commitscape_core::{CommitKind, LineDelta, Oid};

use crate::mailmap::Mailmap;

/// The tips recorded by the last index (ADR-0002).
///
/// A **set**, not a single sha. Merging a long-lived branch introduces commits
/// whose dates are older than the recorded tip; resuming from one sha, or from
/// a timestamp, silently drops them and reports success.
pub type Frontier = HashSet<Oid>;

/// Commits already in the index.
///
/// Always closed under ancestry: every parent of an indexed commit is indexed
/// too, or absent from a shallow clone. That lets a walk stop at the first
/// indexed commit on each path and still find every new commit, including
/// older-dated ones a merge made reachable, in time proportional to the new
/// commits rather than to history.
pub trait Indexed: Sync {
    fn contains(&self, id: &Oid) -> bool;
}

impl Indexed for HashSet<Oid> {
    fn contains(&self, id: &Oid) -> bool {
        HashSet::contains(self, id)
    }
}

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
    /// Author time, seconds since the Unix epoch.
    pub author_time: i64,
    /// The author's offset from UTC, in seconds.
    pub author_offset: i32,
    /// What the message says it is, read as the commit was walked
    /// ([`crate::message::kind_of`]).
    pub kind: CommitKind,
    /// Its message's subject line ([`crate::message::subject_of`]).
    pub subject: &'a str,
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

/// One file at HEAD: where it is and which blob it holds. Submodules are not
/// files and are never listed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadEntry {
    pub path: Vec<u8>,
    pub blob: Oid,
    pub symlink: bool,
}

/// How a file at HEAD changed since an earlier commit. For a deletion,
/// `entry.blob` is the blob removed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadChange {
    pub entry: HeadEntry,
    pub kind: RawChangeKind,
}

/// Receives blob contents, possibly from several threads at once: the index
/// in the request, and the bytes.
pub type BlobSink<'a> = &'a (dyn Fn(usize, &[u8]) + Sync);

/// Receives one commit's line counts, possibly from several threads at
/// once: the commit, its changes as the walk reported them, and the lines
/// each added and removed, `None` where they were not counted.
pub type LineSink<'a> = &'a (dyn Fn(Oid, &[RawChange<'_>], &[Option<LineDelta>]) + Sync);

/// What a walk did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct WalkStats {
    pub commits_visited: u64,
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

    /// A cheap summary of every history ref and of HEAD.
    ///
    /// Equal fingerprints mean nothing [`tips`](Self::tips) or the HEAD tree
    /// depend on has moved, so a warm start can skip the walk without peeling
    /// a single tag. Computing it must not read commits or trees.
    fn refs_fingerprint(&self) -> Result<u64, Self::Error>;

    /// Whether every one of `commits` is reachable from `from`.
    ///
    /// False means history was rewritten, or a branch holding unmerged commits
    /// was deleted. Either way, something the cache recorded is no longer part
    /// of the repository's history, and resuming would keep it.
    fn all_reachable(&self, commits: &[Oid], from: &[Oid]) -> Result<bool, Self::Error>;

    /// The repository's mailmap, empty if it has none.
    fn mailmap(&self) -> Result<Mailmap, Self::Error>;

    /// A cheap value that changes whenever [`mailmap`](Self::mailmap) would
    /// return something different.
    ///
    /// Read on every warm start, so it must not read git objects when it can
    /// avoid it. A mailmap that lives in history (a bare repository's, say)
    /// can only change when HEAD does, which the refs fingerprint already
    /// covers; only a work-tree file can change behind git's back.
    fn mailmap_fingerprint(&self) -> Result<u64, Self::Error>;

    /// Where the default remote fetches from, if there is one: `origin`, or
    /// the only remote. Read from configuration, never from the network.
    fn remote_url(&self) -> Option<String> {
        None
    }

    /// Pushes into `sink` every commit reachable from [`tips`](Self::tips)
    /// that is not already `indexed`, with its name-status changes. The walk
    /// does not go past an indexed commit.
    fn walk_history(
        &self,
        indexed: &dyn Indexed,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error>;

    /// The commit HEAD points at, if it points at one.
    fn head_commit(&self) -> Result<Option<Oid>, Self::Error>;

    /// Every file at HEAD, without contents.
    fn head_files(&self) -> Result<Vec<HeadEntry>, Self::Error>;

    /// How the files at HEAD differ from those of commit `since`, if the
    /// adapter can say without listing HEAD. `None` asks the caller to use
    /// [`head_files`](Self::head_files) instead.
    fn head_changes(&self, since: Oid) -> Result<Option<Vec<HeadChange>>, Self::Error>;

    /// Reads the given blobs and hands each one's contents to `sink` with its
    /// position in `blobs`. The only place blob contents are read (ADR-0004),
    /// and only for files at HEAD.
    fn read_blobs(&self, blobs: &[Oid], sink: BlobSink<'_>) -> Result<(), Self::Error>;

    /// Counts the lines each change of each of `commits` added and removed
    /// ([`crate::lines::line_delta`]), for commits with at most one parent;
    /// merges are passed over. This is the line pass (ADR-0012), which reads
    /// blobs after the first screen, never the history walk. Commits reach
    /// `sink` in any order.
    fn count_lines(&self, commits: &[Oid], sink: LineSink<'_>) -> Result<(), Self::Error>;

    /// The commits `.git-blame-ignore-revs` names: the work tree's file, or
    /// HEAD's when there is no work tree.
    fn blame_ignore_revs(&self) -> Result<Vec<Oid>, Self::Error>;
}
