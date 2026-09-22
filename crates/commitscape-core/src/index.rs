//! The index: everything extracted from a repository by one walk of its
//! history and one pass over its HEAD tree.
//!
//! The index stores **facts, never findings** (ADR-0002). Nothing derived from
//! a time window or a filter threshold lives here, which is what lets a filter
//! change recompute in milliseconds instead of invalidating the cache.

use serde::{Deserialize, Serialize};

use crate::{AuthorId, FileId, Oid, PathId, SignatureId};

/// Bumped whenever the on-disk layout changes. A mismatch triggers a full
/// reindex rather than an error.
pub const SCHEMA_VERSION: u32 = 2;

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
///
/// The same reasoning keeps the resolved person out. A commit stores the
/// signature it was made under; which person that signature belongs to is a
/// resolution applied on top, so a `.mailmap` edit never invalidates history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitMeta {
    pub id: Oid,
    /// Committer time, seconds since the Unix epoch. Committer rather than
    /// author time because it is monotonic with respect to history being
    /// written, which is what the ordering invariant needs.
    pub time: i64,
    /// The author's name and email exactly as committed.
    pub signature: SignatureId,
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

/// One name-and-email pair exactly as it appears in commits.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Signature {
    pub name: String,
    pub email: String,
}

/// A person, after their several signatures have been resolved together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    /// Canonical name, after the mailmap.
    pub name: String,
    /// Canonical email, after the mailmap.
    pub email: String,
    /// Every signature that resolved to this person, so the interface can
    /// show its work.
    pub signatures: Vec<SignatureId>,
}

/// Signatures, the people they resolve to, and the resolution between them.
///
/// Signatures are facts recorded by the walk. People are derived: the
/// resolver in the index crate applies the mailmap and ADR-0006's two rules to
/// the signature list and builds this table. Re-resolving is cheap, which is
/// why a mailmap change never needs a reindex.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorTable {
    signatures: Vec<Signature>,
    /// `SignatureId` -> `AuthorId`, parallel to `signatures`.
    person_of: Vec<AuthorId>,
    authors: Vec<Author>,
    /// Suspected-but-unmerged groups of people (ADR-0006). Surfaced to the
    /// user as a prompt to write a `.mailmap`, never merged silently.
    pub suspected_duplicates: Vec<Vec<AuthorId>>,
}

impl AuthorTable {
    /// Assembles a resolved table. `person_of` must be parallel to
    /// `signatures`, and every id in it must index `authors`.
    pub fn new(
        signatures: Vec<Signature>,
        person_of: Vec<AuthorId>,
        authors: Vec<Author>,
        suspected_duplicates: Vec<Vec<AuthorId>>,
    ) -> Self {
        debug_assert_eq!(signatures.len(), person_of.len());
        debug_assert!(person_of.iter().all(|a| a.idx() < authors.len()));
        AuthorTable {
            signatures,
            person_of,
            authors,
            suspected_duplicates,
        }
    }

    /// The person a signature resolved to.
    pub fn person_of(&self, signature: SignatureId) -> Option<AuthorId> {
        self.person_of.get(signature.idx()).copied()
    }

    pub fn signature(&self, id: SignatureId) -> Option<&Signature> {
        self.signatures.get(id.idx())
    }

    /// Every signature, in id order.
    pub fn signatures(&self) -> &[Signature] {
        &self.signatures
    }

    /// Gives up the signature list, for re-resolution after it has grown.
    pub fn into_signatures(self) -> Vec<Signature> {
        self.signatures
    }

    pub fn get(&self, id: AuthorId) -> Option<&Author> {
        self.authors.get(id.idx())
    }

    /// Number of people.
    pub fn len(&self) -> usize {
        self.authors.len()
    }

    pub fn is_empty(&self) -> bool {
        self.authors.is_empty()
    }

    /// Every person, in id order.
    pub fn iter(&self) -> impl Iterator<Item = (AuthorId, &Author)> {
        self.authors
            .iter()
            .enumerate()
            .map(|(i, a)| (AuthorId(i as u32), a))
    }
}

