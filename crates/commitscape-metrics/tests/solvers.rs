//! The problem-solvers, `check`, `who` and `health`, as Analysis methods
//! over hand-built histories whose answers are worked out in the comments.

#![allow(clippy::expect_used)]

mod support;

use commitscape_metrics::{
    Analysis, Answers, Expert, Forgotten, Health, Maintainer, Options, Releases, Trend, Window,
};
use support::{c, h, index, DAY, EPOCH};

#[test]
fn check_names_what_nearly_always_changes_with_the_files_changed() {
    // `src/schema.ts` changed on days 0 to 9. Every time but day 3 a new
    // migration came with it, `migrations/000N.sql`: 9 of its 10 commits
    // changed a file in `migrations/`, never the same one twice. Every time
    // but days 3 and 6, `src/types.ts` came too: 8 of 10. `README.md` came
    // on days 1 and 2: 2 of 10, too few to say.
    let migrations: Vec<String> = (0..10).map(|d| format!("migrations/{d:04}.sql")).collect();
    let mut touched: Vec<Vec<&str>> = Vec::new();
    for (day, migration) in migrations.iter().enumerate() {
        let mut t = vec!["src/schema.ts"];
        if day != 3 {
            t.push(migration.as_str());
        }
        if day != 3 && day != 6 {
            t.push("src/types.ts");
        }
        if day == 1 || day == 2 {
            t.push("README.md");
        }
        touched.push(t);
    }
    let commits: Vec<_> = touched
        .iter()
        .enumerate()
        .map(|(day, t)| c(day as i64, "ann@x.org", t))
        .collect();
    let head: Vec<_> = ["src/schema.ts", "src/types.ts", "README.md"]
        .into_iter()
        .chain(migrations.iter().map(String::as_str))
        .map(|p| h(p, 10, 0))
        .collect();
    let idx = index(&commits, &head);
    let a =
        Analysis::new(&idx, Window::all(EPOCH + 20 * DAY), Options::default()).expect("analysis");

    let found = |missing: &str, folder: bool, together: u32| Forgotten {
        missing: missing.to_string(),
        folder,
        because: "src/schema.ts".to_string(),
        together,
        of: 10,
    };
    assert_eq!(
        a.forgotten(&["src/schema.ts"]),
        vec![
            found("migrations/", true, 9),
            found("src/types.ts", false, 8)
        ]
    );
    // Changing both, only the migration is missing.
    assert_eq!(
        a.forgotten(&["src/schema.ts", "src/types.ts"]),
        vec![found("migrations/", true, 9)]
    );
    // Adding a migration too, nothing is.
    assert_eq!(
        a.forgotten(&["src/schema.ts", "src/types.ts", "migrations/0010.sql"]),
        vec![]
    );
    // README.md changed only twice: too little history to say anything.
    assert_eq!(a.forgotten(&["README.md"]), vec![]);
}

#[test]
fn check_takes_no_evidence_from_commits_of_more_than_twenty_files() {
    // `a.ts` and `b.ts` changed together five times, but each time in a
    // commit of 22 files (a squashed pull request): nothing is said.
    // Five more commits change `a.ts` with `c.ts` alone, which is said.
    let filler: Vec<String> = (0..20).map(|n| format!("pkg/f{n}.ts")).collect();
    let big: Vec<&str> = ["a.ts", "b.ts"]
        .into_iter()
        .chain(filler.iter().map(String::as_str))
        .collect();
    let mut commits: Vec<_> = (0..5).map(|d| c(d, "ann@x.org", &big)).collect();
    commits.extend((5..10).map(|d| c(d, "ann@x.org", &["a.ts", "c.ts"])));
    let idx = index(
        &commits,
        &[h("a.ts", 1, 0), h("b.ts", 1, 0), h("c.ts", 1, 0)],
    );
    let a =
        Analysis::new(&idx, Window::all(EPOCH + 20 * DAY), Options::default()).expect("analysis");
    assert_eq!(
        a.forgotten(&["a.ts"]),
        vec![Forgotten {
            missing: "c.ts".to_string(),
            folder: false,
            because: "a.ts".to_string(),
            together: 5,
            of: 5,
        }]
    );
}

fn person(idx: &commitscape_core::Index, email: &str) -> commitscape_core::AuthorId {
    idx.authors
        .iter()
        .find(|(_, a)| a.email == email)
        .map(|(id, _)| id)
        .expect("the person exists")
}

