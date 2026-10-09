#![allow(clippy::expect_used)]
#![allow(clippy::indexing_slicing)]

use std::io::Read;
use std::path::PathBuf;
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name);
    assert!(
        repo.exists(),
        "fixture {name} is missing: run `cargo xtask fixtures --force`"
    );
    repo
}

fn gunzip(path: &std::path::Path) -> serde_json::Value {
    let bytes = std::fs::read(path).expect("the file was written");
    let mut json = String::new();
    flate2::read::GzDecoder::new(bytes.as_slice())
        .read_to_string(&mut json)
        .expect("gzipped");
    serde_json::from_str(&json).expect("JSON")
}

fn report_data(args: &[&str]) -> serde_json::Value {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let out = dir.path().join("ownership.json.gz");
    let run = Command::new(env!("CARGO_BIN_EXE_commitscape"))
        .args(["report", "--no-cache", "--offline", "--window", "all"])
        .args(args)
        .arg("--out")
        .arg(&out)
        .arg(fixture("ownership"))
        .output()
        .expect("running commitscape");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    gunzip(&out)
}

#[test]
fn a_report_for_the_site_names_people_but_holds_no_address() {
    let local = report_data(&[]);
    assert!(local.to_string().contains("alice@example.com"));
    let hosted = report_data(&["--no-emails"]);
    let text = hosted.to_string();
    assert!(text.contains("Alice Example"), "people are named");
    for address in [
        "@example.com",
        "@Example.COM",
        "@work.example.org",
        "noreply",
    ] {
        assert!(!text.contains(address), "{address} leaked");
    }
    assert!(hosted["data"]["/api/commits?"]["people"][0]["emails"]
        .as_array()
        .is_some_and(Vec::is_empty));
}

#[test]
fn without_lines_the_report_says_they_were_not_counted() {
    let counted = report_data(&[]);
    assert_eq!(counted["meta"]["lines"], "counted");
    let left_out = report_data(&["--no-lines"]);
    assert_eq!(left_out["meta"]["lines"], "off");
    assert_eq!(
        left_out["data"]["/api/commits?"]["added"][0],
        serde_json::Value::Null
    );
}

#[test]
fn the_commit_list_can_go_to_its_own_file() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let commits = dir.path().join("commits.json.gz");
    let apart = report_data(&[
        "--no-emails",
        "--commits-out",
        commits.to_str().expect("UTF-8"),
    ]);
    assert!(apart["data"].get("/api/commits?").is_none());
    let list = gunzip(&commits);
    let inside = report_data(&["--no-emails"]);
    assert_eq!(list, inside["data"]["/api/commits?"]);
    assert!(inside.get("cards").is_none());
}

#[test]
fn addresses_given_one_login_are_one_person_shown_with_it() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let accounts = dir.path().join("accounts.json");
    std::fs::write(&accounts, r#"{"Bob@Example.com": "carol"}"#).expect("written");
    let before = report_data(&["--no-emails"]);
    let after = report_data(&[
        "--no-emails",
        "--accounts",
        accounts.to_str().expect("UTF-8"),
    ]);
    let people = |r: &serde_json::Value| -> Vec<(String, Option<String>, u64)> {
        r["data"]["/api/people?window=all"]["people"]
            .as_array()
            .expect("people")
            .iter()
            .map(|p| {
                (
                    p["person"]["name"].as_str().unwrap_or("").to_string(),
                    p["person"]["login"].as_str().map(str::to_string),
                    p["commits"].as_u64().unwrap_or(0),
                )
            })
            .collect()
    };
    assert_eq!(people(&before).len(), 3);
    let joined = people(&after);
    assert_eq!(joined.len(), 2);
    assert!(joined.contains(&("Bob Example".to_string(), Some("carol".to_string()), 11)));
    assert!(!after.to_string().contains("@example.com"));
}
