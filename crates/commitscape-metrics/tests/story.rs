#![allow(clippy::expect_used)]

mod support;

use commitscape_core::CommitKind;
use commitscape_metrics::{Analysis, Options, Window};
use support::{c, h, index, merge, DAY, EPOCH};

const MONDAY: i64 = 19_723;

fn options() -> Options {
    Options {
        max_changeset_size: 3,
        ownership_min_commits: 1,
        ..Options::default()
    }
}

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
    Analysis::new(idx, Window::all(EPOCH + 6 * DAY + 23 * 3600), options())
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
    );
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
    let idx = week();
    let pulse = analysis(&idx).pulse(Some(person(&idx, "bob@x.org")));
    assert_eq!(pulse.commits, 4);
    assert_eq!(pulse.first_day, MONDAY + 2);
    assert_eq!(pulse.days, vec![3, 0, 0, 1, 0], "Wednesday to Sunday");
    assert_eq!(pulse.longest_streak.map(|s| s.days), Some(1));
}

#[test]
fn contributors_rank_by_commits_with_their_days() {
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
    let pulse = Analysis::new(&idx, Window::all(EPOCH + 7 * DAY), options()).pulse(None);
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
    let a = Analysis::new(&idx, Window::all(EPOCH + 3 * DAY + 1), options());
    let split = a.commits_by_person_in(&a.pulse(None), &a.contributors(), 2);
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
    let a = Analysis::new(&idx, Window::all(EPOCH + 400 * DAY), options());
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
    let a = Analysis::new(&idx, window, options());
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
