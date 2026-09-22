//! An in-memory [`RepoSource`] built by hand.
//!
//! This is the second adapter that makes the seam in ADR-0001 real rather than
//! hypothetical. It lets the whole index layer be tested with no temp
//! directories, no `git` subprocess, and no fixture repository to keep in sync —
//! and it means a test can construct a history that would be awkward to produce
//! with real git at all.

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
    parent_count: usize,
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
    head_blobs: Vec<(Vec<u8>, Vec<u8>)>,
    mailmap: Mailmap,
    truncated: bool,
    next_oid: u32,
}

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

    /// Adds a commit. `changes` are `(path, kind, blob)` triples.
    pub fn commit(
        mut self,
        time: i64,
        author: (&str, &str),
        changes: &[(&[u8], RawChangeKind, Oid)],
    ) -> Self {
        self.next_oid += 1;
        let id = synthetic_oid(self.next_oid);
        let parent_count = usize::from(!self.commits.is_empty());
        self.commits.push(ScriptedCommit {
            id,
            time,
            name: author.0.as_bytes().to_vec(),
            email: author.1.as_bytes().to_vec(),
            parent_count,
            changes: changes
                .iter()
                .map(|(p, k, b)| ScriptedChange {
                    path: p.to_vec(),
                    kind: *k,
                    blob: *b,
                })
                .collect(),
        });
        self
    }

    /// Adds a commit with more than one parent, so it is flagged as a merge.
    pub fn merge_commit(
        mut self,
        time: i64,
        author: (&str, &str),
        changes: &[(&[u8], RawChangeKind, Oid)],
    ) -> Self {
        self = self.commit(time, author, changes);
        if let Some(last) = self.commits.last_mut() {
            last.parent_count = 2;
        }
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
            root_commit: self.commits.first().map(|c| c.id),
        })
    }

    fn tips(&self) -> Result<Vec<Oid>, Self::Error> {
        Ok(self.commits.last().map(|c| c.id).into_iter().collect())
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
        let seen: &HashSet<Oid> = stop_at;

        for c in self.commits.iter().rev() {
            if seen.contains(&c.id) {
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
                parent_count: c.parent_count,
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
