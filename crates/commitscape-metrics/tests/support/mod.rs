//! Hand-built indexes for metric tests.
//!
//! Metrics are pure functions over an `Index`, so their tests build one
//! directly from the core types: no git, no adapter, and every commit and file
//! written out so the expected values can be worked out by hand.

#![allow(dead_code, clippy::expect_used)]

use commitscape_core::{
    Author, AuthorId, AuthorTable, ChangeKind, CommitFlags, CommitKind, CommitMeta, FileChange,
    FileClass, FileHistory, FileId, HeadFile, HistorySpan, Index, Oid, PathEvent, PathTable,
    RepoIdentity, Signature, SignatureId,
};

/// 2024-01-01T00:00:00Z.
pub const EPOCH: i64 = 1_704_067_200;
pub const DAY: i64 = 86_400;

/// One commit: its day, its author as an email or as `Name <email>`, whether
/// it is a merge, and the paths it touched. By default it is made at midnight
/// UTC on its day, says nothing conventional, and no agent helped.
pub struct C<'a> {
    pub day: i64,
    pub author: &'a str,
    pub merge: bool,
    pub touched: &'a [&'a str],
    /// Seconds after midnight on the author's clock.
    pub clock: i64,
    pub offset_minutes: i16,
    pub kind: CommitKind,
    pub agent: bool,
    /// Author time minus commit time, for a commit rebased after it was
    /// written.
    pub author_delta: i32,
}

pub fn c<'a>(day: i64, author: &'a str, touched: &'a [&'a str]) -> C<'a> {
    C {
        day,
        author,
        merge: false,
        touched,
        clock: 0,
        offset_minutes: 0,
        kind: CommitKind::Other,
        agent: false,
        author_delta: 0,
    }
}

pub fn merge<'a>(day: i64, author: &'a str, touched: &'a [&'a str]) -> C<'a> {
    C {
        merge: true,
        ..c(day, author, touched)
    }
}

impl C<'_> {
    /// Made at `hour:minute` on the author's clock, in a time zone
    /// `offset_minutes` east of UTC. `day` is then the author's own date.
    pub fn local(mut self, hour: i64, minute: i64, offset_minutes: i16) -> Self {
        self.clock = hour * 3600 + minute * 60;
        self.offset_minutes = offset_minutes;
        self
    }

    pub fn kind(mut self, kind: CommitKind) -> Self {
        self.kind = kind;
        self
    }

    /// An AI coding agent co-wrote it.
    pub fn agent(mut self) -> Self {
        self.agent = true;
        self
    }

    /// Written at `hour:00` on `day` of the author's clock, and committed
    /// as `day` and `local` say: a commit rebased after it was written.
    pub fn written(mut self, day: i64, hour: i64) -> Self {
        let written = EPOCH + day * DAY + hour * 3600 - i64::from(self.offset_minutes) * 60;
        self.author_delta = (written - self.time()) as i32;
        self
    }

    /// When the commit was made, in UTC.
    fn time(&self) -> i64 {
        EPOCH + self.day * DAY + self.clock - i64::from(self.offset_minutes) * 60
    }
}

/// A file at HEAD: path, lines, indentation levels, class.
pub struct H<'a> {
    pub path: &'a str,
    pub loc: u32,
    pub indent: u32,
    pub class: FileClass,
}

pub fn h(path: &str, loc: u32, indent: u32) -> H<'_> {
    H {
        path,
        loc,
        indent,
        class: FileClass::Source,
    }
}

pub fn prose(path: &str, loc: u32, indent: u32) -> H<'_> {
    H {
        path,
        loc,
        indent,
        class: FileClass::Prose,
    }
}

pub fn generated(path: &str, loc: u32, indent: u32) -> H<'_> {
    H {
        path,
        loc,
        indent,
        class: FileClass::Generated,
    }
}

/// `Name <email>` split in two; a bare email is its own name.
fn name_and_email(author: &str) -> (String, String) {
    match author.split_once(" <") {
        Some((name, email)) => (name.to_string(), email.trim_end_matches('>').to_string()),
        None => (author.to_string(), author.to_string()),
    }
}

/// Builds an index. Every author email is its own person; each path is added
/// the first time a commit touches it and modified after that.
pub fn index(commits: &[C<'_>], head: &[H<'_>]) -> Index {
    index_with_suspects(commits, head, Vec::new())
}