/// How one commit touched one path, as fed to [`PathTable::record`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathEvent {
    Added(PathId),
    Modified(PathId),
    Deleted(PathId),
    /// An exact rename: same content, new path (ADR-0004).
    Renamed {
        from: PathId,
        to: PathId,
    },
}

/// Paths, files, and which file lives at which path.
///
/// A path is a string git recorded; a file is an identity that can move
/// between paths through exact renames (ADR-0004). The table is built by
/// feeding it every change **oldest first**, which is what lets identity
/// follow time:
///
/// - Adding, modifying or deleting a path touches the file living there, or
///   creates one if none does. A deleted file keeps its path, so a file
///   deleted and later re-added at the same path is the same file.
/// - An exact rename moves the file to the new path and frees the old one. A
///   new file created later at the old path is a *different* file. Without
///   this, `mv lib.rs lib_old.rs` followed by a fresh `lib.rs` would fuse two
///   files that both exist at HEAD.
///
/// Git paths are bytes, not UTF-8. Storing them as `Vec<u8>` avoids silently
/// mangling a repository that contains a non-UTF-8 filename.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathTable {
    /// Every distinct path ever touched, by `PathId`.
    names: Vec<Vec<u8>>,
    /// `PathId` -> the file living at that path now, if any.
    live: Vec<Option<FileId>>,
    /// `FileId` -> the path that file most recently lived at.
    current: Vec<PathId>,
    /// Every rename, oldest first, as (file, path it left).
    departures: Vec<(FileId, PathId)>,
}

impl PathTable {
    /// Adds a path string and returns its id. Paths are not deduplicated
    /// here: the builder keeps the reverse map, because a warm start never
    /// needs one and should not pay to rebuild it.
    pub fn push_path(&mut self, path: &[u8]) -> PathId {
        let id = PathId(self.names.len() as u32);
        self.names.push(path.to_vec());
        self.live.push(None);
        id
    }

    /// Applies one change and returns the file it touched. Must be called in
    /// ascending time order; see the type-level documentation for the rules.
    pub fn record(&mut self, event: PathEvent) -> FileId {
        match event {
            PathEvent::Added(p) | PathEvent::Modified(p) | PathEvent::Deleted(p) => {
                let file = self.live_or_new(p);
                self.set_current(file, p);
                file
            }
            PathEvent::Renamed { from, to } => {
                let file = self.live_or_new(from);
                if let Some(slot) = self.live.get_mut(from.idx()) {
                    *slot = None;
                }
                if let Some(slot) = self.live.get_mut(to.idx()) {
                    *slot = Some(file);
                }
                self.set_current(file, to);
                self.departures.push((file, from));
                file
            }
        }
    }

    fn live_or_new(&mut self, path: PathId) -> FileId {
        if let Some(Some(file)) = self.live.get(path.idx()) {
            return *file;
        }
        let file = FileId(self.current.len() as u32);
        self.current.push(path);
        if let Some(slot) = self.live.get_mut(path.idx()) {
            *slot = Some(file);
        }
        file
    }

    fn set_current(&mut self, file: FileId, path: PathId) {
        if let Some(slot) = self.current.get_mut(file.idx()) {
            *slot = path;
        }
    }

    /// The file living at `path` now. A linear scan over every path ever
    /// seen: for tests and occasional interactive lookups, not hot loops.
    pub fn get(&self, path: &[u8]) -> Option<FileId> {
        let at = self.names.iter().position(|n| n == path)?;
        self.live.get(at).copied().flatten()
    }

    /// The file living at a path now.
    pub fn live_file(&self, path: PathId) -> Option<FileId> {
        self.live.get(path.idx()).copied().flatten()
    }

    /// The path a file most recently lived at.
    pub fn path(&self, id: FileId) -> Option<&[u8]> {
        let path = self.current.get(id.idx())?;
        self.names.get(path.idx()).map(|v| v.as_slice())
    }

    /// The current path as text, replacing invalid UTF-8 rather than failing.
    /// For display only; never for matching.
    pub fn path_lossy(&self, id: FileId) -> String {
        self.path(id)
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default()
    }

