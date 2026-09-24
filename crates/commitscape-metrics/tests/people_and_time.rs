//! Staleness, Ownership, Bus Factor, Code Age and the suspected-duplicates
//! hint, over hand-built indexes whose values are worked out in the comments.

#![allow(clippy::expect_used)]

mod support;

use commitscape_core::AuthorId;
use commitscape_metrics::{Age, Analysis, Options, Window};
use support::{c, generated, h, index, index_with_suspects, merge, prose, DAY, EPOCH};

fn options() -> Options {
    Options {
        max_changeset_size: 3,
        ownership_min_commits: 1,
        ..Options::default()
    }
}

fn path(idx: &commitscape_core::Index, file: commitscape_core::FileId) -> String {
    idx.paths.path_lossy(file)
}

#[test]
fn staleness_puts_every_file_in_an_age_bucket() {
    // Anchored at day 400. Last touched: week.rs day 399 (1 day ago),
    // month.rs day 380 (20), quarter.rs day 320 (80), year.rs day 100 (300),
    // older.rs day 0 (400).
    let idx = index(
        &[
            c(0, "a@x.org", &["older.rs"]),
            c(100, "a@x.org", &["year.rs"]),
            c(320, "a@x.org", &["quarter.rs"]),
            c(380, "a@x.org", &["month.rs"]),
            c(399, "a@x.org", &["week.rs"]),
        ],
        &[
            h("older.rs", 1, 0),
            h("year.rs", 1, 0),
            h("quarter.rs", 1, 0),
            h("month.rs", 1, 0),
            h("week.rs", 1, 0),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 400 * DAY), options()).expect("covered");
    let staleness = a.staleness();
    let counts: Vec<(Age, u32)> = staleness.buckets.iter().map(|b| (b.age, b.files)).collect();
    assert_eq!(
        counts,
        vec![
            (Age::Week, 1),
            (Age::Month, 1),
            (Age::Quarter, 1),
            (Age::Year, 1),
            (Age::Older, 1)
        ]
    );
    let stalest: Vec<(String, i64)> = staleness
        .files
        .iter()
        .map(|f| (path(&idx, f.file), f.days))
        .collect();
    assert_eq!(
        stalest.first(),
        Some(&("older.rs".to_string(), 400)),
        "stalest first"
    );
}

#[test]
fn a_staleness_bucket_lists_its_own_files_stalest_first() {
    // Anchored at day 400. The Year bucket holds year.rs (300 days) and
    // later.rs (200 days); older.rs (400) and week.rs (1) are in others.
    let idx = index(
        &[
            c(0, "a@x.org", &["older.rs"]),
            c(100, "a@x.org", &["year.rs"]),
            c(200, "a@x.org", &["later.rs"]),
            c(399, "a@x.org", &["week.rs"]),
        ],
        &[
            h("older.rs", 1, 0),
            h("year.rs", 1, 0),
            h("later.rs", 1, 0),
            h("week.rs", 1, 0),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 400 * DAY), options()).expect("covered");
    let files = |age| -> Vec<(String, i64)> {
        a.stale_files(age)
            .iter()
            .map(|f| (path(&idx, f.file), f.days))
            .collect()
    };
    assert_eq!(
        files(Age::Year),
        vec![("year.rs".to_string(), 300), ("later.rs".to_string(), 200)]
    );
    assert_eq!(files(Age::Week), vec![("week.rs".to_string(), 1)]);
    assert_eq!(files(Age::Quarter), vec![]);
}

#[test]
fn staleness_counts_bulk_commits_and_merge_resolutions() {
    // Days 0 and 1 touch a.rs normally; day 5 is a bulk commit (four files at
    // a threshold of three) and day 6 a merge resolving b.rs. A file that was
    // touched was touched.
    let idx = index(
        &[
            c(0, "a@x.org", &["a.rs", "b.rs"]),
            c(1, "a@x.org", &["a.rs"]),
            c(5, "a@x.org", &["a.rs", "x.rs", "y.rs", "z.rs"]),
            merge(6, "a@x.org", &["b.rs"]),
        ],
        &[
            h("a.rs", 1, 0),
            h("b.rs", 1, 0),
            h("x.rs", 1, 0),
            h("y.rs", 1, 0),
            h("z.rs", 1, 0),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 6 * DAY), options()).expect("covered");
    let last = |p: &str| {
        a.staleness()
            .files
            .iter()
            .find(|f| path(&idx, f.file) == p)
            .map(|f| f.last_touched)
    };
    assert_eq!(last("a.rs"), Some(EPOCH + 5 * DAY));
    assert_eq!(last("b.rs"), Some(EPOCH + 6 * DAY));
}

