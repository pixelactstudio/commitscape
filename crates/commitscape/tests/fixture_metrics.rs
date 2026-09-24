//! The Phase 4 gate: every value in `docs/fixtures.md`, asserted from the
//! whole pipeline. A fixture repository is read by the gix adapter, indexed,
//! and analysed; nothing is recomputed here the way the code computes it.
//!
//! Windows are anchored at each fixture's newest commit, as `--json` anchors
//! them, and cover all of its history.

#![allow(clippy::expect_used)]

use std::collections::HashMap;
use std::path::PathBuf;

use commitscape_core::Index;
use commitscape_index::{index_from_scratch, reresolve_authors, GixRepo, IdentityRules};
use commitscape_metrics::{Analysis, Options, Window};

/// 2024-01-01T00:00:00Z: every fixture's day 0.
const EPOCH: i64 = 1_704_067_200;
const DAY: i64 = 86_400;

fn fixture(name: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("fixtures").join(name))
        .expect("workspace root");
    assert!(
        root.exists(),
        "fixture {name} is missing: run `cargo xtask fixtures --force`"
    );
    root
}

fn index(name: &str) -> Index {
    let repo = GixRepo::open(&fixture(name)).expect("opening fixture");
    index_from_scratch(&repo).expect("indexing fixture")
}

/// The bulk threshold `docs/fixtures.md` works with, and every directory
/// reported for Ownership however few its commits.
fn options() -> Options {
    Options {
        max_changeset_size: 50,
        ownership_min_commits: 1,
        ..Options::default()
    }
}

fn analysis(idx: &Index) -> Analysis<'_> {
    let anchor = idx.span.newest.expect("a fixture has commits");
    Analysis::new(idx, Window::all(anchor), options()).expect("all history is loaded")
}

fn churn(idx: &Index) -> HashMap<String, u32> {
    analysis(idx)
        .churn()
        .iter()
        .map(|c| (idx.paths.path_lossy(c.file), c.commits))
        .collect()
}

/// Days since day 0 that each file was last touched.
fn last_touched(idx: &Index) -> HashMap<String, i64> {
    analysis(idx)
        .staleness()
        .files
        .iter()
        .map(|f| (idx.paths.path_lossy(f.file), (f.last_touched - EPOCH) / DAY))
        .collect()
}

