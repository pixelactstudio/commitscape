//! The real `gix` adapter, run against the fixture repositories.
//!
//! Expected values come from `docs/fixtures.md`, worked out by hand from the
//! shape of each history. Nothing here recomputes an expectation the way the
//! implementation does.

// `allow-expect-in-tests` in clippy.toml only covers `#[test]` functions, not
// the shared helpers below. This whole file is test code, so the working
// agreement's "outside tests" exemption applies to all of it.
#![allow(clippy::expect_used)]

use std::collections::HashMap;
use std::path::PathBuf;

use commitscape_core::{ChangeKind, FileId, Index};
use commitscape_index::{index_from_scratch, GixRepo};

fn fixture(name: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("fixtures").join(name))
        .expect("workspace root");
    assert!(
        root.exists(),
        "fixture {name} is missing — run `cargo xtask fixtures --force`"
    );
    root
}

fn index(name: &str) -> Index {
    let repo = GixRepo::open(&fixture(name)).expect("opening fixture");
    index_from_scratch(&repo).expect("indexing fixture")
}

/// Commits touching each path, keyed by current path.
fn churn_by_path(idx: &Index) -> HashMap<String, u32> {
    let mut counts: HashMap<FileId, u32> = HashMap::new();
    for commit in &idx.commits {
        for change in idx.changes_of(commit) {
            *counts.entry(change.file).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .map(|(id, n)| (idx.paths.path_lossy(id), n))
        .collect()
}

#[test]
fn linear_has_the_expected_churn() {
    let idx = index("linear");
    assert_eq!(idx.commits.len(), 5);
    assert!(idx.is_time_ordered(), "commits must be in ascending time");

    let churn = churn_by_path(&idx);
    assert_eq!(churn.get("a.txt"), Some(&5));
    assert_eq!(churn.get("b.txt"), Some(&2));
    assert_eq!(churn.get("c.txt"), Some(&1));
}

#[test]
fn coupling_fixture_has_the_per_file_counts_the_jaccard_maths_depends_on() {
    // These four counts are what make the documented Jaccard values exact. If
    // the tree diff failed to recurse into newly-created directories, src/,
    // pkg/ and other/ would each report a single directory change instead and
    // these numbers would all be wrong.
    let idx = index("coupling");
    assert_eq!(idx.commits.len(), 12);

    let churn = churn_by_path(&idx);
    assert_eq!(churn.get("src/a.txt"), Some(&5));
    assert_eq!(churn.get("src/b.txt"), Some(&4));
    assert_eq!(churn.get("pkg/c.txt"), Some(&5));
    assert_eq!(churn.get("other/d.txt"), Some(&5));
    assert_eq!(
        churn.len(),
        4,
        "no directory entries should appear as files"
    );
}

#[test]
fn an_exact_rename_keeps_one_identity_with_the_whole_history() {
    // Without rename following this is two files of churn 3, and the moved file
    // looks newly created — the failure ADR-0004 exists to prevent.
    let idx = index("renames");
    assert_eq!(idx.commits.len(), 6);

    let churn = churn_by_path(&idx);
    assert_eq!(
        churn.get("new/path.txt"),
        Some(&6),
        "all six commits belong to one file"
    );
    assert_eq!(
        churn.len(),
        1,
        "old/path.txt must not survive as a separate file"
    );

    // Both paths resolve to the same file.
    let by_old = idx.paths.get(b"old/path.txt");
    let by_new = idx.paths.get(b"new/path.txt");
    assert!(by_old.is_some() && by_old == by_new);

    let renames = idx
        .commits
        .iter()
        .flat_map(|c| idx.changes_of(c))
        .filter(|c| c.kind == ChangeKind::Renamed)
        .count();
    assert_eq!(renames, 1);
}

#[test]
fn merges_are_flagged_and_the_branch_history_is_present() {
    let idx = index("merges");
    assert_eq!(idx.commits.len(), 7);
    assert_eq!(idx.commits.iter().filter(|c| c.is_merge()).count(), 1);

    // A merge diffed against its first parent re-reports everything the merged
    // branch changed, so side.txt appears in side 2, side 3 *and* the merge.
    // The index stores that as the fact it is; excluding merges is a
    // metrics-layer decision, and that is where the number becomes 2.
    let churn = churn_by_path(&idx);
    assert_eq!(
        churn.get("side.txt"),
        Some(&3),
        "unfiltered, merge included"
    );

    let excluding_merges = idx
        .commits
        .iter()
        .filter(|c| !c.is_merge())
        .flat_map(|c| idx.changes_of(c))
        .filter(|ch| idx.paths.path_lossy(ch.file) == "side.txt")
        .count();
    assert_eq!(
        excluding_merges, 2,
        "the side branch's own two commits — this is what churn will report"
    );

    let main_excluding_merges = idx
        .commits
        .iter()
        .filter(|c| !c.is_merge())
        .flat_map(|c| idx.changes_of(c))
        .filter(|ch| idx.paths.path_lossy(ch.file) == "main.txt")
        .count();
    assert_eq!(main_excluding_merges, 4);
}

#[test]
fn the_bulk_commit_is_recorded_as_a_fact_not_filtered_at_index_time() {
    // ADR-0002: the index stores facts. "Bulk" is a threshold applied later, so
    // all 60 changes must be present here and the filtering happens in metrics.
    let idx = index("bulk");
    assert_eq!(idx.commits.len(), 4);

    let biggest = idx
        .commits
        .iter()
        .map(|c| c.changes_len)
        .max()
        .expect("commits exist");
    assert_eq!(biggest, 60);

    let churn = churn_by_path(&idx);
    assert_eq!(
        churn.get("a.txt"),
        Some(&4),
        "unfiltered churn counts the bulk commit; the metrics layer excludes it"
    );
}

#[test]
fn ownership_resolves_every_identity_form() {
    // alpha/ is 9 Alice commits across three identity forms plus 1 Bob commit.
    // beta/ is 5 Carol across two forms plus 5 Bob. Three people in total.
    let idx = index("ownership");
    assert_eq!(
        idx.authors.len(),
        3,
        "Alice, Bob and Carol — mailmap plus the two rules must collapse the rest: {:?}",
        idx.authors
            .iter()
            .map(|(_, a)| a.email.clone())
            .collect::<Vec<_>>()
    );

    let alice = idx
        .authors
        .iter()
        .find(|(_, a)| a.email == "alice@example.com")
        .map(|(id, _)| id)
        .expect("alice resolved to her canonical address");
    let alice_commits = idx.commits.iter().filter(|c| c.author == alice).count();
    // 9 in alpha/ plus the commit that added .mailmap.
    assert_eq!(alice_commits, 10);
}

#[test]
fn a_shallow_clone_is_reported_as_truncated() {
    let idx = index("shallow");
    assert!(
        idx.history_truncated,
        "a shallow clone's commit count is a floor, and the tool must say so"
    );
}

#[test]
fn a_detached_head_indexes_from_where_you_are_standing() {
    let idx = index("detached");
    assert!(!idx.commits.is_empty());
}

#[test]
fn an_empty_repository_fails_with_a_clear_message_and_no_panic() {
    let repo = GixRepo::open(&fixture("empty")).expect("opening an empty repo should work");
    let err = index_from_scratch(&repo).expect_err("an empty repo has nothing to index");
    let msg = err.to_string();
    assert!(
        msg.contains("no commits"),
        "message should say what is wrong, got: {msg}"
    );
}

#[test]
fn a_bare_repository_can_be_walked() {
    let idx = index("bare.git");
    assert_eq!(idx.commits.len(), 5, "same history as `linear`");
}
