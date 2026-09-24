//! The real `gix` adapter, run against the fixture repositories.
//!
//! Expected values come from `docs/fixtures.md`, worked out by hand from the
//! shape of each history. Nothing here recomputes an expectation the way the
//! implementation does.

// `allow-expect-in-tests` in clippy.toml only covers `#[test]` functions, not
// the shared helpers below. This whole file is test code, so the working
// agreement's "outside tests" exemption applies to all of it.
#![allow(clippy::expect_used)]

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use commitscape_core::{ChangeKind, FileId, Index, Oid};
use commitscape_index::{
    index_from_scratch, index_incremental, load, CacheOptions, Freshness, GixRepo, RebuildReason,
    Since,
};

/// 2024-01-01T00:00:00Z, the fixtures' day 0. See `docs/fixtures.md`.
const EPOCH: i64 = 1_704_067_200;
const DAY: i64 = 86_400;

fn day_of(time: i64) -> i64 {
    (time - EPOCH) / DAY
}

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

    // The file lives at the new path now and remembers the old one. Nothing
    // lives at the old path any more.
    let moved = idx.paths.get(b"new/path.txt").expect("the moved file");
    assert_eq!(
        idx.paths.former_paths(moved).collect::<Vec<_>>(),
        vec![b"old/path.txt".as_slice()]
    );
    assert_eq!(idx.paths.get(b"old/path.txt"), None);

    let renames = idx
        .commits
        .iter()
        .flat_map(|c| idx.changes_of(c))
        .filter(|c| c.kind == ChangeKind::Renamed)
        .count();
    assert_eq!(renames, 1);
}

#[test]
fn a_clean_merge_records_no_changes_of_its_own() {
    let idx = index("merges");
    assert_eq!(idx.commits.len(), 7);
    let merges: Vec<_> = idx.commits.iter().filter(|c| c.is_merge()).collect();
    assert_eq!(merges.len(), 1);
    assert_eq!(
        merges.first().map(|m| m.changes_len),
        Some(0),
        "a clean merge introduces nothing that differs from every parent"
    );

    // With the merge contributing nothing, the unfiltered counts are the branch
    // commits' own: side 2 and side 3 for side.txt, days 0, 1, 4, 5 for main.txt.
    let churn = churn_by_path(&idx);
    assert_eq!(churn.get("side.txt"), Some(&2));
    assert_eq!(churn.get("main.txt"), Some(&4));
}

#[test]
fn a_merge_records_exactly_what_it_resolved_or_introduced() {
    let idx = index("conflict");
    assert_eq!(idx.commits.len(), 4);
    let merge = idx
        .commits
        .iter()
        .find(|c| c.is_merge())
        .expect("the fixture has one merge");

    let mut recorded: Vec<(String, ChangeKind)> = idx
        .changes_of(merge)
        .iter()
        .map(|ch| (idx.paths.path_lossy(ch.file), ch.kind))
        .collect();
    recorded.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        recorded,
        vec![
            ("evil.txt".to_string(), ChangeKind::Added),
            ("shared.txt".to_string(), ChangeKind::Modified),
        ],
        "other.txt matches both parents, so it must not appear"
    );

    let churn = churn_by_path(&idx);
    assert_eq!(churn.get("shared.txt"), Some(&4), "merge included");
    assert_eq!(churn.get("other.txt"), Some(&1));
    assert_eq!(churn.get("evil.txt"), Some(&1));
}

