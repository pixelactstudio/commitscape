use std::collections::HashSet;
use std::ops::ControlFlow;

use commitscape_core::{CommitKind, LineDelta, Oid};

use crate::mailmap::Mailmap;

pub type Frontier = HashSet<Oid>;

pub trait Indexed: Sync {
    fn contains(&self, id: &Oid) -> bool;
}

impl Indexed for HashSet<Oid> {
    fn contains(&self, id: &Oid) -> bool {
        HashSet::contains(self, id)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RawCommit<'a> {
    pub id: Oid,
    pub time: i64,
    pub author_name: &'a [u8],
    pub author_email: &'a [u8],
    pub author_time: i64,
    pub author_offset: i32,
    pub kind: CommitKind,
    pub subject: &'a str,
    pub parent_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Copy)]
pub struct RawChange<'a> {
    pub path: &'a [u8],
    pub kind: RawChangeKind,
    pub blob: Oid,
}

pub trait CommitSink {
    fn on_commit(&mut self, commit: &RawCommit<'_>, changes: &[RawChange<'_>]) -> ControlFlow<()>;

    fn on_progress(&mut self, _done: u64, _total: u64) {}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadEntry {
    pub path: Vec<u8>,
    pub blob: Oid,
    pub symlink: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadChange {
    pub entry: HeadEntry,
    pub kind: RawChangeKind,
}

pub type BlobSink<'a> = &'a (dyn Fn(usize, &[u8]) + Sync);

pub type LineSink<'a> = &'a (dyn Fn(Oid, &[RawChange<'_>], &[Option<LineDelta>]) + Sync);

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct WalkStats {
    pub commits_visited: u64,
    pub history_truncated: bool,
}

pub trait RepoSource {
    type Error: std::error::Error + Send + Sync + 'static;

    fn identity(&self) -> Result<commitscape_core::RepoIdentity, Self::Error>;

    fn tips(&self) -> Result<Vec<Oid>, Self::Error>;

    fn refs_fingerprint(&self) -> Result<u64, Self::Error>;

    fn all_reachable(&self, commits: &[Oid], from: &[Oid]) -> Result<bool, Self::Error>;

    fn mailmap(&self) -> Result<Mailmap, Self::Error>;

    fn mailmap_fingerprint(&self) -> Result<u64, Self::Error>;

    fn remote_url(&self) -> Option<String> {
        None
    }

    fn walk_history(
        &self,
        indexed: &dyn Indexed,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error>;

    fn head_commit(&self) -> Result<Option<Oid>, Self::Error>;

    fn head_files(&self) -> Result<Vec<HeadEntry>, Self::Error>;

    fn head_changes(&self, since: Oid) -> Result<Option<Vec<HeadChange>>, Self::Error>;

    fn read_blobs(&self, blobs: &[Oid], sink: BlobSink<'_>) -> Result<(), Self::Error>;

    fn count_lines(&self, commits: &[Oid], sink: LineSink<'_>) -> Result<(), Self::Error>;

    fn blame_ignore_revs(&self) -> Result<Vec<Oid>, Self::Error>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameCommit {
    pub time: i64,
    pub parents: Vec<Oid>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Moves {
    pub deleted: Vec<(Vec<u8>, Oid)>,
    pub added: Vec<(Vec<u8>, Oid)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InParent {
    Same,
    Changed(Oid),
    Absent,
}

pub trait BlameThreads: Sync {
    type Local: BlameSource;

    fn local(&self) -> Self::Local;
}

pub trait BlameSource {
    type Error: std::error::Error + Send + Sync + 'static;

    fn blame_commit(&self, id: Oid) -> Result<Option<BlameCommit>, Self::Error>;

    fn blame_compare(
        &self,
        commit: Oid,
        parent: Oid,
        paths: &[&[u8]],
    ) -> Result<Vec<InParent>, Self::Error>;

    fn blame_moves(&self, commit: Oid, parent: Oid) -> Result<Moves, Self::Error>;

    fn blame_blob(&self, blob: Oid) -> Result<Vec<u8>, Self::Error>;
}
