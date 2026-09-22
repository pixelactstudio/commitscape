//! Assembles an [`Index`] from whatever a [`RepoSource`] pushes at it.
//!
//! Two things happen here that deliberately do *not* happen in the adapters, so
//! that they are written once and tested once: exact-rename pairing, and the
//! sort that establishes the ascending-time invariant.

use std::collections::HashMap;
use std::ops::ControlFlow;

use commitscape_core::{
    ChangeKind, CommitFlags, CommitMeta, FileChange, Index, Oid, PathTable, RepoIdentity,
};

use crate::identity::IdentityResolver;
use crate::mailmap::Mailmap;
use crate::source::{CommitSink, RawChange, RawChangeKind, RawCommit};

/// Accumulates commits pushed by a walk, newest first.
pub struct IndexBuilder {
    identity: IdentityResolver,
    paths: PathTable,
    commits: Vec<CommitMeta>,
    changes: Vec<FileChange>,
    progress: Option<Box<dyn FnMut(u64) + Send>>,
}

impl IndexBuilder {
    pub fn new(mailmap: Mailmap) -> Self {
        IndexBuilder {
            identity: IdentityResolver::new(mailmap),
            paths: PathTable::default(),
            commits: Vec::new(),
            changes: Vec::new(),
            progress: None,
        }
    }

    /// Installs a progress callback, invoked with the running commit count.
    pub fn on_progress(mut self, f: impl FnMut(u64) + Send + 'static) -> Self {
        self.progress = Some(Box::new(f));
        self
    }

    pub fn commit_count(&self) -> usize {
        self.commits.len()
    }

    /// Sorts into ascending commit time and rebuilds the change arena so each
    /// commit's slice sits in time order too.
    ///
    /// The walk produces commits newest-first, and a merge can introduce
    /// commits older than ones already seen, so the input is not sorted in any
    /// useful sense. ADR-0002 makes ascending time an invariant because it is
    /// what turns a time window into a contiguous range.
    pub fn finish(
        mut self,
        repo: RepoIdentity,
        frontier: Vec<Oid>,
        history_truncated: bool,
    ) -> Index {
        self.commits.sort_by_key(|c| (c.time, c.id.0));

        let mut arena = Vec::with_capacity(self.changes.len());
        for commit in &mut self.commits {
            let start = arena.len() as u32;
            let slice = self.changes.get(commit.changes()).unwrap_or(&[]);
            arena.extend_from_slice(slice);
            commit.changes_start = start;
        }

        Index {
            schema_version: commitscape_core::SCHEMA_VERSION,
            repo,
            frontier,
            commits: self.commits,
            changes: arena,
            paths: self.paths,
            authors: self.identity.finish(),
            head: Vec::new(),
            history_truncated,
        }
    }
}

impl CommitSink for IndexBuilder {
    fn on_commit(&mut self, commit: &RawCommit<'_>, changes: &[RawChange<'_>]) -> ControlFlow<()> {
        let author = self
            .identity
            .resolve(commit.author_name, commit.author_email);
        let start = self.changes.len() as u32;

        for resolved in pair_exact_renames(changes) {
            let (file, kind) = match resolved {
                Resolved::Rename { from, to } => {
                    (self.paths.record_rename(from, to), ChangeKind::Renamed)
                }
                Resolved::Plain { path, kind } => (self.paths.intern(path), kind),
            };
            self.changes.push(FileChange {
                file,
                kind,
                // Always None in v0.1: the walk never reads blob contents, and
                // line counts require exactly that (ADR-0004).
                lines: None,
            });
        }

        let flags = if commit.parent_count > 1 {
            CommitFlags::EMPTY.with(CommitFlags::MERGE)
        } else {
            CommitFlags::EMPTY
        };

        self.commits.push(CommitMeta {
            id: commit.id,
            time: commit.time,
            author,
            flags,
            changes_start: start,
            changes_len: self.changes.len() as u32 - start,
        });

        if let Some(p) = self.progress.as_mut() {
            p(self.commits.len() as u64);
        }
        ControlFlow::Continue(())
    }
}

enum Resolved<'a> {
    Rename { from: &'a [u8], to: &'a [u8] },
    Plain { path: &'a [u8], kind: ChangeKind },
}

