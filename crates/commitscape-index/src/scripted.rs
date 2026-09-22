//! An in-memory [`RepoSource`] built by hand.
//!
//! This is the second adapter that makes the seam in ADR-0001 real rather than
//! hypothetical. It lets the whole index layer be tested with no temp
//! directories, no `git` subprocess, and no fixture repository to keep in sync,
//! and it means a test can construct a history that would be awkward to produce
//! with real git at all.
//!
//! Histories are built with a cursor, the way a person thinks about branches:
//! [`commit`](ScriptedRepo::commit) adds a child of the cursor and moves the
//! cursor onto it, [`at`](ScriptedRepo::at) moves the cursor back to an earlier
//! commit to start a branch, and [`merge`](ScriptedRepo::merge) joins the
//! cursor with another commit. Every commit without children is a tip, as if a
//! branch pointed at it.

use std::collections::HashSet;
use std::convert::Infallible;

use commitscape_core::{Oid, RepoIdentity};

use crate::mailmap::Mailmap;
use crate::source::{
    BlobSink, CommitSink, HeadChange, HeadEntry, Indexed, RawChange, RawChangeKind, RawCommit,
    RepoSource, WalkStats,
};

#[derive(Debug, Clone)]
struct ScriptedChange {
    path: Vec<u8>,
    kind: RawChangeKind,
    blob: Oid,
}

#[derive(Debug, Clone)]
struct ScriptedCommit {
    id: Oid,
    time: i64,
    name: Vec<u8>,
    email: Vec<u8>,
    parents: Vec<Oid>,
    changes: Vec<ScriptedChange>,
}

/// A history written out by hand.
///
/// Commits are added oldest-first because that is how a person thinks about a
/// history; [`walk_history`](RepoSource::walk_history) emits them newest-first
/// because that is how a real walk behaves, and the builder must cope with it.
#[derive(Debug, Clone, Default)]
pub struct ScriptedRepo {
    commits: Vec<ScriptedCommit>,
    cursor: Option<Oid>,
    /// Tips set by [`only_tips`](ScriptedRepo::only_tips); every childless
    /// commit otherwise.
    tips: Option<Vec<Oid>>,
    head_blobs: Vec<(Vec<u8>, Vec<u8>)>,
    mailmap: Mailmap,
    truncated: bool,
    reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

/// `(path, kind, blob)`: one change in a scripted commit.
pub type ScriptedChangeSpec<'a> = (&'a [u8], RawChangeKind, Oid);

impl ScriptedRepo {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_mailmap(mut self, mailmap: Mailmap) -> Self {
        self.mailmap = mailmap;
        self
    }

    /// Marks the history as shallow, so the walk reports it as truncated.
    pub fn truncated(mut self) -> Self {
        self.truncated = true;
        self
    }

