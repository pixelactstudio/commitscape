//! The index: everything extracted from a repository by one walk of its
//! history and one pass over its HEAD tree.
//!
//! The index stores **facts, never findings** (ADR-0002). Nothing derived from
//! a time window or a filter threshold lives here, which is what lets a filter
//! change recompute in milliseconds instead of invalidating the cache.

use serde::{Deserialize, Serialize};

use crate::{AuthorId, FileId, Oid, PathId, SignatureId};

/// Bumped whenever the on-disk layout changes. A mismatch triggers a full
/// reindex rather than an error. Also bumped when a stored fact is dropped,
/// so no cache keeps it: 8 dropped a commit flag. 9 records what joined each
/// person (ADR-0011).
pub const SCHEMA_VERSION: u32 = 9;

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
    /// The author's time zone as recorded on the commit, in minutes east of
    /// UTC.
    pub offset_minutes: i16,
    /// Author time minus committer time, in seconds. Zero unless the commit
    /// was rebased, amended, or applied from a patch after it was written.
    pub author_delta: i32,
    /// What the commit's message says it is.
    pub kind: CommitKind,
}

impl CommitMeta {
    /// When the author made the commit, on the author's own clock: seconds
    /// since the epoch shifted by their time zone, so that its civil date,
    /// weekday and hour are the ones the author saw.
    #[inline]
    pub fn author_clock(&self) -> i64 {
        self.time + i64::from(self.author_delta) + i64::from(self.offset_minutes) * 60
    }

    /// When the commit landed, on its author's clock: the day it counts on
    /// in a Window, which holds commits by when they landed. The same as
    /// [`author_clock`](Self::author_clock) unless the commit was rebased
    /// or amended after it was written.
    #[inline]
    pub fn landed_clock(&self) -> i64 {
        self.time + i64::from(self.offset_minutes) * 60
    }

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

/// What a commit's message says it is: the type of a conventional commit
/// subject (`feat:`, `fix(parser):`, `docs!:`), or a revert. Anything else is
/// `Other`; free prose is not guessed at.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum CommitKind {
    Feature,
    Fix,
    Docs,
    Refactor,
    Test,
    Performance,
    Style,
    /// Build system, dependencies and continuous integration.
    Build,
    Chore,
    Revert,
    #[default]
    Other,
}

impl CommitKind {
    /// Every kind, in the order the interface lists them.
    pub const EVERY: [CommitKind; 11] = [
        CommitKind::Feature,
        CommitKind::Fix,
        CommitKind::Docs,
        CommitKind::Refactor,
        CommitKind::Test,
        CommitKind::Performance,
        CommitKind::Style,
        CommitKind::Build,
        CommitKind::Chore,
        CommitKind::Revert,
        CommitKind::Other,
    ];

    pub fn label(self) -> &'static str {
        match self {
            CommitKind::Feature => "features",
            CommitKind::Fix => "fixes",
            CommitKind::Docs => "docs",
            CommitKind::Refactor => "refactors",
            CommitKind::Test => "tests",
            CommitKind::Performance => "performance",
            CommitKind::Style => "style",
            CommitKind::Build => "build and CI",
            CommitKind::Chore => "chores",
            CommitKind::Revert => "reverts",
            CommitKind::Other => "other",
        }
    }
}

/// Facts about a commit that are cheap to store as bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitFlags(pub u8);

impl CommitFlags {
    pub const EMPTY: CommitFlags = CommitFlags(0);
    /// The commit has more than one parent.
    pub const MERGE: CommitFlags = CommitFlags(1 << 0);
    /// `.git-blame-ignore-revs` names the commit, a reformat or a mass
    /// rename, so its lines are nobody's work. Set in memory by the line
    /// pass from the file at HEAD, never stored with history (ADR-0012).
    pub const BLAME_IGNORED: CommitFlags = CommitFlags(1 << 1);
    /// A Bulk Commit whose changes were narrowed, to one folder say, so it
    /// is no longer large enough to tell: it is still one. Set in memory
    /// only, never stored.
    pub const BULK: CommitFlags = CommitFlags(1 << 2);

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
    /// Code a person wrote and might be asked to look at.
    Source,
    /// Text a person wrote to be read rather than run: Markdown,
    /// reStructuredText, AsciiDoc, plain text.
    Prose,
    /// Machine-written: lockfiles, ORM snapshots, `*.gen.ts`, minified output.
    Generated,
    /// Third-party code committed into the tree.
    Vendored,
    /// Not text.
    Binary,
    /// A symbolic link: its content is a path, not code.
    Symlink,
}

