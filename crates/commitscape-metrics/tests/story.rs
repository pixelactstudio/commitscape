//! The repository's story: when and how its commits were made, who made
//! them, and what it is written in. Hand-built indexes; every expected value
//! is worked out in the comments.

#![allow(clippy::expect_used)]

mod support;

use commitscape_core::CommitKind;
use commitscape_metrics::{Analysis, Options, Window};
use support::{c, h, index, merge, DAY, EPOCH};

/// Monday 1 January 2024, as days since the epoch: 1,704,067,200 / 86,400.
const MONDAY: i64 = 19_723;

fn options() -> Options {
    Options {
        max_changeset_size: 3,
        ownership_min_commits: 1,
        ..Options::default()
    }
}

/// A week in Local Time. Monday 09:15 in India, Alice, a feature. Tuesday
/// 23:40 in India, Alice, a fix an agent co-wrote. Wednesday 10:00, 10:30
/// and 22:30 in London, Bob: docs, tests and a fix. Saturday 02:05 in
/// California, Bob. Sunday 12:00 in London, Alice, and her merge at 13:00,
/// which the rhythm leaves out.
fn week() -> commitscape_core::Index {
    index(&week_commits(), &[h("a.rs", 10, 5), h("b.rs", 20, 5)])
}

fn week_commits() -> Vec<support::C<'static>> {
    vec![
        c(0, "alice@x.org", &["a.rs"])
            .local(9, 15, 330)
            .kind(CommitKind::Feature),
        c(1, "alice@x.org", &["a.rs"])
            .local(23, 40, 330)
            .kind(CommitKind::Fix)
            .agent(),
        c(2, "bob@x.org", &["b.rs"])
            .local(10, 0, 0)
            .kind(CommitKind::Docs),
        c(2, "bob@x.org", &["b.rs"])
            .local(10, 30, 0)
            .kind(CommitKind::Test),
        c(2, "bob@x.org", &["b.rs"])
            .local(22, 30, 0)
            .kind(CommitKind::Fix),
        c(5, "bob@x.org", &["b.rs"]).local(2, 5, -420),
        c(6, "alice@x.org", &["a.rs"]).local(12, 0, 0),
        merge(6, "alice@x.org", &[]).local(13, 0, 0),
    ]
}

fn analysis(idx: &commitscape_core::Index) -> Analysis<'_> {
    // Sunday 23:00 UTC: the week, and nothing after it.
    Analysis::new(idx, Window::all(EPOCH + 6 * DAY + 23 * 3600), options())
        .expect("all of it is loaded")
}

#[test]
fn the_pulse_counts_each_day_and_hour_on_the_authors_own_clock() {
    let idx = week();
    let pulse = analysis(&idx).pulse(None);
    assert_eq!(pulse.commits, 7, "the merge is left out");
    assert_eq!(pulse.first_day, MONDAY);
    assert_eq!(pulse.days, vec![1, 1, 3, 0, 0, 1, 1], "Monday to Sunday");
    assert_eq!(pulse.active_days, 5);
    assert_eq!(
        pulse.longest_streak.map(|s| (s.first_day, s.days)),
        Some((MONDAY, 3)),
        "Monday, Tuesday, Wednesday"
    );
    assert_eq!(pulse.busiest_day, Some((MONDAY + 2, 3)), "Wednesday");

    // Weekday rows, Monday first; hours of the author's day.
    let at = |weekday: usize, hour: usize| {
        pulse
            .week
            .get(weekday)
            .and_then(|hours| hours.get(hour))
            .copied()
            .unwrap_or(0)
    };
    assert_eq!(at(0, 9), 1, "Monday 09:15 in India");
    assert_eq!(at(1, 23), 1, "Tuesday 23:40 in India");
    assert_eq!(at(2, 10), 2, "Wednesday 10:00 and 10:30");
    assert_eq!(at(2, 22), 1);
    assert_eq!(at(5, 2), 1, "Saturday 02:05 in California");
    assert_eq!(at(6, 12), 1);
    assert_eq!(pulse.busiest_hour(), Some(10));
    // Weekends: Saturday and Sunday, 2 of 7. Nights, 22:00 to 04:59:
    // Tuesday 23:40, Wednesday 22:30 and Saturday 02:05, 3 of 7.
    assert_eq!(pulse.weekend(), 2);
    assert_eq!(pulse.night(), 3);

    let kinds: Vec<(CommitKind, u32)> = pulse
        .kinds
        .iter()
        .filter(|k| k.commits > 0)
        .map(|k| (k.kind, k.commits))
        .collect();
    assert_eq!(
        kinds,
        vec![
            (CommitKind::Feature, 1),
            (CommitKind::Fix, 2),
            (CommitKind::Docs, 1),
            (CommitKind::Test, 1),
            (CommitKind::Other, 2),
        ]
    );
    assert_eq!(pulse.agent, 1);
}

