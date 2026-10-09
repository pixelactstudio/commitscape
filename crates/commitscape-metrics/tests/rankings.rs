#![allow(clippy::expect_used)]

mod support;

use commitscape_metrics::{Analysis, Options, Window};
use support::{c, generated, h, index, merge, prose, DAY, EPOCH};

fn options(max_changeset_size: u32) -> Options {
    Options {
        max_changeset_size,
        ..Options::default()
    }
}

fn path(analysis_index: &commitscape_core::Index, file: commitscape_core::FileId) -> String {
    analysis_index.paths.path_lossy(file)
}

fn history() -> commitscape_core::Index {
    index(
        &[
            c(0, "alice@example.com", &["a.rs", "b.rs"]),
            c(1, "alice@example.com", &["a.rs"]),
            merge(2, "bob@example.com", &["a.rs"]),
            c(3, "alice@example.com", &["a.rs", "x1.rs", "x2.rs", "x3.rs"]),
        ],
        &[
            h("a.rs", 10, 4),
            h("b.rs", 10, 4),
            h("x1.rs", 1, 0),
            h("x2.rs", 1, 0),
            h("x3.rs", 1, 0),
        ],
    )
}

#[test]
fn churn_counts_commits_but_not_merges_or_bulk_commits() {
    let idx = history();
    let a = Analysis::new(&idx, Window::all(EPOCH + 3 * DAY), options(3));
    let churn: Vec<(String, u32)> = a
        .churn()
        .iter()
        .map(|c| (path(&idx, c.file), c.commits))
        .collect();
    assert_eq!(churn, vec![("a.rs".into(), 2), ("b.rs".into(), 1)]);

    let counts = a.commits();
    assert_eq!(counts.in_window, 4);
    assert_eq!(counts.merges, 1);
    assert_eq!(counts.bulk, 1, "the bulk count must be visible");
}

#[test]
fn a_window_counts_only_the_commits_inside_it() {
    let idx = history();
    let a = Analysis::new(&idx, Window::last(2, EPOCH + 3 * DAY), options(3));
    let churn: Vec<(String, u32)> = a
        .churn()
        .iter()
        .map(|c| (path(&idx, c.file), c.commits))
        .collect();
    assert_eq!(churn, vec![("a.rs".into(), 1)]);
    assert_eq!(a.commits().in_window, 3);
}

#[test]
fn generated_files_never_rank() {
    let idx = index(
        &[
            c(0, "a@x.org", &["a.rs", "pnpm-lock.yaml"]),
            c(1, "a@x.org", &["pnpm-lock.yaml"]),
            c(2, "a@x.org", &["pnpm-lock.yaml"]),
        ],
        &[
            h("a.rs", 100, 10),
            generated("pnpm-lock.yaml", 20_000, 1_000),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 2 * DAY), options(50));
    let large: Vec<String> = a.largest().iter().map(|l| path(&idx, l.file)).collect();
    assert_eq!(large, vec!["a.rs".to_string()]);
    assert!(a
        .churn()
        .iter()
        .all(|c| path(&idx, c.file) != "pnpm-lock.yaml"));
}

#[test]
fn the_largest_files_are_ordered_by_lines_then_path() {
    let idx = index(
        &[c(0, "a@x.org", &["b.rs", "a.rs", "c.rs"])],
        &[h("b.rs", 500, 1), h("a.rs", 500, 1), h("c.rs", 900, 1)],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH), options(50));
    let large: Vec<(String, u32)> = a
        .largest()
        .iter()
        .map(|l| (path(&idx, l.file), l.loc))
        .collect();
    assert_eq!(
        large,
        vec![
            ("c.rs".into(), 900),
            ("a.rs".into(), 500),
            ("b.rs".into(), 500)
        ]
    );
}

#[test]
fn prose_has_churn_but_is_not_among_the_largest() {
    let idx = index(
        &[
            c(0, "a@x.org", &["src/a.rs", "CHANGELOG.md"]),
            c(1, "a@x.org", &["CHANGELOG.md"]),
        ],
        &[h("src/a.rs", 100, 10), prose("CHANGELOG.md", 16_000, 900)],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + DAY), options(50));
    let churn: Vec<(String, u32)> = a
        .churn()
        .iter()
        .map(|c| (path(&idx, c.file), c.commits))
        .collect();
    assert_eq!(
        churn,
        vec![("CHANGELOG.md".into(), 2), ("src/a.rs".into(), 1)],
        "a person writes the changelog, and it changes"
    );
    let large: Vec<String> = a.largest().iter().map(|l| path(&idx, l.file)).collect();
    assert_eq!(large, vec!["src/a.rs".to_string()]);
}