/// Turns `Added`/`Deleted` pairs that share a blob id into renames.
///
/// This is the whole of ADR-0004's rename support. A rename with identical
/// content produces a deletion at the old path and an addition at the new one,
/// both naming the same blob — so detecting it is an id comparison and never
/// touches file contents. A file that moved *and* changed has two different
/// blob ids and is correctly left as a separate delete and add.
///
/// `gix`'s own rewrite tracker would do this too, but it lives behind
/// `gix-diff`'s `blob` feature, which we do not enable precisely because
/// ADR-0004 forbids blob access in the walk.
fn pair_exact_renames<'a>(changes: &[RawChange<'a>]) -> Vec<Resolved<'a>> {
    let mut deletions_by_blob: HashMap<Oid, Vec<usize>> = HashMap::new();
    for (i, c) in changes.iter().enumerate() {
        if c.kind == RawChangeKind::Deleted {
            deletions_by_blob.entry(c.blob).or_default().push(i);
        }
    }

    let mut consumed = vec![false; changes.len()];
    let mut out = Vec::with_capacity(changes.len());

    for (i, c) in changes.iter().enumerate() {
        if c.kind != RawChangeKind::Added {
            continue;
        }
        // A blob of all zeroes is not a real object; never pair on it.
        if c.blob == Oid::ZERO {
            continue;
        }
        let Some(candidates) = deletions_by_blob.get_mut(&c.blob) else {
            continue;
        };
        let Some(pos) = candidates.pop() else {
            continue;
        };
        let Some(deleted) = changes.get(pos) else {
            continue;
        };
        if let Some(flag) = consumed.get_mut(i) {
            *flag = true;
        }
        if let Some(flag) = consumed.get_mut(pos) {
            *flag = true;
        }
        out.push(Resolved::Rename {
            from: deleted.path,
            to: c.path,
        });
    }

    for (i, c) in changes.iter().enumerate() {
        if consumed.get(i).copied().unwrap_or(false) {
            continue;
        }
        out.push(Resolved::Plain {
            path: c.path,
            kind: match c.kind {
                RawChangeKind::Added => ChangeKind::Added,
                RawChangeKind::Modified => ChangeKind::Modified,
                RawChangeKind::Deleted => ChangeKind::Deleted,
            },
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(n: u8) -> Oid {
        let mut b = [0u8; 20];
        b[0] = n;
        Oid(b)
    }

    fn raw(path: &[u8], kind: RawChangeKind, blob: Oid) -> RawChange<'_> {
        RawChange { path, kind, blob }
    }

    #[test]
    fn a_deletion_and_addition_sharing_a_blob_is_a_rename() {
        let changes = [
            raw(b"old/path.txt", RawChangeKind::Deleted, oid(7)),
            raw(b"new/path.txt", RawChangeKind::Added, oid(7)),
        ];
        let resolved = pair_exact_renames(&changes);
        match resolved.as_slice() {
            [Resolved::Rename { from, to }] => {
                assert_eq!(*from, b"old/path.txt");
                assert_eq!(*to, b"new/path.txt");
            }
            other => panic!("expected exactly one rename, got {} entries", other.len()),
        }
    }

    #[test]
    fn a_move_with_an_edit_is_not_a_rename() {
        // Different blob ids: this is the move-plus-edit case ADR-0004 says we
        // deliberately do not detect, because doing so needs content similarity.
        let changes = [
            raw(b"old/path.txt", RawChangeKind::Deleted, oid(7)),
            raw(b"new/path.txt", RawChangeKind::Added, oid(8)),
        ];
        let resolved = pair_exact_renames(&changes);
        assert_eq!(resolved.len(), 2);
        assert!(resolved.iter().all(|r| matches!(r, Resolved::Plain { .. })));
    }

    #[test]
    fn an_unrelated_deletion_and_addition_stay_separate() {
        let changes = [
            raw(b"gone.txt", RawChangeKind::Deleted, oid(1)),
            raw(b"fresh.txt", RawChangeKind::Added, oid(2)),
            raw(b"edited.txt", RawChangeKind::Modified, oid(3)),
        ];
        let resolved = pair_exact_renames(&changes);
        assert_eq!(resolved.len(), 3);
    }

    #[test]
    fn two_simultaneous_renames_pair_independently() {
        let changes = [
            raw(b"a/one.txt", RawChangeKind::Deleted, oid(1)),
            raw(b"a/two.txt", RawChangeKind::Deleted, oid(2)),
            raw(b"b/one.txt", RawChangeKind::Added, oid(1)),
            raw(b"b/two.txt", RawChangeKind::Added, oid(2)),
        ];
        let resolved = pair_exact_renames(&changes);
        assert_eq!(resolved.len(), 2);
        assert!(resolved
            .iter()
            .all(|r| matches!(r, Resolved::Rename { .. })));
    }

    #[test]
    fn a_file_copied_to_two_places_pairs_only_once() {
        // One deletion cannot satisfy two additions. The second addition is a
        // genuine addition, not a second rename of the same file.
        let changes = [
            raw(b"src.txt", RawChangeKind::Deleted, oid(5)),
            raw(b"copy-a.txt", RawChangeKind::Added, oid(5)),
            raw(b"copy-b.txt", RawChangeKind::Added, oid(5)),
        ];
        let resolved = pair_exact_renames(&changes);
        let renames = resolved
            .iter()
            .filter(|r| matches!(r, Resolved::Rename { .. }))
            .count();
        let plain = resolved
            .iter()
            .filter(|r| matches!(r, Resolved::Plain { .. }))
            .count();
        assert_eq!(renames, 1);
        assert_eq!(plain, 1);
    }
}