impl FileClass {
    /// Whether a person wrote this file, so it may appear in a ranking of
    /// Churn, Ownership or Change Coupling. A hotspot list containing a
    /// lockfile makes the tool look broken on first run.
    #[inline]
    pub fn is_rankable(self) -> bool {
        matches!(self, FileClass::Source | FileClass::Prose)
    }

    /// Whether this file is code, so rankings by size or by the Complexity
    /// Proxy apply to it. Indentation measures nesting in code; in prose it
    /// measures bullet lists.
    #[inline]
    pub fn is_code(self) -> bool {
        matches!(self, FileClass::Source)
    }
}

/// A file as it exists at HEAD, measured once by the tree pass.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HeadFile {
    pub file: FileId,
    /// The path it was measured at. A file renamed without changing is
    /// measured again, since its class can depend on its name.
    pub path: PathId,
    /// The blob measured. When HEAD moves, a file whose blob is unchanged is
    /// not read again.
    pub blob: Oid,
    /// Size of the blob in bytes.
    pub bytes: u64,
    /// Total lines, including blank ones. Zero for binary files.
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

/// When a file was first and last touched, over all of history.
///
/// Kept per file because a warm start loads only the Window's commits, and
/// Staleness and Code Age both look past it.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileHistory {
    /// Committer time of the first commit that touched the file.
    pub first_seen: i64,
    /// Committer time of the last commit that touched it, of any kind: a
    /// Bulk Commit or a merge's resolution touched it too.
    pub last_touched: i64,
}

impl FileHistory {
    /// Folds in one more commit that touched the file.
    pub fn touched(self, time: i64) -> FileHistory {
        FileHistory {
            first_seen: self.first_seen.min(time),
            last_touched: self.last_touched.max(time),
        }
    }
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
    pub traits: PersonTraits,
}

/// What resolution found about a person, beyond their signatures
/// (ADR-0011): which evidence joined them, and whether they are a bot.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PersonTraits(pub u8);

impl PersonTraits {
    /// Signatures under different email addresses were joined because they
    /// carry the same full name.
    pub const SAME_NAME: PersonTraits = PersonTraits(1 << 0);
    /// Signatures under different email addresses were joined because
    /// GitHub links them to the same account.
    pub const SAME_ACCOUNT: PersonTraits = PersonTraits(1 << 1);
    /// An automation account, such as `dependabot[bot]`. Left out of the
    /// people rankings.
    pub const BOT: PersonTraits = PersonTraits(1 << 2);
    /// The user undid a merge of this person's signatures, which stay apart.
    pub const KEPT_APART: PersonTraits = PersonTraits(1 << 3);

    #[inline]
    pub fn contains(self, other: PersonTraits) -> bool {
        self.0 & other.0 == other.0
    }

    #[inline]
    pub fn with(self, other: PersonTraits) -> PersonTraits {
        PersonTraits(self.0 | other.0)
    }

    /// Joined by evidence weaker than the email address itself, which the
    /// user can undo.
    pub fn merged(self) -> bool {
        self.0 & (Self::SAME_NAME.0 | Self::SAME_ACCOUNT.0) != 0
    }

    pub fn is_bot(self) -> bool {
        self.contains(Self::BOT)
    }
}

/// Signatures, the people they resolve to, and the resolution between them.
///
/// Signatures are facts recorded by the walk. People are derived: the
/// resolver in the index crate applies the mailmap and ADR-0006's two rules to
/// the signature list and builds this table. Re-resolving is cheap, which is
/// why a mailmap change never needs a reindex.
///
/// Every string is packed into shared buffers. A large project has tens of
/// thousands of people and signatures, and this table is read on every warm
/// start: one allocation per string made it the slowest part of the read.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorTable {
    signature_names: Packed,
    signature_emails: Packed,
    /// Commits made under each signature over all of history, parallel to the
    /// signatures. Kept so that re-resolving never needs every commit.
    used: Vec<u32>,
    /// `SignatureId` -> `AuthorId`, parallel to the signatures.
    person_of: Vec<AuthorId>,
    author_names: Packed,
    author_emails: Packed,
    /// Each person's signatures, flattened: person `i` owns
    /// `members[member_ends[i - 1]..member_ends[i]]`.
    members: Vec<SignatureId>,
    member_ends: Vec<u32>,
    /// Parallel to the people.
    traits: Vec<PersonTraits>,
    /// Suspected-but-unmerged groups of people (ADR-0006). Surfaced to the
    /// user as a prompt to write a `.mailmap`, never merged silently.
    pub suspected_duplicates: Vec<Vec<AuthorId>>,
}

