//! Change Coupling and changeset sizes, over hand-built indexes.

#![allow(clippy::expect_used)]

mod support;

use commitscape_metrics::{Analysis, Options, Window};
use support::{c, generated, h, index, merge, DAY, EPOCH};

fn options(support: u32) -> Options {
    Options {
        max_changeset_size: 3,
        coupling_support: support,
        ..Options::default()
    }
}

#[test]
fn merges_bulk_commits_and_generated_files_do_not_couple() {
    // a and b change together twice on their own. A merge, a bulk commit
    // (four files over a threshold of three) and lockfile updates also touch
    // them together, and none of those may count.
    let idx = index(
        &[
            c(0, "x@x.org", &["a.rs", "b.rs"]),
            c(1, "x@x.org", &["a.rs", "b.rs", "pnpm-lock.yaml"]),
            merge(2, "x@x.org", &["a.rs", "b.rs"]),
            c(3, "x@x.org", &["a.rs", "b.rs", "c.rs", "d.rs"]),
            c(4, "x@x.org", &["a.rs", "pnpm-lock.yaml"]),
        ],
        &[
            h("a.rs", 1, 0),
            h("b.rs", 1, 0),
            h("c.rs", 1, 0),
            h("d.rs", 1, 0),
            generated("pnpm-lock.yaml", 1, 0),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 4 * DAY), options(1)).expect("covered");
    let coupling = a.coupling();
    let found: Vec<(String, String, u32, u32, u32)> = coupling
        .pairs
        .iter()
        .map(|p| {
            (
                idx.paths.path_lossy(p.first),
                idx.paths.path_lossy(p.second),
                p.both,
                p.first_commits,
                p.second_commits,
            )
        })
        .collect();
    // a: days 0, 1, 4 = 3 commits; b: days 0, 1 = 2; together 2.
    assert_eq!(found, vec![("a.rs".into(), "b.rs".into(), 2, 3, 2)]);
    assert_eq!(coupling.pair_count, 1);
}

#[test]
fn the_changeset_histogram_counts_non_merge_commits_by_size() {
    // Sizes 1, 1, 2, 4 and 60; the merge is left out.
    let mut touched_60: Vec<String> = (0..60).map(|i| format!("f{i}.rs")).collect();
    touched_60.sort();
    let sixty: Vec<&str> = touched_60.iter().map(String::as_str).collect();
    let idx = index(
        &[
            c(0, "x@x.org", &["a.rs"]),
            c(1, "x@x.org", &["a.rs"]),
            c(2, "x@x.org", &["a.rs", "b.rs"]),
            c(3, "x@x.org", &["a.rs", "b.rs", "c.rs", "d.rs"]),
            c(4, "x@x.org", &sixty),
            merge(5, "x@x.org", &["a.rs"]),
        ],
        &[h("a.rs", 1, 0)],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 5 * DAY), options(1)).expect("covered");
    let sizes = a.changeset_sizes();
    assert_eq!(sizes.commits, 5);
    let buckets: Vec<(u32, u32, u32)> = sizes
        .buckets
        .iter()
        .filter(|b| b.commits > 0)
        .map(|b| (b.from, b.to, b.commits))
        .collect();
    assert_eq!(buckets, vec![(1, 1, 2), (2, 2, 1), (3, 5, 1), (51, 100, 1)]);
    // Sorted sizes 1, 1, 2, 4, 60: the median is 2, the largest 60.
    assert_eq!(sizes.median, 2);
    assert_eq!(sizes.max, 60);
}

#[test]
fn a_pair_opens_onto_the_commits_it_shared_newest_first() {
    // a and b shared the counted commits of days 0 and 3. The merge (day 1)
    // and the bulk commit (day 2) touched both and do not count; a alone was
    // also changed on day 4.
    let idx = index(
        &[
            c(0, "x@x.org", &["a.rs", "b.rs"]),
            merge(1, "x@x.org", &["a.rs", "b.rs"]),
            c(2, "x@x.org", &["a.rs", "b.rs", "c.rs", "d.rs"]),
            c(3, "x@x.org", &["a.rs", "b.rs"]),
            c(4, "x@x.org", &["a.rs"]),
        ],
        &[
            h("a.rs", 1, 0),
            h("b.rs", 1, 0),
            h("c.rs", 1, 0),
            h("d.rs", 1, 0),
        ],
    );
    let file = |p: &str| idx.paths.get(p.as_bytes()).expect("the file exists");
    let a = Analysis::new(&idx, Window::all(EPOCH + 4 * DAY), options(1)).expect("covered");
    let days = |files: &[commitscape_core::FileId]| -> Vec<i64> {
        a.commits_touching(files)
            .iter()
            .map(|c| (c.time - EPOCH) / DAY)
            .collect()
    };
    assert_eq!(days(&[file("a.rs"), file("b.rs")]), vec![3, 0]);
    assert_eq!(days(&[file("a.rs")]), vec![4, 3, 0]);
}

#[test]
fn files_that_all_change_together_form_a_group() {
    // Commits 1 to 6 change api/a.rs, api/b.rs and web/c.ts together; 7 to
    // 11 change db/d.sql and db/e.sql; 12 changes api/a.rs and db/d.sql.
    // Every pair of a, b, c has a Jaccard degree of 6/7 (a changed 7 times);
    // d and e 5/6; a and d 1/12, too weak to join the two groups.
    let mut commits = Vec::new();
    for day in 1..=6 {
        commits.push(c(day, "x@x.org", &["api/a.rs", "api/b.rs", "web/c.ts"]));
    }
    for day in 7..=11 {
        commits.push(c(day, "x@x.org", &["db/d.sql", "db/e.sql"]));
    }
    commits.push(c(12, "x@x.org", &["api/a.rs", "db/d.sql"]));
    let files = ["api/a.rs", "api/b.rs", "web/c.ts", "db/d.sql", "db/e.sql"];
    let head: Vec<_> = files.iter().map(|f| h(f, 1, 0)).collect();
    let idx = index(&commits, &head);
    let a = Analysis::new(&idx, Window::all(EPOCH + 13 * DAY), options(5)).expect("covered");
    let groups: Vec<(Vec<String>, u32, bool)> = a
        .change_groups()
        .iter()
        .map(|g| {
            let mut paths: Vec<String> = g.files.iter().map(|f| idx.paths.path_lossy(*f)).collect();
            paths.sort();
            (paths, g.together, g.cross_directory)
        })
        .collect();
    assert_eq!(
        groups,
        vec![
            (
                vec![
                    "api/a.rs".to_string(),
                    "api/b.rs".to_string(),
                    "web/c.ts".to_string()
                ],
                6,
                true
            ),
            (
                vec!["db/d.sql".to_string(), "db/e.sql".to_string()],
                5,
                false
            ),
        ]
    );
}
