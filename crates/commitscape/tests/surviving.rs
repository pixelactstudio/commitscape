#![allow(clippy::expect_used, clippy::panic, clippy::indexing_slicing)]

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use commitscape_core::Index;
use commitscape_index::{
    index_from_scratch, line_pass, CacheOptions, GixRepo, RepoSource, Survival, Survived,
};
use commitscape_metrics::{Analysis, Options, Window};
use serde_json::Value;

fn day(n: i64) -> i64 {
    1_704_067_200 + n * 86_400
}

const PEOPLE: [&str; 3] = ["Alice Example", "Bob Example", "Carol"];

fn fixture() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("fixtures").join("survival"))
        .expect("workspace root");
    assert!(
        root.exists(),
        "fixture survival is missing: run `cargo xtask fixtures --force`"
    );
    root
}

fn id_of(index: &Index, name: &str) -> commitscape_core::AuthorId {
    index
        .authors
        .iter()
        .find(|(_, a)| a.name == name)
        .map(|(id, _)| id)
        .expect("the person is in the fixture")
}

fn surviving(max_changeset_size: u32) -> Vec<(u64, Option<i64>)> {
    let repo = GixRepo::open(&fixture()).expect("opening fixture");
    let index = index_from_scratch(&repo).expect("indexing fixture");
    let ignored = repo.blame_ignore_revs().expect("reading ignored revisions");
    let mut survival = Survival::new(
        &index,
        &ignored,
        max_changeset_size,
        &CacheOptions::default(),
    )
    .expect("the fixture has a head");
    PEOPLE
        .iter()
        .map(|name| {
            match survival
                .person(
                    &repo.threads(),
                    id_of(&index, name),
                    Duration::from_secs(60),
                )
                .expect("blaming")
            {
                Survived::Counted { lines, oldest, .. } => (lines, oldest),
                Survived::OverBudget { .. } => panic!("{name} went over budget"),
            }
        })
        .collect()
}

fn added(max_changeset_size: u32) -> Vec<u64> {
    let repo = GixRepo::open(&fixture()).expect("opening fixture");
    let mut index = index_from_scratch(&repo).expect("indexing fixture");
    line_pass(&repo, &index, None, &mut |_, _| {})
        .expect("counting lines")
        .apply(&mut index);
    let anchor = index.span.newest.expect("commits");
    let options = Options {
        max_changeset_size,
        ..Options::default()
    };
    let lines: HashMap<_, _> = Analysis::new(&index, Window::all(anchor), options)
        .lines_by_person()
        .into_iter()
        .collect();
    PEOPLE
        .iter()
        .map(|name| lines.get(&id_of(&index, name)).map_or(0, |l| l.added))
        .collect()
}

#[test]
fn surviving_lines_pass_through_the_bulk_reformat_the_ignored_commit_and_a_move() {
    assert_eq!(
        surviving(3),
        [(5, Some(day(0))), (10, Some(day(1))), (5, Some(day(2)))]
    );
    assert_eq!(added(3), [11, 13, 7]);
}

#[test]
fn without_a_bulk_commit_the_reformat_keeps_every_line_it_touched() {
    assert_eq!(
        surviving(50),
        [(1, Some(day(9))), (17, Some(day(5))), (2, Some(day(6)))]
    );
    assert_eq!(added(50), [11, 29, 7]);
}

fn run(args: &[&str]) -> Vec<u8> {
    let out = Command::new(env!("CARGO_BIN_EXE_commitscape"))
        .args(args)
        .output()
        .expect("running commitscape");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}

fn report_people(cache: &Path, out: &Path) -> Vec<(u64, String)> {
    report_people_with(cache, out, &[])
}

fn report_people_with(cache: &Path, out: &Path, extra: &[&str]) -> Vec<(u64, String)> {
    let repo = fixture();
    let mut args = vec![
        "report",
        "--offline",
        "--no-emails",
        "--window",
        "all",
        "--cache-dir",
        cache.to_str().expect("UTF-8"),
        "--out",
        out.to_str().expect("UTF-8"),
    ];
    args.extend_from_slice(extra);
    args.extend(["--", repo.to_str().expect("UTF-8")]);
    run(&args);
    let mut json = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(out).expect("the report"))
        .read_to_string(&mut json)
        .expect("gzip");
    let report: Value = serde_json::from_str(&json).expect("JSON");
    let mut people: Vec<(u64, String)> = report["data"]["/api/people?window=all"]["people"]
        .as_array()
        .expect("people")
        .iter()
        .map(|row| {
            (
                row["person"]["id"].as_u64().expect("id"),
                row["person"]["name"].as_str().expect("name").to_string(),
            )
        })
        .collect();
    people.sort();
    people
}

