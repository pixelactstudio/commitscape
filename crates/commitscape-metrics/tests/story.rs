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
/// 23:40 in India, Alice, a fix. Wednesday 10:00, 10:30
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
            .kind(CommitKind::Fix),
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
}

#[test]
fn contributors_rank_by_commits_with_their_days() {
    // Bob: 4 commits on Wednesday and Saturday. Alice: 3 on Monday, Tuesday
    // and Sunday; her merge does not count.
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
                minutes(2, 10, 0),
                minutes(5, 2, 5)
            ),
            (
                "alice@x.org".to_string(),
                3,
                3,
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

#[test]
fn kinds_of_work_are_judged_from_the_files_first_then_the_message() {
    use commitscape_metrics::Work;
    // One commit each, in order:
    //   a test file alone, whatever the message says       -> tests
    //   two prose files, though the message says feat       -> docs
    //   a manifest and a lockfile                           -> dependencies
    //   a workflow                                          -> CI
    //   code and a test, "fix:"                             -> the message: fix
    //   code, no convention                                 -> unclassified
    //   code, "feat(ui):"                                   -> feature
    let idx = index(
        &[
            c(0, "a@x.org", &["tests/parse_test.rs"]),
            c(1, "a@x.org", &["README.md", "docs/guide.md"]).kind(CommitKind::Feature),
            c(2, "a@x.org", &["package.json", "pnpm-lock.yaml"]),
            c(3, "a@x.org", &[".github/workflows/ci.yml"]),
            c(4, "a@x.org", &["src/a.rs", "tests/a.rs"]).kind(CommitKind::Fix),
            c(5, "a@x.org", &["src/a.rs"]),
            c(6, "a@x.org", &["src/b.rs"]).kind(CommitKind::Feature),
        ],
        &[h("src/a.rs", 10, 2)],
    );
    let pulse = Analysis::new(&idx, Window::all(EPOCH + 7 * DAY), options())
        .expect("analysis")
        .pulse(None);
    let work: Vec<(Work, u32)> = pulse
        .work
        .iter()
        .filter(|w| w.commits > 0)
        .map(|w| (w.work, w.commits))
        .collect();
    assert_eq!(
        work,
        vec![
            (Work::Feature, 1),
            (Work::Fix, 1),
            (Work::Tests, 1),
            (Work::Docs, 1),
            (Work::Dependencies, 1),
            (Work::Ci, 1),
            (Work::Unclassified, 1),
        ]
    );
}

#[test]
fn commits_over_time_are_split_among_the_top_people_and_everyone_else() {
    // Ann 3 commits (days 0, 0, 2), Ben 2 (days 1, 3), Cal 1 (day 3), and a
    // bot 1 (day 2). With the top two: Ann, Ben, then everyone else.
    let idx = index(
        &[
            c(0, "ann@x.org", &["a.rs"]),
            c(0, "ann@x.org", &["a.rs"]),
            c(1, "ben@x.org", &["a.rs"]),
            c(2, "ann@x.org", &["a.rs"]),
            c(2, "renovate[bot] <bot@x.org>", &["Cargo.lock"]),
            c(3, "ben@x.org", &["a.rs"]),
            c(3, "cal@x.org", &["a.rs"]),
        ],
        &[h("a.rs", 10, 2)],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 3 * DAY + 1), options()).expect("analysis");
    let split = a.commits_by_person(2);
    let email = |p| {
        idx.authors
            .get(p)
            .map(|a| a.email.to_string())
            .unwrap_or_default()
    };
    assert_eq!(
        split.people.iter().map(|&p| email(p)).collect::<Vec<_>>(),
        vec!["ann@x.org", "ben@x.org"]
    );
    assert_eq!(split.first_day, a.pulse(None).first_day);
    assert_eq!(
        split.days,
        vec![vec![2, 0, 0], vec![0, 1, 0], vec![1, 0, 1], vec![0, 1, 1]]
    );
}