fn map<const N: usize>(pairs: [(&str, i64); N]) -> HashMap<String, i64> {
    pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

fn counts<const N: usize>(pairs: [(&str, u32); N]) -> HashMap<String, u32> {
    pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

#[test]
fn linear() {
    let idx = index("linear");
    assert_eq!(
        churn(&idx),
        counts([("a.txt", 5), ("b.txt", 2), ("c.txt", 1)])
    );
    assert_eq!(
        last_touched(&idx),
        map([("a.txt", 4), ("b.txt", 4), ("c.txt", 2)])
    );
}

#[test]
fn coupling_per_file_counts() {
    let idx = index("coupling");
    assert_eq!(
        churn(&idx),
        counts([
            ("src/a.txt", 5),
            ("src/b.txt", 4),
            ("pkg/c.txt", 5),
            ("other/d.txt", 5)
        ])
    );
}

#[test]
fn renames() {
    let idx = index("renames");
    assert_eq!(
        churn(&idx),
        counts([("new/path.txt", 6)]),
        "one file identity with all six commits"
    );
}

#[test]
fn bulk() {
    let idx = index("bulk");
    let a = analysis(&idx);
    assert_eq!(
        churn(&idx).get("a.txt"),
        Some(&3),
        "the bulk commit is excluded"
    );
    assert_eq!(a.commits().bulk, 1, "and the exclusion is counted");
    assert_eq!(
        last_touched(&idx).get("a.txt"),
        Some(&3),
        "Staleness counts the bulk commit"
    );
}

#[test]
fn merges() {
    let idx = index("merges");
    let a = analysis(&idx);
    assert_eq!(a.commits().in_window, 7);
    assert_eq!(a.commits().merges, 1);
    assert_eq!(churn(&idx), counts([("main.txt", 4), ("side.txt", 2)]));
    assert_eq!(last_touched(&idx), map([("main.txt", 5), ("side.txt", 3)]));
}

#[test]
fn conflict() {
    let idx = index("conflict");
    assert_eq!(
        churn(&idx),
        counts([("shared.txt", 3), ("other.txt", 1)]),
        "evil.txt was only touched by the merge, which churn excludes"
    );
    assert_eq!(
        last_touched(&idx),
        map([("shared.txt", 3), ("other.txt", 0), ("evil.txt", 3)]),
        "the merge's resolution and addition are touches"
    );
}

/// Each directory's owners as (email, commits), most first, and its Bus
/// Factor.
fn ownership(idx: &Index) -> HashMap<String, (Vec<(String, u32)>, u32)> {
    analysis(idx)
        .ownership()
        .directories
        .into_iter()
        .map(|d| {
            let owners = d
                .owners
                .iter()
                .map(|o| {
                    let email = idx.authors.get(o.author).map(|a| a.email.to_string());
                    (email.unwrap_or_default(), o.commits)
                })
                .collect();
            (
                String::from_utf8_lossy(&d.dir).into_owned(),
                (owners, d.bus_factor),
            )
        })
        .collect()
}

#[test]
fn ownership_with_the_mailmap() {
    let idx = index("ownership");
    let by_dir = ownership(&idx);
    let owned = |d: &str| by_dir.get(d).cloned().expect("the directory is reported");

    let (alpha, alpha_factor) = owned("alpha/");
    assert_eq!(
        alpha,
        vec![
            ("alice@example.com".into(), 9),
            ("bob@example.com".into(), 1)
        ],
        "9/10 = 90% after all three rules resolve Alice"
    );
    assert_eq!(alpha_factor, 1);

    let (beta, beta_factor) = owned("beta/");
    assert_eq!(
        beta,
        vec![
            ("bob@example.com".into(), 5),
            ("carol@users.noreply.github.com".into(), 5)
        ]
    );
    assert_eq!(beta_factor, 2);

    let (root, root_factor) = owned("");
    assert_eq!(
        root,
        vec![
            ("alice@example.com".into(), 10),
            ("bob@example.com".into(), 6),
            ("carol@users.noreply.github.com".into(), 5)
        ]
    );
    assert_eq!(root_factor, 3, "10 + 6 of 21 is 76%, under the line");
}

#[test]
fn ownership_without_the_mailmap() {
    // Alice's work address stays a separate person: 6/10 = 60%, bus factor 2.
    let mut idx = index("ownership");
    reresolve_authors(&mut idx, &IdentityRules::default());
    let by_dir = ownership(&idx);
    let (alpha, factor) = by_dir.get("alpha/").cloned().expect("alpha/ is reported");
    assert_eq!(alpha.first(), Some(&("alice@example.com".to_string(), 6)));
    assert_eq!(factor, 2);
}

#[test]
fn a_shallow_clone_says_its_history_is_truncated() {
    let idx = index("shallow");
    assert!(idx.history_truncated);
    assert_eq!(idx.span.commits, 1, "a floor, and flagged as one");
}

#[test]
fn a_detached_head_and_a_bare_clone_both_index() {
    assert_eq!(index("detached").span.commits, 2);
    let bare = index("bare.git");
    assert_eq!(bare.span.commits, 5);
    assert_eq!(
        bare.head.len(),
        3,
        "the HEAD pass reads the object database, not a work tree"
    );
}

#[test]
fn an_empty_repository_is_a_clear_message() {
    let repo = GixRepo::open(&fixture("empty")).expect("opening an empty repository works");
    let err = index_from_scratch(&repo).expect_err("nothing to index");
    assert!(err.to_string().contains("no commits"), "{err}");
}

/// Each coupled pair by path: (first, second, both, jaccard, P(first|second),
/// P(second|first), cross-directory).
fn pairs(idx: &Index, support: u32) -> Vec<(String, String, u32, f64, f64, f64, bool)> {
    let anchor = idx.span.newest.expect("commits");
    let options = Options {
        coupling_support: support,
        ..options()
    };
    let a = Analysis::new(idx, Window::all(anchor), options).expect("loaded");
    a.coupling()
        .pairs
        .iter()
        .map(|p| {
            (
                idx.paths.path_lossy(p.first),
                idx.paths.path_lossy(p.second),
                p.both,
                p.jaccard,
                p.first_given_second,
                p.second_given_first,
                p.cross_directory,
            )
        })
        .collect()
}

#[test]
fn coupling_with_a_support_of_five_prunes_src_b() {
    // src/b.txt changed in 4 commits, under the support of 5, so the
    // (src/a, src/b) pair never forms. (pkg/c, other/d): together in 4 of
    // 5 + 5 - 4 = 6 commits, Jaccard 2/3; each is 4/5 = 0.8 given the other.
    let idx = index("coupling");
    let found = pairs(&idx, 5);
    assert_eq!(found.len(), 1, "{found:?}");
    let (first, second, both, jaccard, p_fs, p_sf, cross) =
        found.first().cloned().expect("one pair");
    assert_eq!(
        (first.as_str(), second.as_str()),
        ("other/d.txt", "pkg/c.txt")
    );
    assert_eq!(both, 4);
    assert!((jaccard - 2.0 / 3.0).abs() < 1e-12);
    assert!((p_fs - 0.8).abs() < 1e-12 && (p_sf - 0.8).abs() < 1e-12);
    assert!(cross, "other/ and pkg/ are different directories");
}

#[test]
fn coupling_with_a_support_of_four_keeps_both_pairs() {
    // (src/a, src/b): together 3 times of 5 + 4 - 3 = 6, Jaccard 1/2.
    // P(src/a | src/b) = 3/4, P(src/b | src/a) = 3/5. Same directory.
    let idx = index("coupling");
    let found = pairs(&idx, 4);
    assert_eq!(found.len(), 2, "{found:?}");
    let ab = found
        .iter()
        .find(|p| p.0 == "src/a.txt")
        .cloned()
        .expect("the (src/a, src/b) pair");
    assert_eq!(ab.1, "src/b.txt");
    assert_eq!(ab.2, 3);
    assert!((ab.3 - 0.5).abs() < 1e-12);
    assert!((ab.4 - 0.75).abs() < 1e-12, "P(src/a | src/b)");
    assert!((ab.5 - 0.6).abs() < 1e-12, "P(src/b | src/a)");
    assert!(!ab.6);
    assert_eq!(
        found.first().map(|p| p.0.as_str()),
        Some("other/d.txt"),
        "the higher Jaccard ranks first"
    );
}