#[test]
fn who_ranks_by_how_much_and_how_recently_and_names_someone_still_here() {
    // Asked on day 400 about `src/api/`. Ann changed it 14 times on days 0
    // to 13 and has not committed since. Bob changed it 4 times on days 300
    // to 303 and still commits elsewhere (`docs/`, day 390). Cal changed it
    // once, on day 395.
    //
    // Each commit counts half as much for every 180 days of age. Ann's are
    // 387 to 400 days old, about 0.22 each, 3.0 in all; Bob's 97 to 100
    // days, about 0.68 each, 2.7; Cal's 5 days, 0.98. So Ann, Bob, Cal. Ann
    // was last seen 387 days ago, more than 90: ask Bob instead, the first
    // who still commits.
    let mut commits: Vec<_> = (0..14)
        .map(|d| c(d, "ann@x.org", &["src/api/a.ts"]))
        .collect();
    commits.extend((300..304).map(|d| c(d, "bob@x.org", &["src/api/b.ts"])));
    commits.push(c(390, "bob@x.org", &["docs/guide.md"]));
    commits.push(c(395, "cal@x.org", &["src/api/a.ts"]));
    let idx = index(
        &commits,
        &[
            h("src/api/a.ts", 1, 0),
            h("src/api/b.ts", 1, 0),
            h("docs/guide.md", 1, 0),
        ],
    );
    let end = EPOCH + 400 * DAY;
    let a = Analysis::new(&idx, Window::all(end), Options::default()).expect("analysis");
    let at = |day: i64| EPOCH + day * DAY;
    let who = a.who("src/api").expect("the folder is known");
    assert_eq!(who.path, "src/api/");
    assert_eq!(
        who.people,
        vec![
            Expert {
                author: person(&idx, "ann@x.org"),
                commits: 14,
                last_here: at(13),
                last_seen: at(13),
                active: false,
            },
            Expert {
                author: person(&idx, "bob@x.org"),
                commits: 4,
                last_here: at(303),
                last_seen: at(390),
                active: true,
            },
            Expert {
                author: person(&idx, "cal@x.org"),
                commits: 1,
                last_here: at(395),
                last_seen: at(395),
                active: true,
            },
        ]
    );
    assert_eq!(who.instead, Some(person(&idx, "bob@x.org")));
    // A file by its path; nothing for a path the repository never had.
    assert_eq!(a.who("docs/guide.md").map(|w| w.people.len()), Some(1));
    assert!(a.who("nowhere/").is_none());
    // The whole repository: Bob's docs commit, 10 days old, adds 0.96, so
    // he (3.7) comes before Ann (3.0), and nobody need be asked instead.
    let all = a.who("").expect("the repository is known");
    assert_eq!(all.path, "");
    assert_eq!(
        all.people.iter().map(|e| e.commits).collect::<Vec<_>>(),
        vec![5, 14, 1]
    );
    assert_eq!(all.instead, None);
}

#[test]
fn health_says_who_keeps_it_going_how_often_it_ships_and_where_it_is_heading() {
    // Seen on day 400. Ann: 20 commits on days 100 to 119, and 10 on days
    // 350 to 359. Bob: 2 on days 250 and 251, 4 on days 380 to 383. Cal: 2,
    // days 390 and 391. Dan: 5, days 230 to 234.
    //
    // The last 90 days (after day 310): Ann 10, Bob 4, Cal 2; with 3 or
    // more commits, Ann and Bob keep it going. The 90 before (after day
    // 220): Bob 2 and Dan 5. So 16 commits by 3 people, from 7 by 2.
    //
    // The last year (after day 35): Ann 30, Bob 6, Dan 5, Cal 2, 43 in all.
    // Over 80% is more than 34.4: Ann alone has 30, Ann and Bob 36. Bus
    // factor 2.
    //
    // Releases on days 10, 100, 200, 300 and 390: four in the last year, 100,
    // 100 and 90 days apart (typically 100), the last 10 days ago.
    //
    // Issues opened on days 380, 385, 390 and 395, answered after 2 hours,
    // 10 hours, never and 4 hours: 3 of 4, typically in 4 hours.
    let mut commits = Vec::new();
    commits.extend(
        (100..120)
            .chain(350..360)
            .map(|d| c(d, "ann@x.org", &["a.ts"])),
    );
    commits.extend([250, 251, 380, 381, 382, 383].map(|d| c(d, "bob@x.org", &["b.ts"])));
    commits.extend([390, 391].map(|d| c(d, "cal@x.org", &["c.ts"])));
    commits.extend((230..235).map(|d| c(d, "dan@x.org", &["d.ts"])));
    let idx = index(&commits, &[h("a.ts", 1, 0)]);
    let at = |day: i64| EPOCH + day * DAY;
    let a = Analysis::new(&idx, Window::all(at(400)), Options::default()).expect("analysis");
    let releases: Vec<(String, i64)> = [10, 100, 200, 300, 390]
        .iter()
        .enumerate()
        .map(|(n, &d)| (format!("v{n}"), at(d)))
        .collect();
    let hour = 3_600;
    let issues = [
        (at(380), Some(at(380) + 2 * hour)),
        (at(385), Some(at(385) + 10 * hour)),
        (at(390), None),
        (at(395), Some(at(395) + 4 * hour)),
    ];
    assert_eq!(
        a.health(&releases, Some(&issues)),
        Health {
            maintainers: vec![
                Maintainer {
                    author: person(&idx, "ann@x.org"),
                    commits: 10
                },
                Maintainer {
                    author: person(&idx, "bob@x.org"),
                    commits: 4
                },
            ],
            bus_factor: Some(2),
            releases: Releases {
                in_year: 4,
                typical_gap_days: Some(100),
                since_last_days: Some(10),
            },
            answers: Some(Answers {
                asked: 4,
                answered: 3,
                typical_hours: Some(4.0),
            }),
            trend: Trend {
                commits: 16,
                commits_before: 7,
                people: 3,
                people_before: 2,
            },
        }
    );
}

