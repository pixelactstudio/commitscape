//! The forge seam: a remote URL in, GitHub's numbers out. Parsing is tested
//! against a response written by hand, whose derived values are worked out
//! in the comments, and against one GitHub really sent.

#![allow(clippy::expect_used)]

use commitscape_forge::{GitHub, Host, Remote};

/// 2025-07-01T00:00:00Z.
const JULY_1_2025: i64 = 1_751_328_000;
const HOUR: i64 = 3_600;

#[test]
fn a_remote_url_names_the_repository_on_its_host() {
    let github = |owner: &str, name: &str| {
        Some(Remote {
            host: Host::GitHub,
            owner: owner.to_string(),
            name: name.to_string(),
        })
    };
    for url in [
        "git@github.com:acme/rocket.git",
        "git@github.com:acme/rocket",
        "https://github.com/acme/rocket.git",
        "https://github.com/acme/rocket/",
        "https://user@github.com/acme/rocket",
        "ssh://git@github.com/acme/rocket.git",
        "ssh://git@github.com:22/acme/rocket.git",
        "git://github.com/acme/rocket.git",
    ] {
        assert_eq!(Remote::parse(url), github("acme", "rocket"), "{url}");
    }
    for url in [
        "https://gitlab.com/acme/rocket.git",
        "/home/me/code/rocket",
        "https://github.com/acme",
        "",
    ] {
        assert_eq!(Remote::parse(url), None, "{url}");
    }
}

fn acme() -> GitHub {
    GitHub::from_graphql(include_bytes!("acme-rocket.json")).expect("the response parses")
}

#[test]
fn the_response_becomes_the_repositorys_numbers() {
    let g = acme();
    assert_eq!(g.name_with_owner, "acme/rocket");
    assert_eq!(g.description.as_deref(), Some("A rocket, in Rust."));
    assert_eq!((g.stars, g.forks, g.watchers), (1234, 56, 12));
    assert_eq!((g.open_issues, g.closed_issues), (7, 93));
    assert_eq!((g.open_prs, g.merged_prs, g.closed_prs), (3, 210, 14));
    assert_eq!(g.releases, 9);
    let latest = g.latest_release.as_ref().expect("a release");
    assert_eq!(latest.tag, "v1.2.0");
    assert_eq!(
        latest.published,
        Some(JULY_1_2025 - 30 * 24 * HOUR + 9 * HOUR)
    );
    assert_eq!(g.license.as_deref(), Some("MIT"));
    assert_eq!(g.topics, vec!["cli".to_string(), "git".to_string()]);
    let languages: Vec<(&str, u64)> = g.languages.iter().map(|(n, b)| (n.as_str(), *b)).collect();
    assert_eq!(languages, vec![("Rust", 900), ("Shell", 100)]);
    assert_eq!(g.created, Some(1_704_067_200), "2024-01-01T00:00:00Z");
}

#[test]
fn recent_pull_requests_and_issues_give_the_last_thirty_days() {
    // Since 1 June 2025: PRs merged 1 June (after 6 hours), 12 June (after
    // 2 days) and 25 June (after 1 hour): 3, with a median of 6 hours. All
    // five were opened since then. Issues opened 15 and 28 June, one closed
    // on 29 June; the May issue is older.
    let g = acme();
    let since = JULY_1_2025 - 30 * 24 * HOUR;
    assert_eq!(g.prs_merged_since(since), 3);
    assert_eq!(g.prs_opened_since(since), 5);
    assert_eq!(g.median_hours_to_merge(), Some(6.0));
    assert_eq!(g.issues_opened_since(since), 2);
    assert_eq!(g.issues_closed_since(since), 1);
    assert_eq!(
        g.pr_authors(),
        vec![
            ("alice".to_string(), 2),
            ("bob".to_string(), 1),
            ("carol".to_string(), 1),
            ("ghost".to_string(), 1),
        ],
        "a deleted account is GitHub's ghost"
    );
}

#[test]
fn an_issues_first_answer_is_the_first_comment_by_someone_else() {
    // Alice's May issue: her own comment after an hour, then Bob's after
    // five. Carol's June issue has none. The last, by a deleted account,
    // got a bot's welcome after a minute and a triage account's label after
    // two (a user account named as a bot), which are no answers, and Erin's
    // after two hours.
    let g = acme();
    let may_1 = JULY_1_2025 - 61 * 24 * HOUR;
    let june_28 = JULY_1_2025 - 3 * 24 * HOUR;
    let answers: Vec<Option<i64>> = g.recent_issues.iter().map(|i| i.first_answer).collect();
    assert_eq!(
        answers,
        vec![Some(may_1 + 5 * HOUR), None, Some(june_28 + 2 * HOUR)]
    );
}

#[test]
fn a_response_github_really_sent_parses() {
    // pingdotgg/t3code on 23 September 2026, from the query this crate sends.
    let g = GitHub::from_graphql(include_bytes!("t3code.json")).expect("the response parses");
    assert_eq!(g.name_with_owner, "pingdotgg/t3code");
    assert!(g.stars > 20_000, "{}", g.stars);
    assert_eq!(g.recent_prs.len(), 100);
}

#[test]
fn counts_from_recent_issues_say_when_there_were_more() {
    // Only the last 100 issues are asked for. acme's three are all it has,
    // so what they count is whole. t3code's last 100 were all opened
    // between 19 September 2026 at 23:15 and 23 September: over the thirty
    // days before then there were more than 100, but they do reach back to
    // 20 September.
    let since = JULY_1_2025 - 30 * 24 * HOUR;
    assert!(acme().issues_reach(since));
    let t3code = GitHub::from_graphql(include_bytes!("t3code.json")).expect("the response parses");
    // 2026-09-23T00:00:00Z and 2026-09-20T00:00:00Z.
    let (september_23, september_20) = (1_790_121_600, 1_789_862_400);
    assert!(!t3code.issues_reach(september_23 - 30 * 24 * HOUR));
    assert!(t3code.issues_reach(september_20));
}

#[test]
#[ignore = "asks GitHub over the network through gh; run with --ignored"]
fn fetches_a_public_repository_through_gh() {
    let remote = Remote::parse("https://github.com/rust-lang/rust").expect("a GitHub remote");
    let g = GitHub::fetch(&remote).expect("gh answers");
    assert_eq!(g.name_with_owner, "rust-lang/rust");
    assert!(g.stars > 90_000, "{}", g.stars);
}