    /// Paths this file lived at before exact renames moved it, oldest first.
    pub fn former_paths(&self, id: FileId) -> impl Iterator<Item = &[u8]> {
        self.departures
            .iter()
            .filter(move |(file, _)| *file == id)
            .filter_map(|(_, path)| self.names.get(path.idx()).map(|v| v.as_slice()))
    }

    /// Number of files.
    pub fn len(&self) -> usize {
        self.current.len()
    }

    pub fn is_empty(&self) -> bool {
        self.current.is_empty()
    }

    /// Number of distinct path strings ever seen.
    pub fn path_count(&self) -> usize {
        self.names.len()
    }

    /// Every path string ever seen, by id.
    pub fn path_names(&self) -> impl Iterator<Item = (PathId, &[u8])> {
        self.names
            .iter()
            .enumerate()
            .map(|(i, p)| (PathId(i as u32), p.as_slice()))
    }

    /// Every file with its current path.
    pub fn iter(&self) -> impl Iterator<Item = (FileId, &[u8])> {
        self.current.iter().enumerate().filter_map(|(i, p)| {
            self.names
                .get(p.idx())
                .map(|name| (FileId(i as u32), name.as_slice()))
        })
    }
}

/// Identifies a repository for cache-keying purposes.
///
/// The path alone, deliberately. Finding anything that identifies the
/// *project*, such as its root commit, means walking history, and this is
/// computed on every warm start. A different project cloned to the same path
/// is still caught: none of the cached frontier commits exist in it, so the
/// cache cannot be resumed and is rebuilt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoIdentity {
    /// Canonical path of the repository's git directory.
    pub git_dir: String,
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

    /// The person who authored a commit, after identity resolution.
    pub fn author_of(&self, c: &CommitMeta) -> Option<AuthorId> {
        self.authors.person_of(c.signature)
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
    fn a_rename_moves_the_file_and_frees_the_old_path() {
        let mut t = PathTable::default();
        let old = t.push_path(b"old/path.txt");
        let new = t.push_path(b"new/path.txt");

        let created = t.record(PathEvent::Added(old));
        let moved = t.record(PathEvent::Renamed { from: old, to: new });
        assert_eq!(created, moved, "a rename keeps the file's identity");
        assert_eq!(t.path(moved), Some(b"new/path.txt".as_slice()));
        assert_eq!(t.get(b"new/path.txt"), Some(moved));
        assert_eq!(t.get(b"old/path.txt"), None, "nothing lives there now");
        assert_eq!(
            t.former_paths(moved).collect::<Vec<_>>(),
            vec![b"old/path.txt".as_slice()]
        );
        assert_eq!(t.len(), 1);
    }

    #[test]
    fn a_new_file_at_a_vacated_path_is_a_different_file() {
        let mut t = PathTable::default();
        let a = t.push_path(b"lib.rs");
        let b = t.push_path(b"lib_old.rs");
        let original = t.record(PathEvent::Added(a));
        t.record(PathEvent::Renamed { from: a, to: b });
        let fresh = t.record(PathEvent::Added(a));
        assert_ne!(original, fresh);
        assert_eq!(t.get(b"lib_old.rs"), Some(original));
        assert_eq!(t.get(b"lib.rs"), Some(fresh));
    }

    #[test]
    fn a_file_deleted_and_re_added_at_the_same_path_is_the_same_file() {
        let mut t = PathTable::default();
        let p = t.push_path(b"a.txt");
        let first = t.record(PathEvent::Added(p));
        t.record(PathEvent::Deleted(p));
        assert_eq!(t.record(PathEvent::Added(p)), first);
    }

    #[test]
    fn non_utf8_paths_survive() {
        let mut t = PathTable::default();
        let weird: &[u8] = &[b'a', 0xff, 0xfe, b'.', b'r', b's'];
        let p = t.push_path(weird);
        let id = t.record(PathEvent::Added(p));
        assert_eq!(t.path(id), Some(weird));
        assert!(t.path_lossy(id).contains('\u{fffd}'));
    }

    #[test]
    fn cache_key_is_stable_and_distinguishes_repos() {
        let a = RepoIdentity {
            git_dir: "/home/x/proj/.git".into(),
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
        });
        let mk = |time| CommitMeta {
            id: Oid::ZERO,
            time,
            signature: SignatureId(0),
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