/// alpha/: Alice 9 commits, Bob 1. beta/: Carol 5, Bob 5.
/// gamma/: Dave 6, Erin 3, Frank 1.
fn team() -> commitscape_core::Index {
    let mut commits = Vec::new();
    for day in 0..9 {
        commits.push(c(day, "alice@x.org", &["alpha/f.rs"]));
    }
    commits.push(c(9, "bob@x.org", &["alpha/f.rs"]));
    for day in 10..15 {
        commits.push(c(day, "carol@x.org", &["beta/g.rs"]));
    }
    for day in 15..20 {
        commits.push(c(day, "bob@x.org", &["beta/g.rs"]));
    }
    for day in 20..26 {
        commits.push(c(day, "dave@x.org", &["gamma/h.rs"]));
    }
    for day in 26..29 {
        commits.push(c(day, "erin@x.org", &["gamma/h.rs"]));
    }
    commits.push(c(29, "frank@x.org", &["gamma/h.rs"]));
    // None of these may count: a merge, a bulk commit, and a commit that
    // only touched a lockfile.
    commits.push(merge(30, "bot@x.org", &["alpha/f.rs"]));
    commits.push(c(
        31,
        "bot@x.org",
        &["alpha/f.rs", "beta/g.rs", "gamma/h.rs", "alpha/z.rs"],
    ));
    commits.push(c(32, "bot@x.org", &["alpha/pnpm-lock.yaml"]));
    index(
        &commits,
        &[
            h("alpha/f.rs", 1, 0),
            h("alpha/z.rs", 1, 0),
            generated("alpha/pnpm-lock.yaml", 1, 0),
            h("beta/g.rs", 1, 0),
            h("gamma/h.rs", 1, 0),
        ],
    )
}

#[test]
fn ownership_is_commit_weighted_per_directory_and_bus_factor_follows_the_80_percent_line() {
    let idx = team();
    let a = Analysis::new(&idx, Window::all(EPOCH + 40 * DAY), options()).expect("covered");
    let ownership = a.ownership().directories;
    let dir = |d: &str| {
        ownership
            .iter()
            .find(|o| o.dir == d.as_bytes())
            .expect("the directory is reported")
    };
    let shares = |d: &str| -> Vec<(String, u32)> {
        dir(d)
            .owners
            .iter()
            .map(|o| {
                let who = idx.authors.get(o.author).map(|p| p.email.to_string());
                (who.unwrap_or_default(), o.commits)
            })
            .collect()
    };

    // alpha/: 9 of 10 is 90%, over the line on its own.
    assert_eq!(
        shares("alpha/"),
        vec![("alice@x.org".into(), 9), ("bob@x.org".into(), 1)]
    );
    assert_eq!(dir("alpha/").commits, 10);
    assert_eq!(dir("alpha/").bus_factor, 1);
    // beta/: 50/50. Neither alone is over 80%; together they are.
    assert_eq!(dir("beta/").bus_factor, 2);
    // gamma/: 60/30/10. 60% alone is not over the line, 90% is.
    assert_eq!(dir("gamma/").bus_factor, 2);
    // The root holds all 30 counted commits: Alice 9, Bob 6, Dave 6, Carol 5,
    // Erin 3, Frank 1. 9+6+6+5 = 26 is 86.7%, the first over 80%.
    assert_eq!(dir("").commits, 30);
    assert_eq!(dir("").bus_factor, 4);
}

