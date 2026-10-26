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

fn events(path: &std::path::Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(path)
        .expect("events were written")
        .lines()
        .map(|l| serde_json::from_str(l).expect("one JSON object per line"))
        .collect()
}

fn named<'a>(events: &'a [serde_json::Value], span: &str) -> &'a serde_json::Value {
    events
        .iter()
        .find(|e| e["span"] == span)
        .expect("the step was recorded")
}

#[test]
fn export_writes_one_timed_line_per_step_and_a_spent_budget_leaves_lines_for_later() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = dir.path().join("cache");
    let export = |budget: &str, file: &str| {
        let written = dir.path().join(file);
        let run = commitscape()
            .args([
                "export",
                "--offline",
                "--lines-budget",
                budget,
                "--cache-dir",
            ])
            .arg(&cache)
            .arg("--events")
            .arg(&written)
            .arg("--out")
            .arg(dir.path().join("export"))
            .arg(fixture("lines"))
            .output()
            .expect("running commitscape");
        assert!(
            run.status.success(),
            "{}",
            String::from_utf8_lossy(&run.stderr)
        );
        (
            events(&written),
            String::from_utf8_lossy(&run.stderr).into_owned(),
        )
    };

    let (first, said) = export("0", "first.jsonl");
    for span in ["load", "head_pass", "line_pass", "export"] {
        let e = named(&first, span);
        let (start, end) = (e["start_ms"].as_u64(), e["end_ms"].as_u64());
        assert!(start.is_some_and(|s| end.is_some_and(|e| s <= e)), "{e}");
        assert!(e["fields"].is_object(), "{e}");
    }
    assert_eq!(named(&first, "line_pass")["fields"]["left"], 6);
    assert_eq!(named(&first, "line_pass")["fields"]["counted"], 0);
    assert!(said.contains("not counted yet for 6 commits"), "{said}");

    let (second, said) = export("600", "second.jsonl");
    let lines = &named(&second, "line_pass")["fields"];
    assert_eq!((&lines["counted"], &lines["left"]), (&6.into(), &0.into()));
    assert_eq!(named(&second, "mainline")["fields"]["reachable"], 7);
    assert_eq!(named(&second, "load")["fields"]["freshness"], "warm");
    assert!(!said.contains("not counted yet"), "{said}");
}

#[test]
fn signatures_records_its_steps_only_when_asked() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let out = dir.path().join("signatures.json");
    let written = dir.path().join("events.jsonl");
    let run = commitscape()
        .args(["signatures", "--no-cache", "--events"])
        .arg(&written)
        .arg("--out")
        .arg(&out)
        .arg(fixture("ownership"))
        .output()
        .expect("running commitscape");
    assert!(run.status.success());
    assert!(events(&written).iter().any(|e| e["span"] == "signatures"));
    let quiet = dir.path().join("quiet.json");
    let run = commitscape()
        .args(["signatures", "--no-cache", "--out"])
        .arg(&quiet)
        .arg(fixture("ownership"))
        .output()
        .expect("running commitscape");
    assert!(run.status.success());
    let files: Vec<_> = std::fs::read_dir(dir.path())
        .expect("listing")
        .filter_map(|e| e.ok().map(|e| e.file_name()))
        .collect();
    assert_eq!(files.len(), 3, "{files:?}");
}
