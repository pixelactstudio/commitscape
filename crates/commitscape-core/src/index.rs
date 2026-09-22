//! The index: everything extracted from a repository by one walk of its
//! history and one pass over its HEAD tree.
//!
//! The index stores **facts, never findings** (ADR-0002). Nothing derived from
//! a time window or a filter threshold lives here, which is what lets a filter
//! change recompute in milliseconds instead of invalidating the cache.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{AuthorId, FileId, Oid};

/// Bumped whenever the on-disk layout changes. A mismatch triggers a full
/// reindex rather than an error.
pub const SCHEMA_VERSION: u32 = 1;

/// How a commit touched a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum ChangeKind {
    Added = 0,
    Modified = 1,
    Deleted = 2,
    /// The file arrived at its current path from another path in this commit,
    /// with byte-identical content. Only exact renames are detected (ADR-0004).
    Renamed = 3,
}

/// Lines added and removed by one commit to one file.
///
/// **Always `None` in v0.1.** ADR-0004 forbids the walk from reading blob
/// contents, and line counts require exactly that. The field exists so that
/// adding `--numstat` collection later is a population rather than a schema
/// migration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineDelta {
    pub added: u32,
    pub removed: u32,
}

/// One file touched by one commit.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FileChange {
    pub file: FileId,
    pub kind: ChangeKind,
    pub lines: Option<LineDelta>,
}

/// Facts about a commit itself.
///
/// Note what is *absent*: any notion of "bulk". A commit touching 200 files is
/// a fact; calling it bulk is a threshold applied to that fact, and thresholds
/// are a metrics-layer concern. Storing it here would make
/// `--max-changeset-size` a cache-invalidating option (ADR-0002).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitMeta {
    pub id: Oid,
    /// Committer time, seconds since the Unix epoch. Committer rather than
    /// author time because it is monotonic with respect to history being
    /// written, which is what the ordering invariant needs.
    pub time: i64,
    pub author: AuthorId,
    pub flags: CommitFlags,
    /// Start of this commit's slice of [`Index::changes`].
    pub changes_start: u32,
    /// Length of that slice.
    pub changes_len: u32,
}

impl CommitMeta {
    /// This commit's slice of the change arena.
    #[inline]
    pub fn changes(&self) -> std::ops::Range<usize> {
        let start = self.changes_start as usize;
        start..start + self.changes_len as usize
    }

    #[inline]
    pub fn is_merge(&self) -> bool {
        self.flags.contains(CommitFlags::MERGE)
    }
}

/// Facts about a commit that are cheap to store as bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitFlags(pub u8);

impl CommitFlags {
    pub const EMPTY: CommitFlags = CommitFlags(0);
    /// The commit has more than one parent.
    pub const MERGE: CommitFlags = CommitFlags(1 << 0);

    #[inline]
    pub fn contains(self, other: CommitFlags) -> bool {
        self.0 & other.0 == other.0
    }

    #[inline]
    pub fn with(self, other: CommitFlags) -> CommitFlags {
        CommitFlags(self.0 | other.0)
    }
}

/// What a file at HEAD appears to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileClass {
    /// Something a person wrote and might be asked to look at.
    Source,
    /// Machine-written: lockfiles, ORM snapshots, `*.gen.ts`, minified output.
    Generated,
    /// Third-party code committed into the tree.
    Vendored,
    /// Not text.
    Binary,
}

impl FileClass {
    /// Whether this file may appear in a ranking. Only [`Source`](Self::Source)
    /// may — a hotspot list containing a lockfile makes the tool look stupid on
    /// first run.
    #[inline]
    pub fn is_rankable(self) -> bool {
        matches!(self, FileClass::Source)
    }
}

/// A file as it exists at HEAD, measured once by the tree pass.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HeadFile {
    pub file: FileId,
    /// Total lines, including blank ones.
    pub loc: u32,
    /// Sum of indentation *levels* across all lines — not whitespace
    /// characters. A tab-indented file and a two-space file with identical
    /// structure must score identically, or hotspot ranking in a polyglot
    /// repository partly ranks indentation conventions.
    ///
    /// Deliberately **not** divided by `loc`: a large tangled file is a bigger
    /// problem than a small one, and normalising by line count discards exactly
    /// that signal.
    pub indent_levels: u32,
    /// Mean indentation level per non-blank line.
    pub indent_mean: f32,
    /// Standard deviation of indentation level. Dispersion is what correlates
    /// with complexity; it is surfaced in the drill-down.
    pub indent_stddev: f32,
    pub class: FileClass,
}