#[test]
fn a_files_owners_are_who_made_its_counted_commits() {
    // alpha/f.rs: Alice 9 and Bob 1. The bot's merge and bulk commit touched
    // it too, and count for neither.
    let idx = team();
    let a = Analysis::new(&idx, Window::all(EPOCH + 40 * DAY), options()).expect("covered");
    let file = idx.paths.get(b"alpha/f.rs").expect("the file exists");
    let owners: Vec<(String, u32)> = a
        .owners_of(file)
        .iter()
        .map(|o| {
            let who = idx.authors.get(o.author).map(|p| p.email.to_string());
            (who.unwrap_or_default(), o.commits)
        })
        .collect();
    assert_eq!(
        owners,
        vec![("alice@x.org".into(), 9), ("bob@x.org".into(), 1)]
    );
}

#[test]
fn directories_with_too_few_commits_are_not_reported() {
    let idx = team();
    let options = Options {
        ownership_min_commits: 11,
        ..options()
    };
    let a = Analysis::new(&idx, Window::all(EPOCH + 40 * DAY), options).expect("covered");
    let dirs: Vec<Vec<u8>> = a
        .ownership()
        .directories
        .into_iter()
        .map(|o| o.dir)
        .collect();
    assert_eq!(dirs, vec![b"".to_vec()], "only the root has more than ten");
}

#[test]
fn ownership_counts_every_directory_even_past_the_ranking_limit() {
    // 1,001 directories, each with one commit by its own person: each is held
    // by one person. The root holds all 1,001 commits, one each, so it takes
    // 801 people to pass 80%. The ranking keeps 1,000 rows; the counts cover
    // all 1,002 directories.
    let paths: Vec<String> = (0..1001).map(|i| format!("d{i:04}/f.rs")).collect();
    let people: Vec<String> = (0..1001).map(|i| format!("p{i}@x.org")).collect();
    let touched: Vec<[&str; 1]> = paths.iter().map(|p| [p.as_str()]).collect();
    let commits: Vec<_> = touched
        .iter()
        .zip(&people)
        .enumerate()
        .map(|(day, (t, who))| c(day as i64, who, t))
        .collect();
    let head: Vec<_> = paths.iter().map(|p| h(p, 1, 0)).collect();
    let idx = index(&commits, &head);
    let a = Analysis::new(&idx, Window::all(EPOCH + 1001 * DAY), options()).expect("covered");

    let ownership = a.ownership();
    assert_eq!(ownership.directory_count, 1002);
    assert_eq!(
        ownership.bus_factor_one, 1001,
        "every directory but the root"
    );
    assert_eq!(ownership.directories.len(), 1000, "the ranking limit");
}

#[test]
fn code_age_counts_each_code_files_lines_in_the_quarter_it_appeared() {
    // 2024-01-01 is day 0: q1.rs appears in 2024 Q1, q2.rs on day 100
    // (2024-04-10, Q2), and q2b.rs on day 120 (2024-04-30, Q2). The README is
    // prose, not code.
    let idx = index(
        &[
            c(0, "a@x.org", &["q1.rs", "README.md"]),
            c(100, "a@x.org", &["q2.rs"]),
            c(120, "a@x.org", &["q2b.rs", "q1.rs"]),
        ],
        &[
            h("q1.rs", 100, 0),
            h("q2.rs", 30, 0),
            h("q2b.rs", 20, 0),
            prose("README.md", 500, 0),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 120 * DAY), options()).expect("covered");
    let age: Vec<(i64, u32, u64, u32)> = a
        .code_age()
        .iter()
        .map(|q| (q.year, q.quarter, q.lines, q.files))
        .collect();
    assert_eq!(age, vec![(2024, 1, 100, 1), (2024, 2, 50, 2)]);

    // Behind 2024 Q2's 50 lines: q2.rs with 30 and q2b.rs with 20.
    let files: Vec<(String, u32)> = a
        .code_age_files(2024, 2)
        .iter()
        .map(|f| (path(&idx, f.file), f.loc))
        .collect();
    assert_eq!(files, vec![("q2.rs".into(), 30), ("q2b.rs".into(), 20)]);
    assert!(a.code_age_files(2023, 4).is_empty());
}