#[test]
fn the_timeline_tells_the_projects_life_in_moments() {
    use commitscape_metrics::Moment;
    // Ann writes JavaScript on days 0 to 19, one commit a day and two more
    // on day 5, each adding 100 lines: 2,200 lines of JavaScript in the
    // first quarter of 2024. Bob writes TypeScript on days 100 to 129, 50
    // lines a day, 1,500 in the second quarter, and on day 120 also deletes
    // 900 lines of old JavaScript. Cal commits once, on day 300. v1.0 is
    // tagged on day 50. The Window runs to day 400.
    //
    // Ann (22 of 54 commits) and Bob (31) each made over 5%; Cal (1) did
    // not, so only they join and leave. Both left more than 90 days before
    // day 400: Ann's last commit is day 19, Bob's day 129. The quiet
    // stretches of 30 days or more are 19 to 100 (81 days) and 129 to 300
    // (171). The busiest day is day 5, with 3.
    let mut commits = Vec::new();
    for day in 0..20 {
        commits.push(c(day, "ann@x.org", &["src/app.js"]).lines(&[(100, 0)]));
        if day == 5 {
            commits.push(c(day, "ann@x.org", &["src/app.js"]).lines(&[(100, 0)]));
            commits.push(c(day, "ann@x.org", &["src/app.js"]).lines(&[(100, 0)]));
        }
    }
    for day in 100..130 {
        commits.push(c(day, "bob@x.org", &["src/app.ts"]).lines(&[(50, 0)]));
        if day == 120 {
            commits.push(c(day, "bob@x.org", &["src/old.js"]).lines(&[(0, 900)]));
        }
    }
    commits.push(c(300, "cal@x.org", &["src/app.ts"]).lines(&[(1, 1)]));
    let idx = index(&commits, &[h("src/app.ts", 1500, 2)]);
    let a = Analysis::new(&idx, Window::all(EPOCH + 400 * DAY), options()).expect("analysis");
    let at = |day: i64| EPOCH + day * DAY;
    let who = |email: &str| person(&idx, email);
    let releases = vec![("v1.0".to_string(), at(50))];
    assert_eq!(
        a.timeline(&releases),
        vec![
            Moment::FirstCommit {
                time: at(0),
                author: Some(who("ann@x.org"))
            },
            Moment::BusiestDay {
                time: at(5),
                commits: 3
            },
            Moment::Left {
                time: at(19),
                author: who("ann@x.org")
            },
            Moment::Quiet {
                time: at(19),
                until: at(100)
            },
            Moment::Release {
                time: at(50),
                name: "v1.0".to_string()
            },
            Moment::LanguageShift {
                time: at(91),
                from: "JavaScript",
                to: "TypeScript"
            },
            Moment::Joined {
                time: at(100),
                author: who("bob@x.org")
            },
            Moment::Cleanup {
                time: at(120),
                author: Some(who("bob@x.org")),
                removed: 900
            },
            Moment::Left {
                time: at(129),
                author: who("bob@x.org")
            },
            Moment::Quiet {
                time: at(129),
                until: at(300)
            },
        ]
    );
}

#[test]
fn a_window_that_starts_later_tells_no_joining_and_no_first_commit() {
    use commitscape_metrics::Moment;
    // The history above, seen from day 110 to day 400. Bob's first commit
    // was day 100, before the Window, so he does not join in it, and its
    // first commit is not the project's. In it: Bob one commit a day on
    // days 110 to 129 and two on day 120 (the busiest, the clean-up of 900
    // lines), then Cal on day 300. Bob left after day 129; the quiet runs
    // from 129 to 300. Only TypeScript is written, so no language shift.
    let mut commits = Vec::new();
    for day in 0..20 {
        commits.push(c(day, "ann@x.org", &["src/app.js"]).lines(&[(100, 0)]));
    }
    for day in 100..130 {
        commits.push(c(day, "bob@x.org", &["src/app.ts"]).lines(&[(50, 0)]));
        if day == 120 {
            commits.push(c(day, "bob@x.org", &["src/old.js"]).lines(&[(0, 900)]));
        }
    }
    commits.push(c(300, "cal@x.org", &["src/app.ts"]).lines(&[(1, 1)]));
    let idx = index(&commits, &[h("src/app.ts", 1500, 2)]);
    let at = |day: i64| EPOCH + day * DAY;
    let window = Window {
        from: Some(at(110)),
        to: at(400),
    };
    let a = Analysis::new(&idx, window, options()).expect("analysis");
    let bob = person(&idx, "bob@x.org");
    assert_eq!(
        a.timeline(&[]),
        vec![
            Moment::BusiestDay {
                time: at(120),
                commits: 2
            },
            Moment::Cleanup {
                time: at(120),
                author: Some(bob),
                removed: 900
            },
            Moment::Left {
                time: at(129),
                author: bob
            },
            Moment::Quiet {
                time: at(129),
                until: at(300)
            },
        ]
    );
}