#[test]
fn resuming_finds_older_commits_a_merge_made_reachable() {
    // ADR-0002's frontier case. Pretend the last index stopped when main's tip
    // was `main 5`, so it holds days 0, 1, 4 and 5, and the side branch had
    // never been seen. A resume keyed on a single sha or a timestamp would
    // miss side 2 and side 3, which are older than main 5.
    let repo = GixRepo::open(&fixture("merges")).expect("opening fixture");
    let full = index_from_scratch(&repo).expect("indexing fixture");
    let indexed: HashSet<Oid> = full
        .commits
        .iter()
        .filter(|c| [0, 1, 4, 5].contains(&day_of(c.time)))
        .map(|c| c.id)
        .collect();
    assert_eq!(indexed.len(), 4);

    let resumed = index_incremental(&repo, &indexed).expect("resuming");
    let mut days: Vec<i64> = resumed.commits.iter().map(|c| day_of(c.time)).collect();
    days.sort_unstable();
    assert_eq!(days, vec![2, 3, 6]);
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
        idx.authors.iter().map(|(_, a)| a.email).collect::<Vec<_>>()
    );

    let alice = idx
        .authors
        .iter()
        .find(|(_, a)| a.email == "alice@example.com")
        .map(|(id, _)| id)
        .expect("alice resolved to her canonical address");
    let alice_commits = idx
        .commits
        .iter()
        .filter(|c| idx.author_of(c) == Some(alice))
        .count();
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

#[test]
fn a_real_repository_loads_warm_the_second_time() {
    let repo = GixRepo::open(&fixture("merges")).expect("opening fixture");
    let dir = tempfile::tempdir().expect("temp dir");
    let options = CacheOptions {
        root: Some(dir.path().to_path_buf()),
    };
    let first = load(&repo, &options, Since::All, &mut |_| {}).expect("first load");
    assert_eq!(
        first.freshness,
        Freshness::Built {
            reason: RebuildReason::NoCache
        }
    );
    let second = load(&repo, &options, Since::All, &mut |_| {}).expect("second load");
    assert_eq!(second.freshness, Freshness::Warm);
    assert_eq!(second.index.commits, first.index.commits);
    assert_eq!(second.index.changes, first.index.changes);
}

#[test]
fn the_head_pass_measures_every_file_at_head() {
    // linear's HEAD: a.txt holds "1".."5", b.txt "b" twice, c.txt "c" once.
    // Plain text is prose: a person wrote it, but it is not code.
    let idx = index("linear");
    let loc = |path: &str| {
        let file = idx.paths.get(path.as_bytes()).expect("file at HEAD");
        idx.head
            .iter()
            .find(|h| h.file == file)
            .map(|h| (h.loc, h.class))
    };
    assert_eq!(idx.head.len(), 3);
    assert_eq!(loc("a.txt"), Some((5, commitscape_core::FileClass::Prose)));
    assert_eq!(loc("b.txt"), Some((2, commitscape_core::FileClass::Prose)));
    assert_eq!(loc("c.txt"), Some((1, commitscape_core::FileClass::Prose)));
    assert!(idx.head_commit.is_some());
}

#[test]
fn rhythm_keeps_each_authors_clock_and_what_each_message_says() {
    use commitscape_core::{civil_from_unix, CommitKind::*};
    let idx = index("rhythm");
    let seen: Vec<_> = idx
        .commits
        .iter()
        .map(|c| {
            let clock = c.author_clock();
            let (y, m, d) = civil_from_unix(clock);
            let minutes = clock.rem_euclid(DAY) / 60;
            (
                c.offset_minutes,
                (y, m, d, minutes / 60, minutes % 60),
                c.kind,
            )
        })
        .collect();
    assert_eq!(
        seen,
        vec![
            (330, (2024, 1, 1, 9, 15), Feature),
            (330, (2024, 1, 2, 23, 40), Fix),
            (-420, (2024, 1, 6, 2, 5), Docs),
            (0, (2024, 1, 3, 14, 0), Refactor),
            (0, (2024, 1, 7, 12, 0), Revert),
            (60, (2024, 1, 8, 8, 0), Other),
        ]
    );
    let rebased = idx.commits.get(3).expect("the fourth commit");
    assert_eq!(
        rebased.author_delta, -331_200,
        "written 3 days 20 hours earlier"
    );
}

#[test]
fn a_clone_knows_where_it_came_from() {
    use commitscape_index::RepoSource;
    let bare = GixRepo::open(&fixture("bare.git")).expect("opening fixture");
    let url = bare.remote_url().expect("a clone has an origin");
    assert!(url.ends_with("fixtures/linear"), "{url}");
    let linear = GixRepo::open(&fixture("linear")).expect("opening fixture");
    assert_eq!(linear.remote_url(), None, "linear was never cloned");
}
