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
