//! The line pass (ADR-0012) through the scripted adapter: counts line up
//! with the changes the index records, are kept, and are not counted twice.

#![allow(clippy::expect_used)]

use commitscape_core::{LineDelta, Oid};
use commitscape_index::source::RawChangeKind::{Added, Deleted, Modified};
use commitscape_index::{index_from_scratch, line_pass, CacheOptions, LineStore, ScriptedRepo};

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const DAY: i64 = 86_400;

fn blob(n: u8) -> Oid {
    Oid([n; 20])
}

fn d(added: u32, removed: u32) -> Option<LineDelta> {
    Some(LineDelta { added, removed })
}

/// Day 0: a.rs "1 2 3". Day 1: a.rs "1 two 3 4" (+2 -1) and b.rs added,
/// with no contents known (not counted). Day 2: a.rs moved to c.rs
/// unchanged (0 and 0) and b.rs deleted (not counted either).
fn repo() -> ScriptedRepo {
    ScriptedRepo::new()
        .commit(0, ALICE, &[(b"a.rs", Added, blob(1))])
        .commit(
            DAY,
            ALICE,
            &[(b"a.rs", Modified, blob(2)), (b"b.rs", Added, blob(3))],
        )
        .commit(
            2 * DAY,
            ALICE,
            &[
                (b"a.rs", Deleted, blob(2)),
                (b"c.rs", Added, blob(2)),
                (b"b.rs", Deleted, blob(3)),
            ],
        )
        .blob(blob(1), "1\n2\n3\n")
        .blob(blob(2), "1\ntwo\n3\n4\n")
}

#[test]
fn counts_line_up_with_the_changes_and_are_counted_once() {
    let repo = repo();
    let idx = index_from_scratch(&repo).expect("indexing");
    let dir = tempfile::tempdir().expect("temp dir");
    let store = LineStore::for_repo(
        &CacheOptions {
            root: Some(dir.path().to_path_buf()),
        },
        &idx.repo,
    )
    .expect("a store");

    let mut asked = Vec::new();
    let first = line_pass(&repo, &idx, Some(&store), &mut |done, total| {
        asked.push((done, total))
    })
    .expect("counting");
    let by_commit: Vec<Vec<Option<LineDelta>>> = idx
        .commits
        .iter()
        .map(|c| {
            let start = c.changes_start as usize;
            first
                .lines
                .get(start..start + c.changes_len as usize)
                .expect("in range")
                .to_vec()
        })
        .collect();
    // The move is one Renamed change, first; the deletion of b.rs second.
    assert_eq!(
        by_commit,
        vec![vec![d(3, 0)], vec![d(2, 1), None], vec![d(0, 0), None]]
    );
    assert_eq!(asked.last(), Some(&(3, 3)));

    let mut again = Vec::new();
    let second = line_pass(&repo, &idx, Some(&store), &mut |done, total| {
        again.push((done, total))
    })
    .expect("counting");
    assert_eq!(again, vec![(0, 0)], "everything was kept");
    assert_eq!(second, first);
}

#[test]
fn a_store_cut_short_keeps_what_it_had() {
    let repo = repo();
    let idx = index_from_scratch(&repo).expect("indexing");
    let dir = tempfile::tempdir().expect("temp dir");
    let options = CacheOptions {
        root: Some(dir.path().to_path_buf()),
    };
    let store = LineStore::for_repo(&options, &idx.repo).expect("a store");
    let first = line_pass(&repo, &idx, Some(&store), &mut |_, _| {}).expect("counting");

    // A crash in the middle of the last record.
    let file = dir.path().join(idx.repo.cache_key()).join("lines");
    let bytes = std::fs::read(&file).expect("the store was written");
    let cut = bytes.get(..bytes.len() - 3).expect("a record");
    std::fs::write(&file, cut).expect("cutting it short");

    let mut asked = Vec::new();
    let resumed = line_pass(&repo, &idx, Some(&store), &mut |done, total| {
        asked.push((done, total))
    })
    .expect("counting");
    assert_eq!(asked.last(), Some(&(1, 1)), "only the commit cut short");
    assert_eq!(resumed, first);
}
