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

fn assert_scores(actual: &[f64], expected: &[f64]) {
    assert_eq!(
        actual.len(),
        expected.len(),
        "{actual:?} against {expected:?}"
    );
    for (a, e) in actual.iter().zip(expected) {
        assert!((a - e).abs() < 1e-12, "{actual:?} against {expected:?}");
    }
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
    let a = Analysis::new(&idx, Window::all(EPOCH + 3 * DAY), options(3)).expect("covered");
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
    let a = Analysis::new(&idx, Window::last(2, EPOCH + 3 * DAY), options(3)).expect("covered");
    let churn: Vec<(String, u32)> = a
        .churn()
        .iter()
        .map(|c| (path(&idx, c.file), c.commits))
        .collect();
    assert_eq!(churn, vec![("a.rs".into(), 1)]);
    assert_eq!(a.commits().in_window, 3);
}

#[test]
fn a_hotspot_is_churn_percentile_times_complexity_percentile() {
    let idx = index(
        &[
            c(0, "a@x.org", &["a.rs", "b.rs", "c.rs"]),
            c(1, "a@x.org", &["a.rs", "b.rs"]),
            c(2, "a@x.org", &["a.rs"]),
            c(3, "a@x.org", &["a.rs"]),
        ],
        &[h("a.rs", 100, 40), h("b.rs", 50, 10), h("c.rs", 300, 80)],
    );
    let a = Analysis::new(&idx, Window::last(2, EPOCH + 3 * DAY), options(50)).expect("covered");
    let hot: Vec<(String, u32, u32)> = a
        .hotspots()
        .iter()
        .map(|s| (path(&idx, s.file), s.churn, s.complexity))
        .collect();
    assert_eq!(
        hot,
        vec![("a.rs".into(), 3, 40), ("b.rs".into(), 1, 10)],
        "c.rs had no churn in the window"
    );
    let scores: Vec<f64> = a.hotspots().iter().map(|s| s.score).collect();
    assert_scores(&scores, &[2.0 / 3.0, 1.0 / 6.0]);

    let all = Analysis::new(&idx, Window::all(EPOCH + 3 * DAY), options(50)).expect("covered");
    let order: Vec<String> = all.hotspots().iter().map(|s| path(&idx, s.file)).collect();
    assert_eq!(order, vec!["a.rs", "c.rs", "b.rs"]);
    let scores: Vec<f64> = all.hotspots().iter().map(|s| s.score).collect();
    assert_scores(&scores, &[2.0 / 3.0, 1.0 / 3.0, 2.0 / 9.0]);
}

#[test]
fn a_hotspot_says_where_it_stands_among_the_files_it_was_ranked_with() {
    let idx = index(
        &[
            c(0, "a@x.org", &["a.rs", "b.rs", "c.rs"]),
            c(1, "a@x.org", &["a.rs", "b.rs"]),
            c(2, "a@x.org", &["a.rs"]),
            c(3, "a@x.org", &["a.rs"]),
        ],
        &[h("a.rs", 100, 40), h("b.rs", 50, 10), h("c.rs", 300, 80)],
    );
    let a = Analysis::new(&idx, Window::last(2, EPOCH + 3 * DAY), options(50)).expect("covered");
    type Places = (String, (u32, u32), (u32, u32));
    let ranks: Vec<Places> = a
        .hotspots()
        .iter()
        .map(|s| {
            (
                path(&idx, s.file),
                (s.churn_rank.place, s.churn_rank.of),
                (s.complexity_rank.place, s.complexity_rank.of),
            )
        })
        .collect();
    assert_eq!(
        ranks,
        vec![
            ("a.rs".into(), (1, 2), (2, 3)),
            ("b.rs".into(), (2, 2), (3, 3)),
        ]
    );

    let tied = index(
        &[
            c(0, "a@x.org", &["d.rs", "e.rs"]),
            c(1, "a@x.org", &["d.rs", "e.rs"]),
        ],
        &[h("d.rs", 10, 5), h("e.rs", 10, 5)],
    );
    let t = Analysis::new(&tied, Window::all(EPOCH + DAY), options(50)).expect("covered");
    let places: Vec<(u32, u32)> = t
        .hotspots()
        .iter()
        .map(|s| (s.churn_rank.place, s.complexity_rank.place))
        .collect();
    assert_eq!(places, vec![(1, 1), (1, 1)]);
}

#[test]
fn one_pathological_file_does_not_flatten_every_other_score() {
    let mut commits = vec![c(0, "a@x.org", &["x.rs", "y.rs", "z.rs", "w.rs"])];
    for day in 1..250 {
        let touched: &[&str] = match day {
            1..=4 => &["y.rs", "z.rs", "w.rs"],
            5..=79 => &["y.rs", "z.rs"],
            _ => &["z.rs"],
        };
        commits.push(c(day, "a@x.org", touched));
    }
    let idx = index(
        &commits,
        &[
            h("x.rs", 90_000, 4_000_000),
            h("y.rs", 3_000, 30_000),
            h("z.rs", 800, 5_000),
            h("w.rs", 20, 100),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 250 * DAY), options(50)).expect("covered");
    let order: Vec<(String, u32)> = a
        .hotspots()
        .iter()
        .map(|s| (path(&idx, s.file), s.churn))
        .collect();
    assert_eq!(
        order,
        vec![
            ("y.rs".into(), 80),
            ("z.rs".into(), 250),
            ("x.rs".into(), 1),
            ("w.rs".into(), 5)
        ]
    );
    let scores: Vec<f64> = a.hotspots().iter().map(|s| s.score).collect();
    assert_scores(&scores, &[0.5625, 0.5, 0.25, 0.125]);
}

#[test]
fn generated_files_never_rank_and_do_not_skew_normalisation() {
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
    let a = Analysis::new(&idx, Window::all(EPOCH + 2 * DAY), options(50)).expect("covered");
    let hot: Vec<(String, f64)> = a
        .hotspots()
        .iter()
        .map(|s| (path(&idx, s.file), s.score))
        .collect();
    assert_eq!(hot, vec![("a.rs".into(), 1.0)]);
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
    let a = Analysis::new(&idx, Window::all(EPOCH), options(50)).expect("covered");
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
fn a_window_reaching_past_what_is_loaded_is_refused() {
    let mut idx = history();
    idx.loaded_from = Some(EPOCH + 2 * DAY);
    assert!(Analysis::new(&idx, Window::all(EPOCH + 3 * DAY), options(3)).is_err());
    assert!(Analysis::new(&idx, Window::last(1, EPOCH + 3 * DAY), options(3)).is_ok());
}

#[test]
fn prose_has_churn_but_is_neither_a_hotspot_nor_among_the_largest() {
    let idx = index(
        &[
            c(0, "a@x.org", &["src/a.rs", "CHANGELOG.md"]),
            c(1, "a@x.org", &["CHANGELOG.md"]),
        ],
        &[h("src/a.rs", 100, 10), prose("CHANGELOG.md", 16_000, 900)],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + DAY), options(50)).expect("covered");
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
    let hot: Vec<String> = a.hotspots().iter().map(|s| path(&idx, s.file)).collect();
    assert_eq!(hot, vec!["src/a.rs".to_string()]);
    let large: Vec<String> = a.largest().iter().map(|l| path(&idx, l.file)).collect();
    assert_eq!(large, vec!["src/a.rs".to_string()]);
}