/// Like [`index`], with groups of people flagged as suspected duplicates.
pub fn index_with_suspects(
    commits: &[C<'_>],
    head: &[H<'_>],
    suspected: Vec<Vec<AuthorId>>,
) -> Index {
    let mut idx = Index::empty(RepoIdentity {
        git_dir: "/test/.git".into(),
    });
    let mut paths = PathTable::default();
    let mut path_ids = std::collections::HashMap::new();
    let mut emails: Vec<String> = Vec::new();

    let mut sorted: Vec<&C<'_>> = commits.iter().collect();
    sorted.sort_by_key(|c| c.time());
    for (n, commit) in sorted.iter().enumerate() {
        let signature = match emails.iter().position(|e| e == commit.author) {
            Some(i) => SignatureId(i as u32),
            None => {
                emails.push(commit.author.to_string());
                SignatureId(emails.len() as u32 - 1)
            }
        };
        let time = commit.time();
        let start = idx.changes.len() as u32;
        for path in commit.touched {
            let (id, seen) = match path_ids.get(*path) {
                Some(&id) => (id, true),
                None => {
                    let id = paths.push_path(path.as_bytes());
                    path_ids.insert(path.to_string(), id);
                    (id, false)
                }
            };
            let (event, kind) = if seen {
                (PathEvent::Modified(id), ChangeKind::Modified)
            } else {
                (PathEvent::Added(id), ChangeKind::Added)
            };
            let file = paths.record(event);
            if idx.file_history.len() <= file.idx() {
                idx.file_history.resize(
                    file.idx() + 1,
                    FileHistory {
                        first_seen: time,
                        last_touched: time,
                    },
                );
            }
            if let Some(h) = idx.file_history.get_mut(file.idx()) {
                *h = h.touched(time);
            }
            idx.changes.push(FileChange {
                file,
                kind,
                lines: None,
            });
        }
        let mut id = [0u8; 20];
        id[16..].copy_from_slice(&(n as u32 + 1).to_be_bytes());
        idx.commits.push(CommitMeta {
            id: Oid(id),
            time,
            signature,
            flags: {
                let mut flags = CommitFlags::EMPTY;
                if commit.merge {
                    flags = flags.with(CommitFlags::MERGE);
                }
                if commit.agent {
                    flags = flags.with(CommitFlags::AGENT);
                }
                flags
            },
            changes_start: start,
            changes_len: idx.changes.len() as u32 - start,
            offset_minutes: commit.offset_minutes,
            author_delta: commit.author_delta,
            kind: commit.kind,
        });
    }

    let signatures: Vec<Signature> = emails
        .iter()
        .map(|e| {
            let (name, email) = name_and_email(e);
            Signature { name, email }
        })
        .collect();
    let people: Vec<Author> = signatures
        .iter()
        .enumerate()
        .map(|(i, s)| Author {
            name: s.name.clone(),
            email: s.email.clone(),
            signatures: vec![SignatureId(i as u32)],
        })
        .collect();
    let used: Vec<u32> = emails
        .iter()
        .map(|e| commits.iter().filter(|c| c.author == e).count() as u32)
        .collect();
    let n = signatures.len();
    idx.authors = AuthorTable::new(
        signatures,
        used,
        (0..n).map(|i| AuthorId(i as u32)).collect(),
        people,
        suspected,
    );

    for file in head {
        let path = path_ids
            .get(file.path)
            .copied()
            .unwrap_or_else(|| paths.push_path(file.path.as_bytes()));
        let id: FileId = paths
            .live_file(path)
            .unwrap_or_else(|| paths.record(PathEvent::Added(path)));
        if idx.file_history.len() <= id.idx() {
            idx.file_history
                .resize(id.idx() + 1, FileHistory::default());
        }
        idx.head.push(HeadFile {
            file: id,
            path,
            blob: Oid::ZERO,
            bytes: file.loc as u64 * 20,
            loc: file.loc,
            indent_levels: file.indent,
            indent_mean: 0.0,
            indent_stddev: 0.0,
            class: file.class,
        });
    }
    idx.head.sort_by_key(|h| h.file);
    idx.paths = paths;
    idx.span = HistorySpan::of(&idx.commits);
    idx
}