/// A signature, borrowed from an [`AuthorTable`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignatureRef<'a> {
    pub name: &'a str,
    pub email: &'a str,
}

/// A person, borrowed from an [`AuthorTable`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorRef<'a> {
    /// Canonical name, after the mailmap.
    pub name: &'a str,
    /// Canonical email, after the mailmap.
    pub email: &'a str,
    /// Every signature that resolved to this person, so the interface can
    /// show its work.
    pub signatures: &'a [SignatureId],
    pub traits: PersonTraits,
}

impl AuthorTable {
    /// Assembles a resolved table. `used` and `person_of` must be parallel
    /// to `signatures`, and every id in `person_of` must index `authors`.
    pub fn new(
        signatures: Vec<Signature>,
        used: Vec<u32>,
        person_of: Vec<AuthorId>,
        authors: Vec<Author>,
        suspected_duplicates: Vec<Vec<AuthorId>>,
    ) -> Self {
        debug_assert_eq!(signatures.len(), person_of.len());
        debug_assert_eq!(signatures.len(), used.len());
        debug_assert!(person_of.iter().all(|a| a.idx() < authors.len()));
        let mut t = AuthorTable {
            used,
            person_of,
            suspected_duplicates,
            ..AuthorTable::default()
        };
        for s in &signatures {
            t.signature_names.push(s.name.as_bytes());
            t.signature_emails.push(s.email.as_bytes());
        }
        for a in &authors {
            t.author_names.push(a.name.as_bytes());
            t.author_emails.push(a.email.as_bytes());
            t.members.extend_from_slice(&a.signatures);
            t.member_ends.push(t.members.len() as u32);
            t.traits.push(a.traits);
        }
        t
    }

    /// A person's addresses, each with the commits made under it over all
    /// of history, most first: what "merged 3 identities" lists.
    pub fn addresses_of(&self, person: AuthorId) -> Vec<(String, u32)> {
        let mut out: Vec<(String, u32)> = Vec::new();
        for s in self.get(person).map(|a| a.signatures).unwrap_or_default() {
            let (Some(sig), n) = (self.signature(*s), self.used.get(s.idx()).copied()) else {
                continue;
            };
            let n = n.unwrap_or(0);
            match out
                .iter_mut()
                .find(|(e, _)| e.eq_ignore_ascii_case(sig.email))
            {
                Some((_, total)) => *total += n,
                None => out.push((sig.email.to_string(), n)),
            }
        }
        out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        out
    }

    /// `.mailmap` lines that would join a person's addresses in every tool
    /// that reads the mailmap, under the name and address they are shown
    /// with.
    pub fn mailmap_lines(&self, person: AuthorId) -> String {
        let Some(a) = self.get(person) else {
            return String::new();
        };
        self.addresses_of(person)
            .into_iter()
            .filter(|(e, _)| !e.eq_ignore_ascii_case(a.email))
            .map(|(e, _)| format!("{} <{}> <{e}>\n", a.name, a.email))
            .collect()
    }

    /// Whether a person is an automation account. Unknown ids are not.
    pub fn is_bot(&self, id: AuthorId) -> bool {
        self.traits.get(id.idx()).is_some_and(|t| t.is_bot())
    }

    /// Commits made under each signature over all of history, by id.
    pub fn used(&self) -> &[u32] {
        &self.used
    }

    /// The person a signature resolved to.
    pub fn person_of(&self, signature: SignatureId) -> Option<AuthorId> {
        self.person_of.get(signature.idx()).copied()
    }

