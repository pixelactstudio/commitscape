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
    ChangeKind, CommitFlags, CommitKind, CommitMeta, FileChange, FileHistory, HistorySpan, Index,
    Oid, PathEvent, PathId, PathTable, RepoIdentity, Signature, SignatureId,
};

use crate::hash_index::HashIndex;
use crate::identity::resolve_authors;
use crate::identity::IdentityRules;
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
    offset_minutes: i16,
    author_delta: i32,
    kind: CommitKind,
    /// Where its subject line is in the builder's own arena.
    subject_start: u32,
    subject_len: u8,
}

fn signature_hash(name: &[u8], email: &[u8]) -> u64 {
    let mut h = xxhash_rust::xxh3::Xxh3::new();
    h.update(&(name.len() as u64).to_le_bytes());
    h.update(name);
    h.update(email);
    h.digest()
}

/// Accumulates commits pushed by a walk, in whatever order it produces them.
pub struct IndexBuilder {
    rules: IdentityRules,
    paths: PathTable,
    path_ids: HashIndex,
    signatures: Vec<Signature>,
    /// Commits per signature, including any already in `base`.
    used: Vec<u32>,
    signature_ids: HashIndex,
    commits: Vec<PendingCommit>,
    pending: Vec<PendingChange>,
    /// Every added commit's subject line, one after another.
    subjects: Vec<u8>,
    /// The index being extended, with its path and author tables moved out
    /// into the fields above.
    base: Option<Index>,
}

impl IndexBuilder {
    pub fn new(rules: IdentityRules) -> Self {
        IndexBuilder {
            rules,
            paths: PathTable::default(),
            path_ids: HashIndex::default(),
            signatures: Vec::new(),
            used: Vec::new(),
            signature_ids: HashIndex::default(),
            commits: Vec::new(),
            pending: Vec::new(),
            subjects: Vec::new(),
            base: None,
        }
    }

    /// Continues an existing index. New commits resolve against its paths and
    /// signatures, and [`finish`](Self::finish) merges them into its history.
    ///
    /// `index` may hold only recent history. It must hold every commit at or
    /// after the oldest commit the walk will add, or the merge cannot place
    /// them; the cache arranges that before resuming.
    ///
    /// New commits are resolved after every commit already indexed, even one
    /// dated older (a long-lived branch merged late). A full reindex would
    /// interleave them by date instead. The two can differ only when such a
    /// commit renames a path that newer history also touched.
    pub fn resume(mut index: Index, rules: IdentityRules) -> Self {
        let paths = std::mem::take(&mut index.paths);
        let mut path_ids = HashIndex::default();
        for (id, name) in paths.path_names() {
            path_ids.insert(xxhash_rust::xxh3::xxh3_64(name), id.0);
        }
        let (signatures, used) = std::mem::take(&mut index.authors).into_signatures();
        let mut signature_ids = HashIndex::default();
        for (i, s) in signatures.iter().enumerate() {
            signature_ids.insert(
                signature_hash(s.name.as_bytes(), s.email.as_bytes()),
                i as u32,
            );
        }
        IndexBuilder {
            rules,
            paths,
            path_ids,
            signatures,
            used,
            signature_ids,
            commits: Vec::new(),
            pending: Vec::new(),
            subjects: Vec::new(),
            base: Some(index),
        }
    }

    /// Commits added so far.
    pub fn commit_count(&self) -> usize {
        self.commits.len()
    }

    /// The ids of the commits added so far.
    pub fn added_ids(&self) -> Vec<Oid> {
        self.commits.iter().map(|c| c.id).collect()
    }

    /// The time of the oldest commit added so far.
    pub fn oldest_pending_time(&self) -> Option<i64> {
        self.commits.iter().map(|c| c.time).min()
    }

