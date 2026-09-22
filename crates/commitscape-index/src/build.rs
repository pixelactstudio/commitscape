//! Assembles an [`Index`] from whatever a [`crate::RepoSource`] pushes at it.
//!
//! Three things happen here that deliberately do *not* happen in the adapters,
//! so that they are written once and tested once: exact-rename pairing, the
//! sort that establishes the ascending-time invariant, and file identity.
//!
//! Identity is resolved after the sort, oldest commit first, because it
//! depends on order: a rename moves a file and frees its old path, and a file
//! created at that path afterwards is a different file. The walk does not
//! produce commits in time order, so nothing order-dependent happens while it
//! runs. It only interns paths and signatures to small ids.

use std::collections::HashMap;
use std::ops::ControlFlow;

use commitscape_core::{
    ChangeKind, CommitFlags, CommitMeta, FileChange, Index, Oid, PathEvent, PathId, PathTable,
    RepoIdentity, Signature, SignatureId,
};

use crate::identity::resolve_authors;
use crate::mailmap::Mailmap;
use crate::source::{CommitSink, RawChange, RawChangeKind, RawCommit};

/// One change as the walk saw it, before identity resolution.
#[derive(Debug, Clone, Copy)]
struct PendingChange {
    path: PathId,
    kind: ChangeKind,
    /// For a rename, the path it left. Equal to `path` otherwise.
    from: PathId,
}

/// A commit as the walk saw it. `changes` indexes `IndexBuilder::pending`.
#[derive(Debug, Clone, Copy)]
struct PendingCommit {
    id: Oid,
    time: i64,
    signature: SignatureId,
    flags: CommitFlags,
    changes_start: u32,
    changes_len: u32,
}

/// Accumulates commits pushed by a walk, in whatever order it produces them.
pub struct IndexBuilder {
    mailmap: Mailmap,
    paths: PathTable,
    path_ids: HashMap<Vec<u8>, PathId>,
    signatures: Vec<Signature>,
    signature_ids: HashMap<(Vec<u8>, Vec<u8>), SignatureId>,
    commits: Vec<PendingCommit>,
    pending: Vec<PendingChange>,
    progress: Option<Box<dyn FnMut(u64, u64) + Send>>,
}

impl IndexBuilder {
    pub fn new(mailmap: Mailmap) -> Self {
        IndexBuilder {
            mailmap,
            paths: PathTable::default(),
            path_ids: HashMap::new(),
            signatures: Vec::new(),
            signature_ids: HashMap::new(),
            commits: Vec::new(),
            pending: Vec::new(),
            progress: None,
        }
    }

    /// Installs a progress callback, invoked with (done, total) commits.
    pub fn on_progress(mut self, f: impl FnMut(u64, u64) + Send + 'static) -> Self {
        self.progress = Some(Box::new(f));
        self
    }

    pub fn commit_count(&self) -> usize {
        self.commits.len()
    }

    fn path_id(&mut self, path: &[u8]) -> PathId {
        if let Some(&id) = self.path_ids.get(path) {
            return id;
        }
        let id = self.paths.push_path(path);
        self.path_ids.insert(path.to_vec(), id);
        id
    }

    fn signature_id(&mut self, name: &[u8], email: &[u8]) -> SignatureId {
        let key = (name.to_vec(), email.to_vec());
        if let Some(&id) = self.signature_ids.get(&key) {
            return id;
        }
        let id = SignatureId(self.signatures.len() as u32);
        self.signatures.push(Signature {
            name: String::from_utf8_lossy(name).into_owned(),
            email: String::from_utf8_lossy(email).into_owned(),
        });
        self.signature_ids.insert(key, id);
        id
    }

    /// Sorts into ascending commit time, resolves file identity oldest first,
    /// and resolves signatures to people.
    ///
    /// ADR-0002 makes ascending time an invariant because it is what turns a
    /// time window into a contiguous range. Ties are broken by commit id so
    /// the order, and every id derived from it, is deterministic.
    pub fn finish(
        mut self,
        repo: RepoIdentity,
        frontier: Vec<Oid>,
        history_truncated: bool,
    ) -> Index {
        self.commits.sort_by_key(|c| (c.time, c.id.0));

        let mut changes = Vec::with_capacity(self.pending.len());
        let mut commits = Vec::with_capacity(self.commits.len());
        let mut used = vec![0u32; self.signatures.len()];

        for c in &self.commits {
            let start = changes.len() as u32;
            let range = c.changes_start as usize..(c.changes_start + c.changes_len) as usize;
            for p in self.pending.get(range).unwrap_or(&[]) {
                let event = match p.kind {
                    ChangeKind::Added => PathEvent::Added(p.path),
                    ChangeKind::Modified => PathEvent::Modified(p.path),
                    ChangeKind::Deleted => PathEvent::Deleted(p.path),
                    ChangeKind::Renamed => PathEvent::Renamed {
                        from: p.from,
                        to: p.path,
                    },
                };
                changes.push(FileChange {
                    file: self.paths.record(event),
                    kind: p.kind,
                    // Always None in v0.1: the walk never reads blob contents,
                    // and line counts require exactly that (ADR-0004).
                    lines: None,
                });
            }
            if let Some(n) = used.get_mut(c.signature.idx()) {
                *n += 1;
            }
            commits.push(CommitMeta {
                id: c.id,
                time: c.time,
                signature: c.signature,
                flags: c.flags,
                changes_start: start,
                changes_len: changes.len() as u32 - start,
            });
        }

        Index {
            schema_version: commitscape_core::SCHEMA_VERSION,
            repo,
            frontier,
            commits,
            changes,
            paths: self.paths,
            authors: resolve_authors(self.signatures, &used, &self.mailmap),
            head: Vec::new(),
            history_truncated,
        }
    }
}

impl CommitSink for IndexBuilder {
    fn on_commit(&mut self, commit: &RawCommit<'_>, changes: &[RawChange<'_>]) -> ControlFlow<()> {
        let signature = self.signature_id(commit.author_name, commit.author_email);
        let start = self.pending.len() as u32;

        for resolved in pair_exact_renames(changes) {
            let change = match resolved {
                Resolved::Rename { from, to } => PendingChange {
                    path: self.path_id(to),
                    kind: ChangeKind::Renamed,
                    from: self.path_id(from),
                },
                Resolved::Plain { path, kind } => {
                    let path = self.path_id(path);
                    PendingChange {
                        path,
                        kind,
                        from: path,
                    }
                }
            };
            self.pending.push(change);
        }

        let flags = if commit.parent_count > 1 {
            CommitFlags::EMPTY.with(CommitFlags::MERGE)
        } else {
            CommitFlags::EMPTY
        };

        self.commits.push(PendingCommit {
            id: commit.id,
            time: commit.time,
            signature,
            flags,
            changes_start: start,
            changes_len: self.pending.len() as u32 - start,
        });
        ControlFlow::Continue(())
    }

    fn on_progress(&mut self, done: u64, total: u64) {
        if let Some(p) = self.progress.as_mut() {
            p(done, total);
        }
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