#[test]
fn a_rebased_commit_counts_on_the_day_it_landed_and_the_hour_it_was_written() {
    // Written on Monday at 09:00 and rebased onto the main line on Thursday
    // at 16:00; another commit on Friday at 10:00, all in London. The
    // Window runs from Wednesday 23:00 to Friday 23:00 and holds both, by
    // when they landed. The days are the Window's, Wednesday to Friday,
    // with the rebased commit on Thursday; the hours are when the work was
    // done, so its hour is Monday's 09:00.
    let idx = index(
        &[
            c(3, "alice@x.org", &["a.rs"]).local(16, 0, 0).written(0, 9),
            c(4, "alice@x.org", &["a.rs"]).local(10, 0, 0),
        ],
        &[h("a.rs", 10, 5)],
    );
    let a = Analysis::new(
        &idx,
        Window::last(2, EPOCH + 4 * DAY + 23 * 3600),
        options(),
    )
    .expect("all of it is loaded");
    let pulse = a.pulse(None);
    assert_eq!(pulse.first_day, MONDAY + 2, "Wednesday");
    assert_eq!(pulse.days, vec![0, 1, 1], "Wednesday to Friday");
    assert_eq!(
        pulse.longest_streak.map(|s| (s.first_day, s.days)),
        Some((MONDAY + 3, 2)),
        "Thursday and Friday"
    );
    let at = |weekday: usize, hour: usize| {
        pulse
            .week
            .get(weekday)
            .and_then(|hours| hours.get(hour))
            .copied()
            .unwrap_or(0)
    };
    assert_eq!(at(0, 9), 1, "written on Monday at 09:00");
    assert_eq!(at(3, 16), 0, "not when it landed");
    assert_eq!(at(4, 10), 1);
}

fn person(idx: &commitscape_core::Index, email: &str) -> commitscape_core::AuthorId {
    idx.authors
        .iter()
        .find(|(_, a)| a.email == email)
        .map(|(id, _)| id)
        .expect("the person exists")
}

#[test]
fn one_persons_pulse_holds_only_their_commits() {
    // Bob: Wednesday three times, Saturday once. Over all of history his
    // days start at his first commit.
    let idx = week();
    let pulse = analysis(&idx).pulse(Some(person(&idx, "bob@x.org")));
    assert_eq!(pulse.commits, 4);
    assert_eq!(pulse.first_day, MONDAY + 2);
    assert_eq!(pulse.days, vec![3, 0, 0, 1, 0], "Wednesday to Sunday");
    assert_eq!(pulse.longest_streak.map(|s| s.days), Some(1));
    assert_eq!(pulse.agent, 0);
}

#[test]
fn contributors_rank_by_commits_with_their_days_and_agent_help() {
    // Bob: 4 commits on Wednesday and Saturday. Alice: 3 on Monday, Tuesday
    // and Sunday, one co-written by an agent; her merge does not count.
    let idx = week();
    let rows: Vec<_> = analysis(&idx)
        .contributors()
        .iter()
        .map(|c| {
            let email = idx.authors.get(c.author).map(|a| a.email.to_string());
            (
                email.unwrap_or_default(),
                c.commits,
                c.active_days,
                c.agent,
                (c.first - EPOCH) / 60,
                (c.last - EPOCH) / 60,
            )
        })
        .collect();
    let minutes = |day: i64, hour: i64, minute: i64| (day * 24 + hour) * 60 + minute;
    assert_eq!(
        rows,
        vec![
            (
                "bob@x.org".to_string(),
                4,
                2,
                0,
                minutes(2, 10, 0),
                minutes(5, 2, 5)
            ),
            (
                "alice@x.org".to_string(),
                3,
                3,
                1,
                minutes(0, 9, 15),
                minutes(6, 12, 0)
            ),
        ],
        "first and last on each author's own clock"
    );
}

#[test]
fn languages_count_the_lines_of_code_at_head() {
    // TypeScript 160 + 50, Rust 120 + 80, Shell 20, Dockerfile 10. The JSON
    // is configuration, the `.xyz` file is no language we know, the README
    // is prose and the lockfile is generated: none of them is a language.
    let idx = index(
        &[c(0, "a@x.org", &["src/main.rs"])],
        &[
            h("src/main.rs", 120, 0),
            h("src/lib.rs", 80, 0),
            h("web/app.tsx", 160, 0),
            h("web/util.ts", 50, 0),
            h("scripts/run.sh", 20, 0),
            h("Dockerfile", 10, 0),
            h("config/app.json", 300, 0),
            h("tools/thing.xyz", 5, 0),
            support::prose("README.md", 40, 0),
            support::generated("pnpm-lock.yaml", 9000, 0),
        ],
    );
    let languages = analysis(&idx).languages();
    let rows: Vec<(&str, u32, u64)> = languages
        .languages
        .iter()
        .map(|l| (l.name, l.files, l.lines))
        .collect();
    assert_eq!(
        rows,
        vec![
            ("TypeScript", 2, 210),
            ("Rust", 2, 200),
            ("Shell", 1, 20),
            ("Dockerfile", 1, 10),
        ]
    );
    assert_eq!(languages.data_lines, 300);
    assert_eq!(languages.other_lines, 5);
}