    /// Adds a commit whose parent is the cursor, and moves the cursor to it.
    pub fn commit(
        self,
        time: i64,
        author: (&str, &str),
        changes: &[ScriptedChangeSpec<'_>],
    ) -> Self {
        let parents = self.cursor.into_iter().collect();
        self.push(time, author, parents, changes)
    }

    /// Moves the cursor to the nth commit added, counting from 1, so the next
    /// commit starts a branch there.
    pub fn at(mut self, n: u32) -> Self {
        self.cursor = Some(synthetic_oid(n));
        self
    }

    /// Adds a merge of the cursor with the nth commit added, counting from 1.
    /// `changes` are what the merge itself introduced: the paths that differ
    /// from every parent.
    pub fn merge(
        self,
        time: i64,
        author: (&str, &str),
        other: u32,
        changes: &[ScriptedChangeSpec<'_>],
    ) -> Self {
        let parents = self
            .cursor
            .into_iter()
            .chain([synthetic_oid(other)])
            .collect();
        self.push(time, author, parents, changes)
    }

    fn push(
        mut self,
        time: i64,
        author: (&str, &str),
        parents: Vec<Oid>,
        changes: &[ScriptedChangeSpec<'_>],
    ) -> Self {
        let id = synthetic_oid(self.commits.len() as u32 + 1);
        self.commits.push(ScriptedCommit {
            id,
            time,
            name: author.0.as_bytes().to_vec(),
            email: author.1.as_bytes().to_vec(),
            parents,
            changes: changes
                .iter()
                .map(|(p, k, b)| ScriptedChange {
                    path: p.to_vec(),
                    kind: *k,
                    blob: *b,
                })
                .collect(),
        });
        self.cursor = Some(id);
        self
    }

    /// Makes only the listed commits tips, counting from 1, as if the refs to
    /// every other branch did not exist yet. Commits reachable only from
    /// hidden branches are invisible to the walk.
    pub fn only_tips(mut self, ns: &[u32]) -> Self {
        self.tips = Some(ns.iter().map(|&n| synthetic_oid(n)).collect());
        self
    }

    /// Sets the contents of a file at HEAD, for the tree pass. Setting a path
    /// again replaces its contents, as a commit would.
    pub fn head_file(mut self, path: &[u8], contents: &str) -> Self {
        self.head_blobs.retain(|(p, _)| p.as_slice() != path);
        self.head_blobs
            .push((path.to_vec(), contents.as_bytes().to_vec()));
        self
    }

    /// Removes a file from HEAD.
    pub fn without_head_file(mut self, path: &[u8]) -> Self {
        self.head_blobs.retain(|(p, _)| p.as_slice() != path);
        self
    }

    /// How many blobs [`read_blobs`](RepoSource::read_blobs) has read, so a
    /// test can check that an unchanged file is not read twice.
    pub fn blobs_read(&self) -> usize {
        self.reads.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// The id assigned to the nth commit added, counting from 1.
    pub fn commit_id(&self, n: u32) -> Oid {
        synthetic_oid(n)
    }

    fn find(&self, id: Oid) -> Option<&ScriptedCommit> {
        self.commits.iter().find(|c| c.id == id)
    }

    /// Every commit reachable from `from`, including the starting points.
    fn reachable(&self, from: impl IntoIterator<Item = Oid>) -> HashSet<Oid> {
        let mut seen = HashSet::new();
        let mut stack: Vec<Oid> = from.into_iter().collect();
        while let Some(id) = stack.pop() {
            let Some(commit) = self.find(id) else {
                continue;
            };
            if seen.insert(id) {
                stack.extend(commit.parents.iter().copied());
            }
        }
        seen
    }
}

/// A blob id for contents: the same contents always get the same id, as in
/// git.
fn blob_of(contents: &[u8]) -> Oid {
    let mut b = [0u8; 20];
    b[..8].copy_from_slice(&xxhash_rust::xxh3::xxh3_64(contents).to_le_bytes());
    b[8..16].copy_from_slice(&xxhash_rust::xxh3::xxh3_64_with_seed(contents, 1).to_le_bytes());
    Oid(b)
}

/// Deterministic, human-readable object ids so a failing test prints something
/// you can reason about.
pub fn synthetic_oid(n: u32) -> Oid {
    let mut b = [0u8; 20];
    b[16..20].copy_from_slice(&n.to_be_bytes());
    Oid(b)
}

impl RepoSource for ScriptedRepo {
    type Error = Infallible;

    fn identity(&self) -> Result<RepoIdentity, Self::Error> {
        Ok(RepoIdentity {
            git_dir: "/scripted/.git".to_string(),
        })
    }

    fn tips(&self) -> Result<Vec<Oid>, Self::Error> {
        if let Some(tips) = &self.tips {
            let mut tips = tips.clone();
            tips.sort_unstable();
            return Ok(tips);
        }
        let parents: HashSet<Oid> = self
            .commits
            .iter()
            .flat_map(|c| c.parents.iter().copied())
            .collect();
        let mut tips: Vec<Oid> = self
            .commits
            .iter()
            .map(|c| c.id)
            .filter(|id| !parents.contains(id))
            .collect();
        tips.sort_unstable();
        Ok(tips)
    }

    fn refs_fingerprint(&self) -> Result<u64, Self::Error> {
        let mut h = xxhash_rust::xxh3::Xxh3::new();
        for tip in self.tips()? {
            h.update(&tip.0);
        }
        if let Some(head) = self.cursor {
            h.update(&head.0);
        }
        Ok(h.digest())
    }

    fn all_reachable(&self, commits: &[Oid], from: &[Oid]) -> Result<bool, Self::Error> {
        let reachable = self.reachable(from.iter().copied());
        Ok(commits.iter().all(|c| reachable.contains(c)))
    }

    fn mailmap(&self) -> Result<Mailmap, Self::Error> {
        Ok(self.mailmap.clone())
    }

    fn mailmap_fingerprint(&self) -> Result<u64, Self::Error> {
        Ok(self.mailmap.fingerprint())
    }

    fn walk_history(
        &self,
        indexed: &dyn Indexed,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error> {
        let mut stats = WalkStats {
            history_truncated: self.truncated,
            ..WalkStats::default()
        };
        // Reachable from the tips without passing through an indexed commit.
        let mut wanted = HashSet::new();
        let mut stack = self.tips()?;
        while let Some(id) = stack.pop() {
            if indexed.contains(&id) || !wanted.insert(id) {
                continue;
            }
            if let Some(c) = self.find(id) {
                stack.extend(c.parents.iter().copied());
            }
        }

        for c in self.commits.iter().rev() {
            if !wanted.contains(&c.id) {
                continue;
            }
            let changes: Vec<RawChange<'_>> = c
                .changes
                .iter()
                .map(|ch| RawChange {
                    path: &ch.path,
                    kind: ch.kind,
                    blob: ch.blob,
                })
                .collect();
            let raw = RawCommit {
                id: c.id,
                time: c.time,
                author_name: &c.name,
                author_email: &c.email,
                parent_count: c.parents.len(),
            };
            stats.commits_visited += 1;
            if sink.on_commit(&raw, &changes).is_break() {
                break;
            }
        }
        Ok(stats)
    }

    fn head_commit(&self) -> Result<Option<Oid>, Self::Error> {
        Ok(self.cursor)
    }

    fn head_files(&self) -> Result<Vec<HeadEntry>, Self::Error> {
        Ok(self
            .head_blobs
            .iter()
            .map(|(path, contents)| HeadEntry {
                path: path.clone(),
                blob: blob_of(contents),
                symlink: false,
            })
            .collect())
    }

    /// The scripted repository keeps one set of files at HEAD, not one per
    /// commit, so it cannot diff two of them: the caller lists HEAD instead.
    fn head_changes(&self, _since: Oid) -> Result<Option<Vec<HeadChange>>, Self::Error> {
        Ok(None)
    }

    fn read_blobs(&self, blobs: &[Oid], sink: BlobSink<'_>) -> Result<(), Self::Error> {
        for (i, id) in blobs.iter().enumerate() {
            if let Some((_, contents)) = self.head_blobs.iter().find(|(_, c)| blob_of(c) == *id) {
                self.reads
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                sink(i, contents);
            }
        }
        Ok(())
    }
}