/// A person, after their several git identities have been resolved together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    pub name: String,
    pub email: String,
    /// Every raw `(name, email)` pair that resolved to this person, so the
    /// interface can show its work.
    pub variants: Vec<(String, String)>,
}

/// `AuthorId` -> [`Author`].
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorTable {
    authors: Vec<Author>,
    /// Suspected-but-unmerged identity groups (ADR-0006). Surfaced to the user
    /// as a prompt to write a `.mailmap`, never merged silently.
    pub suspected_duplicates: Vec<Vec<AuthorId>>,
}

impl AuthorTable {
    pub fn push(&mut self, author: Author) -> AuthorId {
        let id = AuthorId(self.authors.len() as u32);
        self.authors.push(author);
        id
    }

    pub fn get(&self, id: AuthorId) -> Option<&Author> {
        self.authors.get(id.idx())
    }

    pub fn len(&self) -> usize {
        self.authors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.authors.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (AuthorId, &Author)> {
        self.authors
            .iter()
            .enumerate()
            .map(|(i, a)| (AuthorId(i as u32), a))
    }
}

/// `FileId` -> current path, plus every historical path that resolves to it.
///
/// Git paths are bytes, not UTF-8. Storing them as `Vec<u8>` avoids silently
/// mangling a repository that contains a non-UTF-8 filename.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathTable {
    /// Current path of each file.
    paths: Vec<Vec<u8>>,
    /// Every path ever seen, including pre-rename ones, mapped to its file.
    lookup: HashMap<Vec<u8>, FileId>,
}

impl PathTable {
    /// Returns the id for `path`, allocating one if this path is new.
    pub fn intern(&mut self, path: &[u8]) -> FileId {
        if let Some(&id) = self.lookup.get(path) {
            return id;
        }
        let id = FileId(self.paths.len() as u32);
        self.paths.push(path.to_vec());
        self.lookup.insert(path.to_vec(), id);
        id
    }

    /// Records that `from` became `to` in an exact rename.
    ///
    /// The file keeps its id; `to` becomes its current path and both paths
    /// continue to resolve to it. History walks run newest-first, so `to` is
    /// usually already interned and `from` is the one being attached.
    pub fn record_rename(&mut self, from: &[u8], to: &[u8]) -> FileId {
        let id = self.intern(to);
        self.lookup.insert(from.to_vec(), id);
        id
    }

    pub fn path(&self, id: FileId) -> Option<&[u8]> {
        self.paths.get(id.idx()).map(|v| v.as_slice())
    }

    /// The current path as text, replacing invalid UTF-8 rather than failing.
    /// For display only; never for matching.
    pub fn path_lossy(&self, id: FileId) -> String {
        self.path(id)
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default()
    }

    pub fn get(&self, path: &[u8]) -> Option<FileId> {
        self.lookup.get(path).copied()
    }

    pub fn len(&self) -> usize {
        self.paths.len()
    }

    pub fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (FileId, &[u8])> {
        self.paths
            .iter()
            .enumerate()
            .map(|(i, p)| (FileId(i as u32), p.as_slice()))
    }
}

/// Identifies a repository for cache-keying purposes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoIdentity {
    /// Canonical path of the repository's git directory.
    pub git_dir: String,
    /// The oldest root commit reachable at index time. Together with the path
    /// this distinguishes two checkouts of different projects at the same path.
    pub root_commit: Option<Oid>,
}

impl RepoIdentity {
    /// Stable cache directory name: a hash of the identity, so that a path
    /// containing awkward characters cannot produce an awkward directory.
    pub fn cache_key(&self) -> String {
        // FNV-1a, 64-bit. Not cryptographic — this only has to avoid collisions
        // between repositories on one machine.
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        let mut feed = |bytes: &[u8]| {
            for b in bytes {
                hash ^= *b as u64;
                hash = hash.wrapping_mul(0x1000_0000_01b3);
            }
        };
        feed(self.git_dir.as_bytes());
        if let Some(root) = self.root_commit {
            feed(&root.0);
        }
        format!("{hash:016x}")
    }
}

