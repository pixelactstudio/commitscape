#![allow(clippy::expect_used)]
#![allow(clippy::indexing_slicing)]

use commitscape_index::source::RawChangeKind::{Added, Modified};
use commitscape_index::{index_from_scratch, ScriptedRepo};
use commitscape_metrics::{Options, Span};
use commitscape_report::report::{data, Report};

const ANCHOR: i64 = 1_751_328_000;
const DAY: i64 = 86_400;

fn report() -> serde_json::Value {
    let blob = |n: u8| commitscape_core::Oid([n; 20]);
    const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
    const BOB: (&str, &str) = ("Bob Builder", "bob@example.com");
    let repo = ScriptedRepo::new()
        .commit(
            ANCHOR - 20 * DAY,
            ALICE,
            &[(b"src/main.rs", Added, blob(1))],
        )
        .said("feat: start")
        .commit(
            ANCHOR - 10 * DAY,
            BOB,
            &[(b"src/main.rs", Modified, blob(2))],
        )
        .said("fix(main): off by one\n\nIt was two.")
        .commit(
            ANCHOR - 5 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(3))],
        )
        .said("Revert \"feat: start\"")
        .commit(
            ANCHOR - 2 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(4))],
        )
        .said("tidy")
        .head_file(b"src/main.rs", "fn main() {\n    run();\n}\n");
    let index = match index_from_scratch(&repo) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let r = Report {
        name: "acme".to_string(),
        index,
        anchor: ANCHOR,
        span: Span::Quarter,
        options: Options::default(),
        releases: Vec::new(),
        lines_counted: false,
        history: None,
        accounts: Default::default(),
        card: None,
        avatars: false,
        commit_link: Some("https://github.com/acme/acme/commit/".to_string()),
        emails: true,
    };
    serde_json::from_str(&data(r)).expect("JSON")
}

#[test]
fn the_overview_counts_the_windows_commits_and_people() {
    let r = report();
    let o = &r["data"]["/api/overview?window=all"];
    assert_eq!(o["window"], "all");
    assert_eq!(o["totals"]["commits"], 4);
    assert_eq!(o["totals"]["people"], 2);
    assert_eq!(o["totals"]["code_lines"], 3);
    assert_eq!(o["commits"], 4);
    assert_eq!(o["people"][0]["person"]["name"], "Alice Example");
    assert_eq!(o["people"][0]["commits"], 3);
    assert_eq!(o["people"][1]["commits"], 1);
    assert_eq!(o["languages"][0]["name"], "Rust");
}

#[test]
fn the_commit_list_is_every_commit_newest_first_in_columns() {
    let r = report();
    let l = &r["data"]["/api/commits?"];
    assert_eq!(
        l["subjects"],
        serde_json::json!([
            "tidy",
            "Revert \"feat: start\"",
            "fix(main): off by one",
            "feat: start"
        ])
    );
    assert_eq!(
        l["times"],
        serde_json::json!([
            ANCHOR - 2 * DAY,
            ANCHOR - 5 * DAY,
            ANCHOR - 10 * DAY,
            ANCHOR - 20 * DAY
        ])
    );
    assert_eq!(l["person"], serde_json::json!([0, 0, 1, 0]));
    assert_eq!(l["people"][0]["person"]["name"], "Alice Example");
    assert_eq!(
        l["people"][0]["emails"],
        serde_json::json!(["alice@example.com"])
    );
    assert_eq!(l["people"][1]["person"]["name"], "Bob Builder");
    let kinds: Vec<String> = l["kind"]
        .as_array()
        .expect("kinds")
        .iter()
        .map(|k| {
            l["kinds"][k.as_u64().expect("a number") as usize]
                .as_str()
                .unwrap_or("")
                .to_string()
        })
        .collect();
    assert_eq!(kinds, ["other", "reverts", "fixes", "features"]);
    assert_eq!(l["files"], serde_json::json!([1, 1, 1, 1]));
    assert_eq!(l["merge"], serde_json::json!([false, false, false, false]));
    assert_eq!(l["lines"], false);
    assert_eq!(l["added"], serde_json::json!([null, null, null, null]));
    assert_eq!(l["link"], "https://github.com/acme/acme/commit/");
    assert_eq!(l["ids"][0].as_str().map(str::len), Some(40));
}

#[test]
fn a_reports_stats_are_the_leaderboards_numbers() {
    let blob = |n: u8| commitscape_core::Oid([n; 20]);
    const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
    const BOB: (&str, &str) = ("Bob Builder", "bob@example.com");
    let repo = ScriptedRepo::new()
        .commit(ANCHOR - 6 * 365 * DAY, BOB, &[(b"old.rs", Added, blob(9))])
        .commit(
            ANCHOR - 20 * DAY,
            ALICE,
            &[(b"src/main.rs", Added, blob(1))],
        )
        .commit(
            ANCHOR - 10 * DAY,
            BOB,
            &[(b"src/main.rs", Modified, blob(2))],
        )
        .commit(
            ANCHOR - 5 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(3))],
        )
        .commit(
            ANCHOR - 2 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(4))],
        )
        .head_file(b"src/main.rs", "fn main() {\n    run();\n}\n")
        .head_file(b"old.rs", "fn old() {}\n// kept\n");
    let index = match index_from_scratch(&repo) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let stats =
        commitscape_report::api::Stats::of(&index, ANCHOR, Options::default(), &[]).expect("stats");
    assert_eq!(stats.commits, 5);
    assert_eq!(stats.people, 2);
    assert_eq!(stats.bus_factor, Some(2));
    assert_eq!(stats.maintainers, 1);
    assert_eq!((stats.commits_30d, stats.people_30d), (4, 2));
    assert_eq!((stats.code_lines, stats.untouched_5y), (5, 2));
}

#[test]
fn a_months_people_are_all_counted_past_the_ranking_limit() {
    let blob = |n: u16| {
        let mut id = [0; 20];
        id[..2].copy_from_slice(&n.to_be_bytes());
        commitscape_core::Oid(id)
    };
    let people: Vec<(String, String)> = (0..1005)
        .map(|i| (format!("Person {i}"), format!("p{i}@example.com")))
        .collect();
    let mut repo = ScriptedRepo::new();
    for (i, (name, email)) in people.iter().enumerate() {
        let i = i as u16;
        repo = repo.commit(
            ANCHOR - DAY - i64::from(i) * 60,
            (name.as_str(), email.as_str()),
            &[(b"a.rs", if i == 0 { Added } else { Modified }, blob(i))],
        );
    }
    let index = match index_from_scratch(&repo.head_file(b"a.rs", "fn a() {}\n")) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let stats =
        commitscape_report::api::Stats::of(&index, ANCHOR, Options::default(), &[]).expect("stats");
    assert_eq!((stats.commits_30d, stats.people_30d), (1005, 1005));
}