    pub fn signature(&self, id: SignatureId) -> Option<SignatureRef<'_>> {
        Some(SignatureRef {
            name: self.signature_names.text(id.idx())?,
            email: self.signature_emails.text(id.idx())?,
        })
    }

    /// Number of signatures.
    pub fn signature_count(&self) -> usize {
        self.person_of.len()
    }

    /// Copies out the signatures and their commit counts, for re-resolution.
    pub fn into_signatures(self) -> (Vec<Signature>, Vec<u32>) {
        let signatures = (0..self.person_of.len())
            .map(|i| Signature {
                name: self.signature_names.text(i).unwrap_or_default().to_string(),
                email: self
                    .signature_emails
                    .text(i)
                    .unwrap_or_default()
                    .to_string(),
            })
            .collect();
        (signatures, self.used)
    }

    pub fn get(&self, id: AuthorId) -> Option<AuthorRef<'_>> {
        let end = *self.member_ends.get(id.idx())? as usize;
        let start = match id.idx() {
            0 => 0,
            i => *self.member_ends.get(i - 1)? as usize,
        };
        Some(AuthorRef {
            name: self.author_names.text(id.idx())?,
            email: self.author_emails.text(id.idx())?,
            signatures: self.members.get(start..end)?,
            traits: self.traits.get(id.idx()).copied().unwrap_or_default(),
        })
    }

    /// Number of people.
    pub fn len(&self) -> usize {
        self.member_ends.len()
    }

    pub fn is_empty(&self) -> bool {
        self.member_ends.is_empty()
    }

    /// Every person, in id order.
    pub fn iter(&self) -> impl Iterator<Item = (AuthorId, AuthorRef<'_>)> {
        (0..self.len()).filter_map(|i| {
            let id = AuthorId(i as u32);
            self.get(id).map(|a| (id, a))
        })
    }
}

/// Byte strings packed end to end in one buffer: two allocations for any
/// number of strings, and a decode that is a copy.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Packed {
    #[serde(with = "serde_bytes")]
    bytes: Vec<u8>,
    /// End offset of each string in `bytes`.
    ends: Vec<u32>,
}

impl Packed {
    fn push(&mut self, s: &[u8]) -> usize {
        self.bytes.extend_from_slice(s);
        self.ends.push(self.bytes.len() as u32);
        self.ends.len() - 1
    }

    fn get(&self, i: usize) -> Option<&[u8]> {
        let end = *self.ends.get(i)? as usize;
        let start = match i {
            0 => 0,
            i => *self.ends.get(i - 1)? as usize,
        };
        self.bytes.get(start..end)
    }

    /// A string pushed as UTF-8 text.
    fn text(&self, i: usize) -> Option<&str> {
        std::str::from_utf8(self.get(i)?).ok()
    }

    fn len(&self) -> usize {
        self.ends.len()
    }