/// Everything one walk of history and one pass over HEAD produced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub schema_version: u32,
    pub repo: RepoIdentity,
    /// Commit ids bounding what has been indexed. Resuming from this **set** is
    /// what makes incremental indexing correct across merges; a single
    /// last-indexed sha silently drops a merged branch's history (ADR-0002).
    pub frontier: Vec<Oid>,
    /// Ascending by [`CommitMeta::time`]. This invariant is load-bearing: it is
    /// what makes a time window a contiguous range.
    pub commits: Vec<CommitMeta>,
    /// Flat arena of every change by every commit. Each commit owns a
    /// contiguous slice. One allocation rather than one per commit.
    pub changes: Vec<FileChange>,
    pub paths: PathTable,
    pub authors: AuthorTable,
    /// Files present at HEAD. Sized by file count, not by history length.
    pub head: Vec<HeadFile>,
    /// True when the repository is shallow. The commit count is then a floor,
    /// not a total, and the interface must say so rather than presenting a
    /// truncated number as real.
    pub history_truncated: bool,
}

impl Index {
    pub fn empty(repo: RepoIdentity) -> Self {
        Index {
            schema_version: SCHEMA_VERSION,
            repo,
            frontier: Vec::new(),
            commits: Vec::new(),
            changes: Vec::new(),
            paths: PathTable::default(),
            authors: AuthorTable::default(),
            head: Vec::new(),
            history_truncated: false,
        }
    }

    /// The changes belonging to one commit.
    pub fn changes_of(&self, c: &CommitMeta) -> &[FileChange] {
        self.changes.get(c.changes()).unwrap_or(&[])
    }

    /// Committer time of the newest commit, if any. This is the anchor `--json`
    /// and `--budget` resolve windows against, so their output is reproducible.
    pub fn newest_commit_time(&self) -> Option<i64> {
        self.commits.last().map(|c| c.time)
    }

    pub fn oldest_commit_time(&self) -> Option<i64> {
        self.commits.first().map(|c| c.time)
    }

    /// Asserts the ascending-time invariant. Cheap enough to run in tests and
    /// after every incremental merge.
    pub fn is_time_ordered(&self) -> bool {
        self.commits.windows(2).all(|w| match w {
            [a, b] => a.time <= b.time,
            _ => true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_flags_compose_and_test() {
        let f = CommitFlags::EMPTY.with(CommitFlags::MERGE);
        assert!(f.contains(CommitFlags::MERGE));
        assert!(!CommitFlags::EMPTY.contains(CommitFlags::MERGE));
    }

    #[test]
    fn rename_keeps_one_identity_and_both_paths_resolve() {
        // This is the core of ADR-0004's rename decision: after a move, the old
        // path and the new path are the same file, and the current path is new.
        let mut t = PathTable::default();
        let original = t.intern(b"old/path.txt");
        let after = t.record_rename(b"old/path.txt", b"new/path.txt");

        assert_eq!(
            t.get(b"old/path.txt".as_slice()),
            t.get(b"new/path.txt".as_slice())
        );
        assert_eq!(t.path(after), Some(b"new/path.txt".as_slice()));
        // The pre-rename intern allocated id 0; the rename must not allocate a
        // second identity for the same file.
        assert_eq!(original, FileId(0));
        assert_eq!(t.len(), 2, "old and new were interned as separate entries");
    }

    #[test]
    fn non_utf8_paths_survive() {
        let mut t = PathTable::default();
        let weird: &[u8] = &[b'a', 0xff, 0xfe, b'.', b'r', b's'];
        let id = t.intern(weird);
        assert_eq!(t.path(id), Some(weird));
        assert!(t.path_lossy(id).contains('\u{fffd}'));
    }

    #[test]
    fn cache_key_is_stable_and_distinguishes_repos() {
        let a = RepoIdentity {
            git_dir: "/home/x/proj/.git".into(),
            root_commit: Oid::from_hex("adcc5f3bdc1a3c205141996ba01404b6e4b27310"),
        };
        let mut b = a.clone();
        b.git_dir = "/home/x/other/.git".into();
        assert_eq!(a.cache_key(), a.cache_key());
        assert_ne!(a.cache_key(), b.cache_key());
        assert_eq!(a.cache_key().len(), 16);
    }

    #[test]
    fn time_ordering_invariant_detects_violation() {
        let mut idx = Index::empty(RepoIdentity {
            git_dir: "/tmp/x".into(),
            root_commit: None,
        });
        let mk = |time| CommitMeta {
            id: Oid::ZERO,
            time,
            author: AuthorId(0),
            flags: CommitFlags::EMPTY,
            changes_start: 0,
            changes_len: 0,
        };
        idx.commits = vec![mk(10), mk(20), mk(30)];
        assert!(idx.is_time_ordered());
        idx.commits = vec![mk(10), mk(30), mk(20)];
        assert!(!idx.is_time_ordered());
    }
}