#[test]
fn wrapped_is_one_persons_year_across_every_repository() {
    use commitscape_metrics::{wrapped, DayCount, LanguageYear, RepoYear, StreakYear, Wrapped};
    // 2024, for Ann, in two repositories. In `app`, at 10:00 on her clock:
    // `a.rs` on days 10, 11 and 12, 10 lines added and 2 removed each
    // time, and `a.py` twice on day 50, 5 lines added each. Bob commits on
    // day 11 and Ann on the last day of 2023, none counted. In `lib`:
    // `b.rs` on day 13 at 10:00 (3 added, 1 removed) and on day 50 at
    // 23:00 (1 and 1).
    //
    // 7 commits: 5 in app, 2 in lib, on 5 days. Day 50 is the busiest,
    // with 3. Days 10 to 13 are a streak of 4, across both. One commit of
    // seven came at night (22:00 to 05:00), at 23:00. Lines: 30 + 10 + 3 +
    // 1 = 44 added, 6 + 2 = 8 removed; Rust 34 of them, Python 10.
    let day = |d: i64, file: &'static [&'static str], lines: (u32, u32), hour: i64| {
        c(d, "ann@x.org", file).lines(&[lines]).local(hour, 0, 0)
    };
    let mut app = vec![
        day(10, &["a.rs"], (10, 2), 10),
        day(11, &["a.rs"], (10, 2), 10),
        day(12, &["a.rs"], (10, 2), 10),
        day(50, &["a.py"], (5, 0), 10),
        day(50, &["a.py"], (5, 0), 10),
        day(-1, &["a.rs"], (1, 0), 10),
    ];
    app.push(
        c(11, "bob@x.org", &["a.rs"])
            .lines(&[(7, 7)])
            .local(10, 0, 0),
    );
    // 20:00 on 31 December 2023 in New York is 01:00 on 1 January in UTC,
    // inside the Window, but on 2023 by Ann's clock: not counted either.
    app.push(
        c(-1, "ann@x.org", &["a.rs"])
            .lines(&[(9, 9)])
            .local(20, 0, -300),
    );
    let lib = vec![
        day(13, &["b.rs"], (3, 1), 10),
        day(50, &["b.rs"], (1, 1), 23),
    ];
    // Wide enough for every clock's 2024.
    let year = Window {
        from: Some(EPOCH - DAY),
        to: EPOCH + 367 * DAY,
    };
    let of = |commits: &[support::C<'_>]| {
        let idx = index(commits, &[h("a.rs", 1, 0)]);
        let a = Analysis::new(&idx, year, Options::default()).expect("analysis");
        let jan = EPOCH / DAY;
        a.year_in(&[person(&idx, "ann@x.org")], jan..=jan + 365, &|_| true)
    };
    let repos = vec![("app".to_string(), of(&app)), ("lib".to_string(), of(&lib))];
    let w = wrapped(&repos);
    let mut hours = [0u32; 24];
    hours[10] = 6;
    hours[23] = 1;
    let jan = EPOCH / DAY;
    assert_eq!(
        w,
        Wrapped {
            commits: 7,
            active_days: 5,
            repositories: vec![
                RepoYear {
                    name: "app".to_string(),
                    commits: 5
                },
                RepoYear {
                    name: "lib".to_string(),
                    commits: 2
                },
            ],
            lines_added: Some(44),
            lines_removed: Some(8),
            languages: vec![
                LanguageYear {
                    name: "Rust".to_string(),
                    lines: 34
                },
                LanguageYear {
                    name: "Python".to_string(),
                    lines: 10
                },
            ],
            busiest_day: Some(DayCount {
                day: jan + 50,
                commits: 3
            }),
            streak: Some(StreakYear {
                first_day: jan + 10,
                days: 4
            }),
            night: 1,
            hours,
            days: [
                (jan + 10, 1),
                (jan + 11, 1),
                (jan + 12, 1),
                (jan + 13, 1),
                (jan + 50, 3)
            ]
            .into_iter()
            .collect(),
        }
    );
}
