use serde::{Deserialize, Serialize};

use crate::{AuthorId, FileId, Oid, PathId, SignatureId};

pub const SCHEMA_VERSION: u32 = 10;

pub const SUBJECT_CAP: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum ChangeKind {
    Added = 0,
    Modified = 1,
    Deleted = 2,
    Renamed = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineDelta {
    pub added: u32,
    pub removed: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FileChange {
    pub file: FileId,
    pub kind: ChangeKind,
    pub lines: Option<LineDelta>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitMeta {
    pub id: Oid,
    pub time: i64,
    pub signature: SignatureId,
    pub flags: CommitFlags,
    pub changes_start: u32,
    pub changes_len: u32,
    pub offset_minutes: i16,
    pub author_delta: i32,
    pub kind: CommitKind,
    pub subject_start: u32,
    pub subject_len: u8,
}

impl CommitMeta {
    #[inline]
    pub fn author_clock(&self) -> i64 {
        self.time + i64::from(self.author_delta) + i64::from(self.offset_minutes) * 60
    }

    #[inline]
    pub fn landed_clock(&self) -> i64 {
        self.time + i64::from(self.offset_minutes) * 60
    }

    #[inline]
    pub fn changes(&self) -> std::ops::Range<usize> {
        let start = self.changes_start as usize;
        start..start + self.changes_len as usize
    }

    pub fn subject(&self) -> std::ops::Range<usize> {
        let start = self.subject_start as usize;
        start..start + self.subject_len as usize
    }

    #[inline]
    pub fn is_merge(&self) -> bool {
        self.flags.contains(CommitFlags::MERGE)
    }
}

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
    Build,
    Chore,
    Revert,
    #[default]
    Other,
}

impl CommitKind {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitFlags(pub u8);

impl CommitFlags {
    pub const EMPTY: CommitFlags = CommitFlags(0);
    pub const MERGE: CommitFlags = CommitFlags(1 << 0);
    pub const BLAME_IGNORED: CommitFlags = CommitFlags(1 << 1);
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileClass {
    Source,
    Prose,
    Generated,
    Vendored,
    Binary,
    Symlink,
}

impl FileClass {
    #[inline]
    pub fn is_rankable(self) -> bool {
        matches!(self, FileClass::Source | FileClass::Prose)
    }

    #[inline]
    pub fn is_code(self) -> bool {
        matches!(self, FileClass::Source)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HeadFile {
    pub file: FileId,
    pub path: PathId,
    pub blob: Oid,
    pub bytes: u64,
    pub loc: u32,
    pub indent_levels: u32,
    pub indent_mean: f32,
    pub indent_stddev: f32,
    pub class: FileClass,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileHistory {
    pub first_seen: i64,
    pub last_touched: i64,
}

impl FileHistory {
    pub fn touched(self, time: i64) -> FileHistory {
        FileHistory {
            first_seen: self.first_seen.min(time),
            last_touched: self.last_touched.max(time),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Signature {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    pub name: String,
    pub email: String,
    pub signatures: Vec<SignatureId>,
    pub traits: PersonTraits,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PersonTraits(pub u8);

impl PersonTraits {
    pub const SAME_NAME: PersonTraits = PersonTraits(1 << 0);
    pub const SAME_ACCOUNT: PersonTraits = PersonTraits(1 << 1);
    pub const BOT: PersonTraits = PersonTraits(1 << 2);
    pub const KEPT_APART: PersonTraits = PersonTraits(1 << 3);

    #[inline]
    pub fn contains(self, other: PersonTraits) -> bool {
        self.0 & other.0 == other.0
    }

    #[inline]
    pub fn with(self, other: PersonTraits) -> PersonTraits {
        PersonTraits(self.0 | other.0)
    }

    pub fn merged(self) -> bool {
        self.0 & (Self::SAME_NAME.0 | Self::SAME_ACCOUNT.0) != 0
    }

    pub fn is_bot(self) -> bool {
        self.contains(Self::BOT)
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorTable {
    signature_names: Packed,
    signature_emails: Packed,
    used: Vec<u32>,
    person_of: Vec<AuthorId>,
    author_names: Packed,
    author_emails: Packed,
    members: Vec<SignatureId>,
    member_ends: Vec<u32>,
    traits: Vec<PersonTraits>,
    pub suspected_duplicates: Vec<Vec<AuthorId>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignatureRef<'a> {
    pub name: &'a str,
    pub email: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorRef<'a> {
    pub name: &'a str,
    pub email: &'a str,
    pub signatures: &'a [SignatureId],
    pub traits: PersonTraits,
}

impl AuthorTable {
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

    pub fn is_bot(&self, id: AuthorId) -> bool {
        self.traits.get(id.idx()).is_some_and(|t| t.is_bot())
    }

    pub fn used(&self) -> &[u32] {
        &self.used
    }

    pub fn person_of(&self, signature: SignatureId) -> Option<AuthorId> {
        self.person_of.get(signature.idx()).copied()
    }

    pub fn signature(&self, id: SignatureId) -> Option<SignatureRef<'_>> {
        Some(SignatureRef {
            name: self.signature_names.text(id.idx())?,
            email: self.signature_emails.text(id.idx())?,
        })
    }

    pub fn signature_count(&self) -> usize {
        self.person_of.len()
    }

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

    pub fn len(&self) -> usize {
        self.member_ends.len()
    }

    pub fn is_empty(&self) -> bool {
        self.member_ends.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (AuthorId, AuthorRef<'_>)> {
        (0..self.len()).filter_map(|i| {
            let id = AuthorId(i as u32);
            self.get(id).map(|a| (id, a))
        })
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Packed {
    #[serde(with = "serde_bytes")]
    bytes: Vec<u8>,
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

    fn text(&self, i: usize) -> Option<&str> {
        std::str::from_utf8(self.get(i)?).ok()
    }

    fn iter(&self) -> impl Iterator<Item = &[u8]> {
        (0..self.ends.len()).filter_map(|i| self.get(i))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathEvent {
    Added(PathId),
    Modified(PathId),
    Deleted(PathId),
    Renamed { from: PathId, to: PathId },
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathTable {
    names: Packed,
    live: Vec<Option<FileId>>,
    current: Vec<PathId>,
    departures: Vec<(FileId, PathId)>,
}

impl PathTable {
    pub fn push_path(&mut self, path: &[u8]) -> PathId {
        let id = PathId(self.names.push(path) as u32);
        self.live.push(None);
        id
    }

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

    pub fn get(&self, path: &[u8]) -> Option<FileId> {
        let at = self.names.iter().position(|n| n == path)?;
        self.live.get(at).copied().flatten()
    }

    pub fn path_name(&self, path: PathId) -> Option<&[u8]> {
        self.names.get(path.idx())
    }

    pub fn live_file(&self, path: PathId) -> Option<FileId> {
        self.live.get(path.idx()).copied().flatten()
    }

    pub fn path(&self, id: FileId) -> Option<&[u8]> {
        let path = self.current.get(id.idx())?;
        self.names.get(path.idx())
    }

    pub fn path_lossy(&self, id: FileId) -> String {
        self.path(id)
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default()
    }

    pub fn departures(&self) -> impl Iterator<Item = (FileId, &[u8])> {
        self.departures
            .iter()
            .filter_map(|(file, path)| Some((*file, self.names.get(path.idx())?)))
    }

    pub fn len(&self) -> usize {
        self.current.len()
    }

    pub fn is_empty(&self) -> bool {
        self.current.is_empty()
    }

    pub fn path_names(&self) -> impl Iterator<Item = (PathId, &[u8])> {
        self.names
            .iter()
            .enumerate()
            .map(|(i, p)| (PathId(i as u32), p))
    }

    pub fn iter(&self) -> impl Iterator<Item = (FileId, &[u8])> {
        self.current
            .iter()
            .enumerate()
            .filter_map(|(i, p)| self.names.get(p.idx()).map(|name| (FileId(i as u32), name)))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoIdentity {
    pub git_dir: String,
}

impl RepoIdentity {
    pub fn cache_key(&self) -> String {
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LinePass {
    pub lines: Vec<Option<LineDelta>>,
    pub ignored: Vec<Oid>,
}

impl LinePass {
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub schema_version: u32,
    pub repo: RepoIdentity,
    pub frontier: Vec<Oid>,
    pub commits: Vec<CommitMeta>,
    pub changes: Vec<FileChange>,
    pub subjects: Vec<u8>,
    pub paths: PathTable,
    pub authors: AuthorTable,
    pub head: Vec<HeadFile>,
    pub head_commit: Option<Oid>,
    pub file_history: Vec<FileHistory>,
    pub history_truncated: bool,
    pub span: HistorySpan,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistorySpan {
    pub commits: u64,
    pub merges: u64,
    pub oldest: Option<i64>,
    pub newest: Option<i64>,
}

impl HistorySpan {
    pub fn of(commits: &[CommitMeta]) -> HistorySpan {
        HistorySpan {
            commits: commits.len() as u64,
            merges: commits.iter().filter(|c| c.is_merge()).count() as u64,
            oldest: commits.iter().map(|c| c.time).min(),
            newest: commits.iter().map(|c| c.time).max(),
        }
    }

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
            subjects: Vec::new(),
            paths: PathTable::default(),
            authors: AuthorTable::default(),
            head: Vec::new(),
            head_commit: None,
            file_history: Vec::new(),
            history_truncated: false,
            span: HistorySpan::default(),
        }
    }

    pub fn subject_of(&self, c: &CommitMeta) -> &str {
        self.subjects
            .get(c.subject())
            .and_then(|b| std::str::from_utf8(b).ok())
            .unwrap_or("")
    }

    pub fn changes_of(&self, c: &CommitMeta) -> &[FileChange] {
        self.changes.get(c.changes()).unwrap_or(&[])
    }

    pub fn author_of(&self, c: &CommitMeta) -> Option<AuthorId> {
        self.authors.person_of(c.signature)
    }

    pub fn history_of(&self, file: FileId) -> Option<FileHistory> {
        self.file_history.get(file.idx()).copied()
    }

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
            t.departures().collect::<Vec<_>>(),
            vec![(moved, b"old/path.txt".as_slice())]
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
            subject_start: 0,
            subject_len: 0,
        };
        idx.commits = vec![mk(10), mk(20), mk(30)];
        assert!(idx.is_time_ordered());
        idx.commits = vec![mk(10), mk(30), mk(20)];
        assert!(!idx.is_time_ordered());
    }
}