    /// Extends the resumed index further back, so that it covers the oldest
    /// commit being added. `commits` and `changes` are the history just
    /// before what is loaded; `loaded_from` is the new start of coverage.
    pub fn prepend_base(
        &mut self,
        commits: Vec<CommitMeta>,
        changes: Vec<FileChange>,
        subjects: Vec<u8>,
        loaded_from: Option<i64>,
    ) {
        if let Some(base) = self.base.as_mut() {
            base.prepend_history(commits, changes, subjects, loaded_from);
        }
    }

    fn path_id(&mut self, path: &[u8]) -> PathId {
        let hash = xxhash_rust::xxh3::xxh3_64(path);
        let paths = &self.paths;
        if let Some(id) = self
            .path_ids
            .get(hash, |id| paths.path_name(PathId(id)) == Some(path))
        {
            return PathId(id);
        }
        let id = self.paths.push_path(path);
        self.path_ids.insert(hash, id.0);
        id
    }

    fn signature_id(&mut self, name: &[u8], email: &[u8]) -> SignatureId {
        // Signatures are stored as text, so compare in the form they were
        // stored in; a name that is not UTF-8 is stored lossily either way.
        let name = String::from_utf8_lossy(name);
        let email = String::from_utf8_lossy(email);
        let hash = signature_hash(name.as_bytes(), email.as_bytes());
        let signatures = &self.signatures;
        if let Some(id) = self.signature_ids.get(hash, |id| {
            signatures
                .get(id as usize)
                .is_some_and(|s| s.name == name && s.email == email)
        }) {
            return SignatureId(id);
        }
        let id = SignatureId(self.signatures.len() as u32);
        self.signatures.push(Signature {
            name: name.into_owned(),
            email: email.into_owned(),
        });
        self.used.push(0);
        self.signature_ids.insert(hash, id.0);
        id
    }

    /// Sorts into ascending commit time, resolves file identity oldest first,
    /// resolves signatures to people, and merges with the resumed index if
    /// there is one.
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
        let mut subjects = Vec::with_capacity(self.subjects.len());
        let mut history: Vec<FileHistory> = self
            .base
            .as_mut()
            .map(|b| std::mem::take(&mut b.file_history))
            .unwrap_or_default();

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
                let file = self.paths.record(event);
                match history.get_mut(file.idx()) {
                    Some(h) => *h = h.touched(c.time),
                    None => {
                        // Identities are dense and appear in order, so a new
                        // one is always the next slot.
                        history.resize(
                            file.idx(),
                            FileHistory {
                                first_seen: c.time,
                                last_touched: c.time,
                            },
                        );
                        history.push(FileHistory {
                            first_seen: c.time,
                            last_touched: c.time,
                        });
                    }
                }
                changes.push(FileChange {
                    file,
                    kind: p.kind,
                    // Always None in v0.1: the walk never reads blob contents,
                    // and line counts require exactly that (ADR-0004).
                    lines: None,
                });
            }
            if let Some(n) = self.used.get_mut(c.signature.idx()) {
                *n += 1;
            }
            let subject_start = subjects.len() as u32;
            let from = c.subject_start as usize;
            subjects.extend_from_slice(
                self.subjects
                    .get(from..from + c.subject_len as usize)
                    .unwrap_or(&[]),
            );
            commits.push(CommitMeta {
                id: c.id,
                time: c.time,
                signature: c.signature,
                flags: c.flags,
                changes_start: start,
                changes_len: changes.len() as u32 - start,
                offset_minutes: c.offset_minutes,
                author_delta: c.author_delta,
                kind: c.kind,
                subject_start,
                subject_len: c.subject_len,
            });
        }

        let added = HistorySpan::of(&commits);
        let mut index = match self.base.take() {
            Some(mut base) => {
                merge_history(&mut base, commits, changes, subjects);
                base.span = base.span.joined(added);
                base.history_truncated = history_truncated;
                base
            }
            None => {
                let mut fresh = Index::empty(repo.clone());
                fresh.commits = commits;
                fresh.changes = changes;
                fresh.subjects = subjects;
                fresh.span = added;
                fresh.history_truncated = history_truncated;
                fresh
            }
        };
        index.file_history = history;
        index.repo = repo;
        index.frontier = frontier;
        index.schema_version = commitscape_core::SCHEMA_VERSION;
        index.paths = self.paths;
        index.authors = resolve_authors(self.signatures, self.used, &self.rules);
        index
    }
}

