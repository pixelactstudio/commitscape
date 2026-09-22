//! Hand-built indexes for metric tests.
//!
//! Metrics are pure functions over an `Index`, so their tests build one
//! directly from the core types: no git, no adapter, and every commit and file
//! written out so the expected values can be worked out by hand.

#![allow(dead_code, clippy::expect_used)]

use commitscape_core::{
    Author, AuthorId, AuthorTable, ChangeKind, CommitFlags, CommitMeta, FileChange, FileClass,
    FileId, HeadFile, HistorySpan, Index, Oid, PathEvent, PathTable, RepoIdentity, Signature,
    SignatureId,
};

/// 2024-01-01T00:00:00Z.
pub const EPOCH: i64 = 1_704_067_200;
pub const DAY: i64 = 86_400;

/// One commit: its day, author email, whether it is a merge, and the paths it
/// touched.
pub struct C<'a> {
    pub day: i64,
    pub author: &'a str,
    pub merge: bool,
    pub touched: &'a [&'a str],
}

pub fn c<'a>(day: i64, author: &'a str, touched: &'a [&'a str]) -> C<'a> {
    C {
        day,
        author,
        merge: false,
        touched,
    }
}

pub fn merge<'a>(day: i64, author: &'a str, touched: &'a [&'a str]) -> C<'a> {
    C {
        day,
        author,
        merge: true,
        touched,
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

/// Builds an index. Every author email is its own person; each path is added
/// the first time a commit touches it and modified after that.
pub fn index(commits: &[C<'_>], head: &[H<'_>]) -> Index {
    let mut idx = Index::empty(RepoIdentity {
        git_dir: "/test/.git".into(),
    });
    let mut paths = PathTable::default();
    let mut path_ids = std::collections::HashMap::new();
    let mut emails: Vec<String> = Vec::new();

    let mut sorted: Vec<&C<'_>> = commits.iter().collect();
    sorted.sort_by_key(|c| c.day);
    for (n, commit) in sorted.iter().enumerate() {
        let signature = match emails.iter().position(|e| e == commit.author) {
            Some(i) => SignatureId(i as u32),
            None => {
                emails.push(commit.author.to_string());
                SignatureId(emails.len() as u32 - 1)
            }
        };
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
            idx.changes.push(FileChange {
                file: paths.record(event),
                kind,
                lines: None,
            });
        }
        let mut id = [0u8; 20];
        id[16..].copy_from_slice(&(n as u32 + 1).to_be_bytes());
        idx.commits.push(CommitMeta {
            id: Oid(id),
            time: EPOCH + commit.day * DAY,
            signature,
            flags: if commit.merge {
                CommitFlags::EMPTY.with(CommitFlags::MERGE)
            } else {
                CommitFlags::EMPTY
            },
            changes_start: start,
            changes_len: idx.changes.len() as u32 - start,
        });
    }

    let signatures: Vec<Signature> = emails
        .iter()
        .map(|e| Signature {
            name: e.clone(),
            email: e.clone(),
        })
        .collect();
    let people: Vec<Author> = emails
        .iter()
        .enumerate()
        .map(|(i, e)| Author {
            name: e.clone(),
            email: e.clone(),
            signatures: vec![SignatureId(i as u32)],
        })
        .collect();
    let n = signatures.len();
    idx.authors = AuthorTable::new(
        signatures,
        vec![1; n],
        (0..n).map(|i| AuthorId(i as u32)).collect(),
        people,
        Vec::new(),
    );

    for file in head {
        let path = path_ids
            .get(file.path)
            .copied()
            .unwrap_or_else(|| paths.push_path(file.path.as_bytes()));
        let id: FileId = paths
            .live_file(path)
            .unwrap_or_else(|| paths.record(PathEvent::Added(path)));
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
