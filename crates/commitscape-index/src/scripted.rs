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
use std::ops::ControlFlow;

use commitscape_core::{Oid, RepoIdentity};

use crate::mailmap::Mailmap;
use crate::source::{
    CommitSink, Frontier, RawChange, RawChangeKind, RawCommit, RepoSource, TreeSink, WalkStats,
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
    head_blobs: Vec<(Vec<u8>, Vec<u8>)>,
    mailmap: Mailmap,
    truncated: bool,
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

    /// Sets the contents of a file at HEAD, for the tree pass.
    pub fn head_file(mut self, path: &[u8], contents: &str) -> Self {
        self.head_blobs
            .push((path.to_vec(), contents.as_bytes().to_vec()));
        self
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

    fn mailmap(&self) -> Result<Mailmap, Self::Error> {
        Ok(self.mailmap.clone())
    }

    fn walk_history(
        &self,
        stop_at: &Frontier,
        sink: &mut dyn CommitSink,
    ) -> Result<WalkStats, Self::Error> {
        let mut stats = WalkStats {
            history_truncated: self.truncated,
            ..WalkStats::default()
        };
        let hidden = self.reachable(stop_at.iter().copied());
        let wanted = self.reachable(self.tips()?);

        for c in self.commits.iter().rev() {
            if !wanted.contains(&c.id) {
                continue;
            }
            if hidden.contains(&c.id) {
                stats.commits_skipped += 1;
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

    fn walk_head_tree(&self, sink: &mut dyn TreeSink) -> Result<(), Self::Error> {
        for (path, contents) in &self.head_blobs {
            if let ControlFlow::Break(()) = sink.on_blob(path, contents) {
                break;
            }
        }
        Ok(())
    }
}