/// Merges time-sorted new commits into an index's time-sorted history.
///
/// New commits are almost always newer than everything indexed, and are
/// appended. A long-lived branch merged late can bring older ones, and then
/// only the tail from the oldest of them onward is re-sorted.
fn merge_history(
    index: &mut Index,
    new_commits: Vec<CommitMeta>,
    new_changes: Vec<FileChange>,
    new_subjects: Vec<u8>,
) {
    let Some(first_new) = new_commits.first().copied() else {
        return;
    };
    let key = |c: &CommitMeta| (c.time, c.id.0);
    let split = index.commits.partition_point(|c| key(c) <= key(&first_new));

    let tail: Vec<CommitMeta> = index.commits.split_off(split);
    let arena_split = tail
        .first()
        .map(|c| c.changes_start as usize)
        .unwrap_or(index.changes.len());
    let old_changes = index.changes.split_off(arena_split);
    let subject_split = tail
        .first()
        .map(|c| c.subject_start as usize)
        .unwrap_or(index.subjects.len());
    let old_subjects = index.subjects.split_off(subject_split);

    // Two sorted runs, merged; each commit's changes are copied from the
    // arena it came from.
    let mut a = tail.into_iter().peekable();
    let mut b = new_commits.into_iter().peekable();
    loop {
        let from_old = match (a.peek(), b.peek()) {
            (Some(x), Some(y)) => key(x) <= key(y),
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => break,
        };
        let (commit, arena, base, texts, text_base) = if from_old {
            (
                a.next(),
                &old_changes,
                arena_split,
                &old_subjects,
                subject_split,
            )
        } else {
            (b.next(), &new_changes, 0, &new_subjects, 0)
        };
        let Some(mut commit) = commit else {
            break;
        };
        let start = commit.changes_start as usize - base;
        let slice = arena
            .get(start..start + commit.changes_len as usize)
            .unwrap_or(&[]);
        commit.changes_start = index.changes.len() as u32;
        index.changes.extend_from_slice(slice);
        let from = commit.subject_start as usize - text_base;
        let text = texts
            .get(from..from + commit.subject_len as usize)
            .unwrap_or(&[]);
        commit.subject_start = index.subjects.len() as u32;
        index.subjects.extend_from_slice(text);
        index.commits.push(commit);
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
                Resolved::Plain { path, kind, .. } => {
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

        let mut flags = CommitFlags::EMPTY;
        if commit.parent_count > 1 {
            flags = flags.with(CommitFlags::MERGE);
        }

        self.commits.push(PendingCommit {
            id: commit.id,
            time: commit.time,
            signature,
            flags,
            changes_start: start,
            changes_len: self.pending.len() as u32 - start,
            offset_minutes: (commit.author_offset / 60)
                .clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16,
            author_delta: (commit.author_time - commit.time)
                .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
            kind: commit.kind,
            subject_start: self.subjects.len() as u32,
            subject_len: commit.subject.len().min(commitscape_core::SUBJECT_CAP) as u8,
        });
        self.subjects.extend_from_slice(
            commit
                .subject
                .as_bytes()
                .get(..commit.subject.len().min(commitscape_core::SUBJECT_CAP))
                .unwrap_or(&[]),
        );
        ControlFlow::Continue(())
    }
}

pub(crate) enum Resolved<'a> {
    Rename {
        from: &'a [u8],
        to: &'a [u8],
    },
    /// `raw` is the change's place in the list it was resolved from.
    Plain {
        path: &'a [u8],
        kind: ChangeKind,
        raw: usize,
    },
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
pub(crate) fn pair_exact_renames<'a>(changes: &[RawChange<'a>]) -> Vec<Resolved<'a>> {
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
            raw: i,
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