#[test]
fn totals_cover_all_of_history_and_what_is_at_head() {
    // The week's 8 commits, 1 of them a merge, by 2 people. The first was
    // Monday 09:15 in India, 03:45 UTC; the last, the merge, Sunday 13:00
    // UTC. At HEAD: two code files of 10 and 20 lines, a 5-line README and
    // a lockfile no person wrote.
    let idx = index(
        &week_commits(),
        &[
            h("a.rs", 10, 5),
            h("b.rs", 20, 5),
            support::prose("README.md", 5, 0),
            support::generated("pnpm-lock.yaml", 900, 0),
        ],
    );
    let t = analysis(&idx).totals();
    assert_eq!((t.commits, t.merges, t.people), (8, 1, 2));
    assert_eq!(t.first_commit, Some(EPOCH + 3 * 3600 + 45 * 60));
    assert_eq!(t.last_commit, Some(EPOCH + 6 * DAY + 13 * 3600));
    assert_eq!(
        (t.files, t.code_files, t.code_lines, t.prose_lines),
        (3, 2, 30, 5)
    );
    assert_eq!(t.generated_files, 1);
}

/// At HEAD: src/a.rs 100 lines, src/b.rs 50, src/deep/c.rs 30,
/// docs/guide.md 20 and README.md 10, and a lockfile no person wrote. Day 0,
/// Alice: a and c. Day 1, Alice: a. Day 2, Bob: b and the guide. Day 3, Bob:
/// the guide. Day 4, Carol: only the lockfile. Day 5, Alice: the README.
/// Day 6, Alice merges and resolves a.rs: a touch, but not a counted commit.
fn tree() -> commitscape_core::Index {
    index(
        &[
            c(0, "alice@x.org", &["src/a.rs", "src/deep/c.rs"]),
            c(1, "alice@x.org", &["src/a.rs"]),
            c(2, "bob@x.org", &["src/b.rs", "docs/guide.md"]),
            c(3, "bob@x.org", &["docs/guide.md"]),
            c(4, "carol@x.org", &["Cargo.lock"]),
            c(5, "alice@x.org", &["README.md"]),
            merge(6, "alice@x.org", &["src/a.rs"]),
        ],
        &[
            h("src/a.rs", 100, 5),
            h("src/b.rs", 50, 5),
            h("src/deep/c.rs", 30, 5),
            support::prose("docs/guide.md", 20, 0),
            support::prose("README.md", 10, 0),
            support::generated("Cargo.lock", 900, 0),
        ],
    )
}

#[test]
fn the_map_sizes_each_directory_by_its_lines_and_heats_it_by_its_commits() {
    let idx = tree();
    let map = analysis(&idx).code_map();
    let row = |path: &str| {
        let node = map
            .nodes
            .iter()
            .find(|n| n.path == path)
            .unwrap_or_else(|| panic!("{path} is on the map"));
        let owner = node.owner.map(|o| {
            let who = idx.authors.get(o.author).map(|a| a.email.to_string());
            (who.unwrap_or_default(), o.commits)
        });
        (
            node.lines,
            node.files,
            node.churn,
            owner,
            (node.last_touched - EPOCH) / DAY,
        )
    };
    let alice = |n| Some(("alice@x.org".to_string(), n));
    let bob = |n| Some(("bob@x.org".to_string(), n));
    assert_eq!(
        row(""),
        (210, 5, 5, alice(3), 6),
        "Carol's commit touched no mapped file"
    );
    assert_eq!(row("src/"), (180, 3, 3, alice(2), 6));
    assert_eq!(row("src/deep/"), (30, 1, 1, alice(1), 0));
    assert_eq!(row("docs/"), (20, 1, 2, bob(2), 3));
    assert_eq!(row("src/a.rs"), (100, 1, 2, alice(2), 6));
    assert_eq!(row("README.md"), (10, 1, 1, alice(1), 5));

    let root = map.nodes.first().expect("the root");
    let children: Vec<&str> = root
        .children
        .iter()
        .filter_map(|&i| map.nodes.get(i))
        .map(|n| n.name.as_str())
        .collect();
    assert_eq!(children, vec!["src", "docs", "README.md"], "largest first");
}

#[test]
fn a_persons_work_is_the_files_they_changed_most() {
    // Alice: a.rs twice, then the README and c.rs once each, by path on a
    // tie. Bob: the guide twice and b.rs once.
    let idx = tree();
    let a = analysis(&idx);
    let work = |email: &str| -> Vec<(String, u32)> {
        a.work_of(person(&idx, email))
            .iter()
            .map(|c| (idx.paths.path_lossy(c.file), c.commits))
            .collect()
    };
    assert_eq!(
        work("alice@x.org"),
        vec![
            ("src/a.rs".to_string(), 2),
            ("README.md".to_string(), 1),
            ("src/deep/c.rs".to_string(), 1),
        ]
    );
    assert_eq!(
        work("bob@x.org"),
        vec![
            ("docs/guide.md".to_string(), 2),
            ("src/b.rs".to_string(), 1)
        ]
    );
}
