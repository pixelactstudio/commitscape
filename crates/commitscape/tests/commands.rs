#![allow(clippy::expect_used)]
#![allow(clippy::indexing_slicing)]

use std::path::PathBuf;
use std::process::{Command, Stdio};

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

fn commitscape() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_commitscape"));
    command
        .env("COMMITSCAPE_SITE", "http://127.0.0.1:9")
        .stdin(Stdio::null());
    command
}

#[test]
fn signatures_lists_each_address_after_the_mailmap_most_commits_first() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let out = dir.path().join("signatures.json");
    let run = commitscape()
        .args(["signatures", "--no-cache", "--out"])
        .arg(&out)
        .arg(fixture("ownership"))
        .output()
        .expect("running commitscape");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let list: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&out).expect("written")).expect("JSON");
    let rows: Vec<(&str, &str, u64)> = list
        .as_array()
        .expect("an array")
        .iter()
        .map(|r| {
            (
                r["email"].as_str().unwrap_or(""),
                r["name"].as_str().unwrap_or(""),
                r["commits"].as_u64().unwrap_or(0),
            )
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            ("alice@example.com", "Alice Example", 10),
            ("bob@example.com", "Bob Example", 6),
            ("90210+carol@users.noreply.github.com", "Carol", 3),
            ("carol@users.noreply.github.com", "Carol", 2),
        ]
    );
    let newest = Command::new("git")
        .args(["log", "-1", "--format=%H", "--author=bob@example.com"])
        .current_dir(fixture("ownership"))
        .output()
        .expect("git");
    assert_eq!(
        list[1]["sha"].as_str(),
        Some(String::from_utf8_lossy(&newest.stdout).trim())
    );
}

#[test]
fn sharing_with_nobody_to_answer_needs_yes() {
    for args in [vec![], vec!["share"]] {
        let run = commitscape()
            .args(&args)
            .args(["--no-cache"])
            .arg(fixture("ownership"))
            .output()
            .expect("running commitscape");
        let said = String::from_utf8_lossy(&run.stderr);
        assert!(!run.status.success(), "{args:?}");
        assert!(said.contains("No email addresses"), "{said}");
        assert!(said.contains("pass --yes"), "{said}");
        assert!(run.stdout.is_empty());
    }
}
