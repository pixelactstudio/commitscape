//! The index layer driven through the scripted adapter: histories written by
//! hand, no git involved. Expected values are worked out from the scripts.

#![allow(clippy::expect_used)]

use std::collections::{HashMap, HashSet};

use commitscape_core::{FileId, Index, Oid};
use commitscape_index::source::RawChangeKind::{Added, Deleted, Modified};
use commitscape_index::{
    index_from_scratch, index_incremental, reresolve_authors, Mailmap, ScriptedRepo,
};

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const ALICE_WORK: (&str, &str) = ("A. Example", "alice@work.example.org");
const BOB: (&str, &str) = ("Bob Example", "bob@example.com");

fn blob(n: u8) -> Oid {
    let mut b = [0u8; 20];
    b[0] = n;
    Oid(b)
}

fn index(repo: &ScriptedRepo) -> Index {
    match index_from_scratch(repo) {
        Ok(i) => i,
        Err(never) => match never {},
    }
}

/// Commits touching each file, keyed by the file's current path.
fn churn(idx: &Index) -> HashMap<String, u32> {
    let mut counts: HashMap<FileId, u32> = HashMap::new();
    for c in &idx.commits {
        for ch in idx.changes_of(c) {
            *counts.entry(ch.file).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .map(|(f, n)| (idx.paths.path_lossy(f), n))
        .collect()
}

#[test]
fn a_new_file_created_where_a_file_was_renamed_away_from_is_a_different_file() {
    // lib.rs is moved to lib_old.rs unchanged, then a new lib.rs is written.
    // Both exist at HEAD, and each must keep only its own history.
    let repo = ScriptedRepo::new()
        .commit(0, ALICE, &[(b"lib.rs", Added, blob(1))])
        .commit(1, ALICE, &[(b"lib.rs", Modified, blob(2))])
        .commit(
            2,
            ALICE,
            &[
                (b"lib.rs", Deleted, blob(2)),
                (b"lib_old.rs", Added, blob(2)),
            ],
        )
        .commit(3, ALICE, &[(b"lib.rs", Added, blob(3))])
        .commit(
            4,
            ALICE,
            &[
                (b"lib.rs", Modified, blob(4)),
                (b"lib_old.rs", Modified, blob(5)),
            ],
        );
    let idx = index(&repo);

    let old = idx.paths.get(b"lib_old.rs").expect("the moved file");
    let fresh = idx.paths.get(b"lib.rs").expect("the new file");
    assert_ne!(old, fresh);

    let churn = churn(&idx);
    assert_eq!(
        churn.get("lib_old.rs"),
        Some(&4),
        "created, edited, moved, edited"
    );
    assert_eq!(churn.get("lib.rs"), Some(&2), "created, edited");
}

#[test]
fn identity_follows_time_even_when_the_walk_does_not() {
    // The rename happens between the two edits in time. The scripted walk,
    // like a real one, reports newest first, so identity must be resolved
    // after sorting.
    let repo = ScriptedRepo::new()
        .commit(10, ALICE, &[(b"a.txt", Added, blob(1))])
        .commit(
            20,
            ALICE,
            &[(b"a.txt", Deleted, blob(1)), (b"b.txt", Added, blob(1))],
        )
        .commit(30, ALICE, &[(b"b.txt", Modified, blob(2))]);
    let idx = index(&repo);
    assert_eq!(idx.paths.len(), 1, "one file, three commits");
    assert_eq!(churn(&idx).get("b.txt"), Some(&3));
}

/// main: 1 (day 0), 2 (day 1); side from 2: 3 (day 2), 4 (day 3);
/// main again: 5 (day 4), 6 (day 5); merge of 6 and 4: 7 (day 6).
fn branched() -> ScriptedRepo {
    ScriptedRepo::new()
        .commit(0, ALICE, &[(b"main.txt", Added, blob(1))])
        .commit(1, ALICE, &[(b"main.txt", Modified, blob(2))])
        .commit(2, BOB, &[(b"side.txt", Added, blob(3))])
        .commit(3, BOB, &[(b"side.txt", Modified, blob(4))])
        .at(2)
        .commit(4, ALICE, &[(b"main.txt", Modified, blob(5))])
        .commit(5, ALICE, &[(b"main.txt", Modified, blob(6))])
        .merge(6, ALICE, 4, &[])
}

#[test]
fn resuming_walks_only_what_is_not_indexed() {
    let repo = branched();
    // The last index saw main up to commit 6 and never saw the side branch,
    // so it holds commits 1, 2, 5 and 6.
    let indexed: HashSet<Oid> = [1, 2, 5, 6].map(|n| repo.commit_id(n)).into();
    let resumed = match index_incremental(&repo, &indexed) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let mut times: Vec<i64> = resumed.commits.iter().map(|c| c.time).collect();
    times.sort_unstable();
    assert_eq!(
        times,
        vec![2, 3, 6],
        "the side commits are older than the frontier tip and must still be found"
    );
}

#[test]
fn a_fully_indexed_history_leaves_nothing_to_walk() {
    let repo = branched();
    let indexed: HashSet<Oid> = (1..=7).map(|n| repo.commit_id(n)).collect();
    let resumed = match index_incremental(&repo, &indexed) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    assert!(resumed.commits.is_empty());
}

#[test]
fn a_mailmap_can_be_applied_to_an_existing_index_without_rewalking() {
    let repo = ScriptedRepo::new()
        .commit(0, ALICE, &[(b"a.txt", Added, blob(1))])
        .commit(1, ALICE_WORK, &[(b"a.txt", Modified, blob(2))])
        .commit(2, BOB, &[(b"a.txt", Modified, blob(3))]);
    let mut idx = index(&repo);
    assert_eq!(idx.authors.len(), 3, "no mailmap: three people");

    let mailmap = Mailmap::parse(b"Alice Example <alice@example.com> <alice@work.example.org>\n");
    reresolve_authors(&mut idx, &mailmap);
    assert_eq!(idx.authors.len(), 2, "the mailmap joins Alice's two forms");

    let first = idx.commits.first().and_then(|c| idx.author_of(c));
    let second = idx.commits.get(1).and_then(|c| idx.author_of(c));
    assert!(first.is_some() && first == second);
}
