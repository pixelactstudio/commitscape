#![allow(clippy::expect_used)]

use commitscape_forge::{GitHub, Host, Remote};

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
fn the_response_says_whether_the_repository_is_archived() {
    assert!(!acme().archived);
    let archived = GitHub::from_graphql(
        br#"{"data":{"repository":{"isArchived":true,"recentIssues":{"nodes":[]}}}}"#,
    )
    .expect("the response parses");
    assert!(archived.archived);
    assert!(archived.recent_issues.is_empty());
}

#[test]
fn an_issues_first_answer_is_the_first_comment_by_someone_else() {
    let g = acme();
    let may_1 = JULY_1_2025 - 61 * 24 * HOUR;
    let june_28 = JULY_1_2025 - 3 * 24 * HOUR;
    let asked: Vec<(i64, Option<i64>)> = g
        .recent_issues
        .iter()
        .map(|i| (i.created, i.first_answer))
        .collect();
    assert_eq!(
        asked,
        vec![
            (may_1, Some(may_1 + 5 * HOUR)),
            (JULY_1_2025 - 16 * 24 * HOUR, None),
            (june_28, Some(june_28 + 2 * HOUR)),
        ]
    );
}

#[test]
fn a_response_github_really_sent_parses() {
    let g = GitHub::from_graphql(include_bytes!("t3code.json")).expect("the response parses");
    assert!(!g.archived);
    assert_eq!(g.recent_issues.len(), 100);
}

#[test]
#[ignore = "asks GitHub over the network through gh; run with --ignored"]
fn fetches_a_public_repository_through_gh() {
    let remote = Remote::parse("https://github.com/rust-lang/rust").expect("a GitHub remote");
    let g = GitHub::fetch(&remote).expect("gh answers");
    assert!(!g.archived);
    assert!(!g.recent_issues.is_empty());
}