    fn iter(&self) -> impl Iterator<Item = &[u8]> {
        (0..self.ends.len()).filter_map(|i| self.get(i))
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
    names: Packed,
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
        let id = PathId(self.names.push(path) as u32);
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

    /// The string of a path id.
    pub fn path_name(&self, path: PathId) -> Option<&[u8]> {
        self.names.get(path.idx())
    }

    /// The file living at a path now.
    pub fn live_file(&self, path: PathId) -> Option<FileId> {
        self.live.get(path.idx()).copied().flatten()
    }

    /// The path a file most recently lived at.
    pub fn path(&self, id: FileId) -> Option<&[u8]> {
        let path = self.current.get(id.idx())?;
        self.names.get(path.idx())
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
            .filter_map(|(_, path)| self.names.get(path.idx()))
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
            .map(|(i, p)| (PathId(i as u32), p))
    }

    /// Every file with its current path.
    pub fn iter(&self) -> impl Iterator<Item = (FileId, &[u8])> {
        self.current
            .iter()
            .enumerate()
            .filter_map(|(i, p)| self.names.get(p.idx()).map(|name| (FileId(i as u32), name)))
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

/// What the line pass found: every change's lines, parallel to the
/// index's changes, `None` where not counted, and the commits
/// `.git-blame-ignore-revs` names.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LinePass {
    pub lines: Vec<Option<LineDelta>>,
    pub ignored: Vec<Oid>,
}

impl LinePass {
    /// Fills the index's line counts and marks the ignored commits. Does
    /// nothing to an index with a different set of changes.
    pub fn apply(self, index: &mut Index) {
        if self.lines.len() != index.changes.len() {
            return;
        }
        for (change, lines) in index.changes.iter_mut().zip(self.lines) {
            change.lines = lines;
        }
        let ignored: std::collections::HashSet<Oid> = self.ignored.into_iter().collect();
        for c in &mut index.commits {
            if ignored.contains(&c.id) {
                c.flags = c.flags.with(CommitFlags::BLAME_IGNORED);
            }
        }
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
    /// Files present at HEAD, sorted by [`FileId`]. Sized by file count, not
    /// by history length.
    pub head: Vec<HeadFile>,
    /// The commit the HEAD table describes.
    pub head_commit: Option<Oid>,
    /// First and last touch of every file, by [`FileId`], over all of history
    /// even when only part of it is loaded.
    pub file_history: Vec<FileHistory>,
    /// True when the repository is shallow. The commit count is then a floor,
    /// not a total, and the interface must say so rather than presenting a
    /// truncated number as real.
    pub history_truncated: bool,
    /// Totals over all of history, correct even when only part is loaded.
    pub span: HistorySpan,
    /// When only recent history is loaded: every commit at or after this time
    /// is present in [`commits`](Self::commits), and older ones may not be.
    /// `None` when all of history is loaded (ADR-0002's time-sliced read).
    pub loaded_from: Option<i64>,
}

/// Totals over all of history.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistorySpan {
    pub commits: u64,
    pub merges: u64,
    /// Committer time of the oldest commit.
    pub oldest: Option<i64>,
    /// Committer time of the newest commit. The anchor that `--json` resolves
    /// windows against, so its output is reproducible.
    pub newest: Option<i64>,
}

impl HistorySpan {
    /// The span of a set of commits.
    pub fn of(commits: &[CommitMeta]) -> HistorySpan {
        HistorySpan {
            commits: commits.len() as u64,
            merges: commits.iter().filter(|c| c.is_merge()).count() as u64,
            oldest: commits.iter().map(|c| c.time).min(),
            newest: commits.iter().map(|c| c.time).max(),
        }
    }

    /// The span of two sets of commits taken together.
    pub fn joined(self, other: HistorySpan) -> HistorySpan {
        let pick = |a: Option<i64>, b: Option<i64>, f: fn(i64, i64) -> i64| match (a, b) {
            (Some(a), Some(b)) => Some(f(a, b)),
            (a, b) => a.or(b),
        };
        HistorySpan {
            commits: self.commits + other.commits,
            merges: self.merges + other.merges,
            oldest: pick(self.oldest, other.oldest, i64::min),
            newest: pick(self.newest, other.newest, i64::max),
        }
    }
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
            head_commit: None,
            file_history: Vec::new(),
            history_truncated: false,
            span: HistorySpan::default(),
            loaded_from: None,
        }
    }

    /// Whether every commit at or after `time` is loaded.
    pub fn covers(&self, time: i64) -> bool {
        self.loaded_from.is_none_or(|from| from <= time)
    }

    /// Adds older history in front of what is loaded, as when the background
    /// load of a time-sliced read completes. `older` must hold every commit
    /// between `loaded_from` and the current first commit, in time order.
    pub fn prepend_history(
        &mut self,
        older_commits: Vec<CommitMeta>,
        older_changes: Vec<FileChange>,
        loaded_from: Option<i64>,
    ) {
        let shift = older_changes.len() as u32;
        for c in &mut self.commits {
            c.changes_start += shift;
        }
        let mut commits = older_commits;
        commits.append(&mut self.commits);
        let mut changes = older_changes;
        changes.append(&mut self.changes);
        self.commits = commits;
        self.changes = changes;
        self.loaded_from = loaded_from;
    }

    /// The changes belonging to one commit.
    pub fn changes_of(&self, c: &CommitMeta) -> &[FileChange] {
        self.changes.get(c.changes()).unwrap_or(&[])
    }

    /// The person who authored a commit, after identity resolution.
    pub fn author_of(&self, c: &CommitMeta) -> Option<AuthorId> {
        self.authors.person_of(c.signature)
    }

    /// When a file was first and last touched.
    pub fn history_of(&self, file: FileId) -> Option<FileHistory> {
        self.file_history.get(file.idx()).copied()
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
            offset_minutes: 0,
            author_delta: 0,
            kind: CommitKind::Other,
        };
        idx.commits = vec![mk(10), mk(20), mk(30)];
        assert!(idx.is_time_ordered());
        idx.commits = vec![mk(10), mk(30), mk(20)];
        assert!(!idx.is_time_ordered());
    }
}
