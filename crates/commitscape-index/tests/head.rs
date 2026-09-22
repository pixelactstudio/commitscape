//! The HEAD pass: every file at HEAD read once, measured and classified.
//!
//! Driven through the scripted adapter, which counts blob reads, so the tests
//! can check the ADR-0004 promise directly: a warm load reads no blobs, and
//! when HEAD moves only the files whose contents changed are read again.

#![allow(clippy::expect_used)]

use std::path::Path;

use commitscape_core::{FileClass, HeadFile, Index, Oid};
use commitscape_index::source::RawChangeKind::{Added, Deleted, Modified};
use commitscape_index::{load, CacheOptions, Freshness, Loaded, ScriptedRepo, Since};

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const JAN_2024: i64 = 1_704_067_200;
const DAY: i64 = 86_400;

const LIB_RS: &str = "pub fn a() {\n    if x {\n        y();\n    }\n}\n";

fn blob(n: u8) -> Oid {
    let mut b = [0u8; 20];
    b[0] = n;
    Oid(b)
}

fn load_in(repo: &ScriptedRepo, root: &Path) -> Loaded {
    let options = CacheOptions {
        root: Some(root.to_path_buf()),
    };
    match load(repo, &options, Since::All, &mut |_| {}) {
        Ok(l) => l,
        Err(never) => match never {},
    }
}

fn head_file<'a>(idx: &'a Index, path: &str) -> &'a HeadFile {
    let file = idx.paths.get(path.as_bytes()).expect("a file at that path");
    idx.head
        .iter()
        .find(|h| h.file == file)
        .expect("the file is at HEAD")
}

/// A small repository whose history introduced exactly the files at HEAD.
fn project() -> ScriptedRepo {
    ScriptedRepo::new()
        .commit(
            JAN_2024,
            ALICE,
            &[
                (b"src/lib.rs", Added, blob(1)),
                (b"pnpm-lock.yaml", Added, blob(2)),
                (b"assets/logo.png", Added, blob(3)),
                (b"src/generated/api.ts", Added, blob(4)),
                (b".gitattributes", Added, blob(5)),
            ],
        )
        .head_file(b"src/lib.rs", LIB_RS)
        .head_file(b"pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
        .head_file(b"assets/logo.png", "\u{89}PNG\r\n\u{1a}\n\u{0}\u{0}")
        .head_file(b"src/generated/api.ts", "export const a = 1;\n")
        .head_file(b".gitattributes", "src/generated/** linguist-generated\n")
}

#[test]
fn every_file_at_head_is_measured_and_classified() {
    let dir = tempfile::tempdir().expect("temp dir");
    let idx = load_in(&project(), dir.path()).index;
    assert_eq!(idx.head.len(), 5);

    let lib = head_file(&idx, "src/lib.rs");
    assert_eq!(lib.class, FileClass::Source);
    assert_eq!((lib.loc, lib.indent_levels), (5, 4));
    assert_eq!(lib.bytes, LIB_RS.len() as u64);

    assert_eq!(
        head_file(&idx, "pnpm-lock.yaml").class,
        FileClass::Generated
    );
    assert_eq!(head_file(&idx, "assets/logo.png").class, FileClass::Binary);
    assert_eq!(
        head_file(&idx, "src/generated/api.ts").class,
        FileClass::Generated,
        "declared by the repository's own .gitattributes"
    );
}

#[test]
fn a_warm_load_reads_no_blobs() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = project();
    load_in(&repo, dir.path());
    let read = repo.blobs_read();
    assert_eq!(read, 5, "the first load reads every file at HEAD once");

    let warm = load_in(&repo, dir.path());
    assert_eq!(warm.freshness, Freshness::Warm);
    assert_eq!(repo.blobs_read(), read, "nothing read again");
    assert_eq!(warm.index.head.len(), 5);
}

#[test]
fn when_head_moves_only_changed_files_are_read_again() {
    let dir = tempfile::tempdir().expect("temp dir");
    load_in(&project(), dir.path());

    let edited = "pub fn a() {\n    b();\n}\n";
    let after = project()
        .commit(JAN_2024 + DAY, ALICE, &[(b"src/lib.rs", Modified, blob(6))])
        .head_file(b"src/lib.rs", edited);
    let loaded = load_in(&after, dir.path());
    assert_eq!(loaded.freshness, Freshness::Updated { added: 1 });
    assert_eq!(
        after.blobs_read(),
        2,
        "src/lib.rs, and .gitattributes, which is always read to classify"
    );
    let lib = head_file(&loaded.index, "src/lib.rs");
    assert_eq!((lib.loc, lib.indent_levels), (3, 1));
}

#[test]
fn a_file_deleted_from_head_leaves_the_table() {
    let dir = tempfile::tempdir().expect("temp dir");
    load_in(&project(), dir.path());
    let after = project()
        .commit(
            JAN_2024 + DAY,
            ALICE,
            &[(b"assets/logo.png", Deleted, blob(3))],
        )
        .without_head_file(b"assets/logo.png");
    let loaded = load_in(&after, dir.path());
    assert_eq!(loaded.index.head.len(), 4);
    assert!(loaded.index.head.windows(2).all(|w| match w {
        [a, b] => a.file < b.file,
        _ => true,
    }));
}