#[test]
fn suspected_duplicates_come_with_the_mailmap_lines_that_would_join_them() {
    // Two signatures with the same name and different emails: surfaced, not
    // merged. The suggestion keeps the one with more commits.
    let idx = index_with_suspects(
        &[
            c(0, "Dana Dev <dana@home.example>", &["a.rs"]),
            c(1, "Dana Dev <dana@work.example>", &["a.rs"]),
            c(2, "Dana Dev <dana@work.example>", &["a.rs"]),
        ],
        &[h("a.rs", 1, 0)],
        vec![vec![AuthorId(0), AuthorId(1)]],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 2 * DAY), options()).expect("covered");
    let hints = a.suspected_duplicates();
    assert_eq!(hints.len(), 1);
    let hint = hints.first().expect("one hint");
    assert_eq!(
        hint.people,
        vec![AuthorId(1), AuthorId(0)],
        "most commits first"
    );
    assert_eq!(hint.commits, vec![2, 1]);
    assert_eq!(
        a.mailmap_for(hint),
        "Dana Dev <dana@work.example> <dana@home.example>\n"
    );
}

#[test]
fn bots_are_left_out_of_the_people_and_listed_on_their_own() {
    // alpha/: Alice 3 commits, dependabot 5. Without the bot Alice holds all
    // of alpha/, so its bus factor is 1 and she is its only owner. The bot's
    // five commits still happened: the Pulse counts all eight.
    let idx = index(
        &[
            c(1, "alice@x.org", &["alpha/a.rs"]),
            c(2, "dependabot[bot] <bot@x.org>", &["alpha/a.rs"]),
            c(3, "dependabot[bot] <bot@x.org>", &["alpha/a.rs"]),
            c(4, "alice@x.org", &["alpha/a.rs"]),
            c(5, "dependabot[bot] <bot@x.org>", &["alpha/a.rs"]),
            c(6, "dependabot[bot] <bot@x.org>", &["alpha/a.rs"]),
            c(7, "alice@x.org", &["alpha/a.rs"]),
            c(8, "dependabot[bot] <bot@x.org>", &["alpha/a.rs"]),
        ],
        &[h("alpha/a.rs", 10, 2)],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 9 * DAY), options()).expect("analysis");
    let name = |id: AuthorId| idx.authors.get(id).map(|p| p.name.to_string());

    let people: Vec<_> = a
        .contributors()
        .iter()
        .map(|c| (name(c.author), c.commits))
        .collect();
    assert_eq!(people, vec![(Some("alice@x.org".to_string()), 3)]);
    let bots: Vec<_> = a
        .bots()
        .iter()
        .map(|c| (name(c.author), c.commits))
        .collect();
    assert_eq!(bots, vec![(Some("dependabot[bot]".to_string()), 5)]);

    let alpha = a
        .ownership()
        .directories
        .into_iter()
        .find(|d| d.dir == b"alpha/")
        .expect("alpha/ is reported");
    assert_eq!(alpha.bus_factor, 1);
    assert_eq!(alpha.commits, 3);
    let file = idx.head.first().map(|h| h.file).expect("a file");
    assert_eq!(a.owners_of(file).len(), 1);
    assert_eq!(a.totals().people, 1);
    assert_eq!(a.pulse(None).commits, 8);
}

#[test]
fn a_folder_held_by_one_person_hides_its_subfolders_held_by_the_same_person() {
    // app/marketing/: Dev 9 of 10 commits (90%), bus factor 1; its src/
    // subfolder, 8 of 8 (100%), also Dev's: shown once, as the top folder.
    // app/api/: Ann 10 of 11 (91%); app/api/v2/, 1 of 1, Bob's: a
    // different person, so both are listed. app/: Dev 9, Pat 1, Ann 10 and
    // Bob 1 of 21, bus factor 2, so not listed at all.
    let mut commits = Vec::new();
    for day in 0..8 {
        commits.push(c(day, "dev@x.org", &["app/marketing/src/page.ts"]));
    }
    commits.push(c(8, "dev@x.org", &["app/marketing/index.ts"]));
    commits.push(c(9, "pat@x.org", &["app/marketing/index.ts"]));
    for day in 10..20 {
        commits.push(c(day, "ann@x.org", &["app/api/server.ts"]));
    }
    commits.push(c(20, "bob@x.org", &["app/api/v2/routes.ts"]));
    let idx = index(
        &commits,
        &[
            h("app/marketing/src/page.ts", 10, 2),
            h("app/marketing/index.ts", 10, 2),
            h("app/api/server.ts", 10, 2),
            h("app/api/v2/routes.ts", 10, 2),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 30 * DAY), options()).expect("analysis");
    let mut held: Vec<String> = a
        .ownership()
        .held_alone()
        .iter()
        .map(|d| d.label())
        .collect();
    held.sort();
    assert_eq!(held, vec!["app/api/", "app/api/v2/", "app/marketing/"]);
}