fn survive(cache: &Path, budget: &str, ids: &[u64]) -> Value {
    let repo = fixture();
    let mut args = vec![
        "surviving".to_string(),
        repo.to_str().expect("UTF-8").to_string(),
        "--max-changeset-size".to_string(),
        "3".to_string(),
        "--offline".to_string(),
        "--budget-seconds".to_string(),
        budget.to_string(),
        "--cache-dir".to_string(),
        cache.to_str().expect("UTF-8").to_string(),
    ];
    for id in ids {
        args.push("--person".to_string());
        args.push(id.to_string());
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    serde_json::from_slice(&run(&args)).expect("one JSON document")
}

#[test]
fn the_command_takes_the_reports_person_ids_and_reuses_what_it_blamed() {
    let dir = tempfile::tempdir().expect("temp dir");
    let cache = dir.path().join("cache");
    let people = report_people(&cache, &dir.path().join("report.json.gz"));
    assert_eq!(people.len(), 3);
    let ids: Vec<u64> = people.iter().map(|(id, _)| *id).collect();

    let head = Command::new("git")
        .arg("-C")
        .arg(fixture())
        .args(["rev-parse", "HEAD"])
        .output()
        .expect("git");
    let head = String::from_utf8_lossy(&head.stdout).trim().to_string();

    let expected: HashMap<&str, (u64, u64, u64, i64)> = [
        ("Alice Example", (5, 11, 2, day(0))),
        ("Bob Example", (10, 13, 4, day(1))),
        ("Carol", (5, 7, 3, day(2))),
    ]
    .into_iter()
    .collect();

    let mut with_unknown = ids.clone();
    with_unknown.push(999);
    for pass in 0..2 {
        let out = survive(&cache, "60", &with_unknown);
        assert_eq!(out["head"], Value::String(head.clone()));
        let rows = out["people"].as_array().expect("people");
        assert_eq!(rows.len(), 4, "pass {pass}");
        for ((id, name), row) in people.iter().zip(rows) {
            let (lines, added, files, oldest) = expected[name.as_str()];
            assert_eq!(row["id"].as_u64(), Some(*id));
            assert_eq!(row["name"].as_str(), Some(name.as_str()));
            assert_eq!(row["status"], "counted");
            assert_eq!(row["surviving"].as_u64(), Some(lines), "{name}");
            assert_eq!(row["added"].as_u64(), Some(added), "{name}");
            assert_eq!(row["files"].as_u64(), Some(files), "{name}");
            assert_eq!(row["oldest"].as_i64(), Some(oldest), "{name}");
            assert!(row["seconds"].as_f64().is_some());
        }
        let unknown = &rows[3];
        assert_eq!(unknown["id"], 999);
        assert_eq!(unknown["status"], "unknown_person");
        assert_eq!(unknown["name"], Value::Null);
        assert_eq!(unknown["surviving"], Value::Null);
        assert_eq!(unknown["oldest"], Value::Null);
    }

    let warm = survive(&cache, "0", &ids);
    assert!(warm["people"]
        .as_array()
        .expect("people")
        .iter()
        .all(|row| row["status"] == "counted"));

    let cold = survive(&dir.path().join("other"), "0", &ids[..1]);
    let row = &cold["people"][0];
    assert_eq!(row["status"], "over_budget");
    assert_eq!(row["surviving"], Value::Null);
    assert_eq!(row["oldest"], Value::Null);
    assert_eq!(
        row["added"].as_u64(),
        Some(expected[people[0].1.as_str()].1)
    );
}

#[test]
fn surviving_given_the_reports_accounts_file_uses_the_reports_ids() {
    let dir = tempfile::tempdir().expect("temp dir");
    let cache = dir.path().join("cache");
    let accounts = dir.path().join("accounts.json");
    std::fs::write(
        &accounts,
        r#"{"bob@example.com": "bobgh", "carol@users.noreply.github.com": "bobgh"}"#,
    )
    .expect("written");
    let accounts = accounts.to_str().expect("UTF-8");
    let apart = report_people(&cache, &dir.path().join("apart.json.gz"));
    let people = report_people_with(
        &cache,
        &dir.path().join("joined.json.gz"),
        &["--accounts", accounts],
    );
    assert_eq!(apart.len(), 3);
    assert_eq!(people.len(), 2, "Bob and Carol are one person");

    let mut args = vec![
        "surviving".to_string(),
        fixture().to_str().expect("UTF-8").to_string(),
        "--max-changeset-size".to_string(),
        "3".to_string(),
        "--offline".to_string(),
        "--cache-dir".to_string(),
        cache.to_str().expect("UTF-8").to_string(),
        "--accounts".to_string(),
        accounts.to_string(),
    ];
    for (id, _) in &people {
        args.push("--person".to_string());
        args.push(id.to_string());
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let out: Value = serde_json::from_slice(&run(&args)).expect("one JSON document");
    let rows = out["people"].as_array().expect("people");
    let named: Vec<(u64, String)> = rows
        .iter()
        .map(|r| {
            (
                r["id"].as_u64().expect("id"),
                r["name"].as_str().expect("a known person").to_string(),
            )
        })
        .collect();
    assert_eq!(named, people);
    let lines: HashMap<String, u64> = rows
        .iter()
        .map(|r| {
            (
                r["name"].as_str().unwrap_or("").to_string(),
                r["surviving"].as_u64().unwrap_or(0),
            )
        })
        .collect();
    assert_eq!(lines.values().sum::<u64>(), 20);
    assert_eq!(lines.get("Alice Example"), Some(&5));
}
