#![allow(clippy::expect_used)]

mod support;

use commitscape_metrics::{
    Analysis, Answers, Health, Maintainer, Options, Releases, Trend, Window,
};
use support::{c, h, index, DAY, EPOCH};

fn person(idx: &commitscape_core::Index, email: &str) -> commitscape_core::AuthorId {
    idx.authors
        .iter()
        .find(|(_, a)| a.email == email)
        .map(|(id, _)| id)
        .expect("the person exists")
}

#[test]
fn health_says_who_keeps_it_going_how_often_it_ships_and_where_it_is_heading() {
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
    let a = Analysis::new(&idx, Window::all(at(400)), Options::default());
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