#[test]
fn what_someone_works_on_leaves_out_manifests_and_lockfiles() {
    // Dev touched package.json in every one of four commits, Cargo.toml and
    // go.mod in one each: dependency bumps, not work on the code. What is
    // left is src/app.ts, three commits, and src/lib.rs, one. (No commit
    // passes the three-file bulk line.)
    let idx = index(
        &[
            c(0, "dev@x.org", &["package.json", "src/app.ts"]),
            c(
                1,
                "dev@x.org",
                &["package.json", "src/app.ts", "Cargo.toml"],
            ),
            c(2, "dev@x.org", &["package.json", "src/app.ts"]),
            c(3, "dev@x.org", &["package.json", "go.mod", "src/lib.rs"]),
        ],
        &[
            h("package.json", 30, 2),
            h("Cargo.toml", 20, 1),
            h("go.mod", 10, 1),
            h("src/app.ts", 100, 3),
            h("src/lib.rs", 50, 3),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 5 * DAY), options()).expect("analysis");
    let dev = a.contributors().first().map(|c| c.author).expect("dev");
    let work: Vec<_> = a
        .work_of(dev)
        .iter()
        .map(|w| (path(&idx, w.file), w.commits))
        .collect();
    assert_eq!(
        work,
        vec![("src/app.ts".to_string(), 3), ("src/lib.rs".to_string(), 1)]
    );
}

#[test]
fn a_folder_only_one_person_touched_names_who_could_take_it_over() {
    // Dev 12 commits in app/billing/, Ann 8 in app/api/, Bob 10 in lib/.
    // Each of those folders has one person. app/ has Dev 12 and Ann 8, the
    // root all three. Whoever else made the most commits in the nearest
    // folder around a silo with more than one person could take it over:
    // app/billing/ -> Ann (8 in app/), app/api/ -> Dev (12 in app/),
    // lib/ -> Dev (12 in the whole project). Largest first.
    let mut commits = Vec::new();
    for day in 0..12 {
        commits.push(c(day, "dev@x.org", &["app/billing/x.ts"]));
    }
    for day in 12..20 {
        commits.push(c(day, "ann@x.org", &["app/api/y.ts"]));
    }
    for day in 20..30 {
        commits.push(c(day, "bob@x.org", &["lib/z.rs"]));
    }
    let idx = index(
        &commits,
        &[
            h("app/billing/x.ts", 10, 2),
            h("app/api/y.ts", 10, 2),
            h("lib/z.rs", 10, 2),
        ],
    );
    let a = Analysis::new(&idx, Window::all(EPOCH + 31 * DAY), options()).expect("analysis");
    let email = |p| {
        idx.authors
            .get(p)
            .map(|a| a.email.to_string())
            .unwrap_or_default()
    };
    let silos: Vec<_> = a
        .silos()
        .iter()
        .map(|s| {
            (
                s.directory.label(),
                email(s.holder),
                s.directory.commits,
                s.successor.map(|(p, n)| (email(p), n)),
            )
        })
        .collect();
    assert_eq!(
        silos,
        vec![
            (
                "app/billing/".to_string(),
                "dev@x.org".to_string(),
                12,
                Some(("ann@x.org".to_string(), 8))
            ),
            (
                "lib/".to_string(),
                "bob@x.org".to_string(),
                10,
                Some(("dev@x.org".to_string(), 12))
            ),
            (
                "app/api/".to_string(),
                "ann@x.org".to_string(),
                8,
                Some(("dev@x.org".to_string(), 12))
            ),
        ]
    );
}
