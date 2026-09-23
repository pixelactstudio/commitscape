//! The `--json` seam: the document the binary prints for each fixture,
//! compared byte for byte with `tests/golden/<fixture>.json`.
//!
//! Each golden file was checked by hand against `docs/fixtures.md` when it
//! was written, and `fixture_metrics.rs` asserts the same literals through
//! the library. To accept a deliberate change, run with
//! `COMMITSCAPE_UPDATE_GOLDEN=1` and review the diff before committing it.
//! CI never sets it, so a missing or stale golden file fails there.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::PathBuf;
use std::process::{Command, Output};

fn workspace() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(PathBuf::from)
        .expect("workspace root")
}

fn commitscape(fixture: &str, args: &[&str]) -> Output {
    let repo = workspace().join("fixtures").join(fixture);
    assert!(
        repo.exists(),
        "fixture {fixture} is missing: run `cargo xtask fixtures --force`"
    );
    Command::new(env!("CARGO_BIN_EXE_commitscape"))
        .arg(&repo)
        .args(args)
        .output()
        .expect("running commitscape")
}

fn golden(fixture: &str) {
    let out = commitscape(fixture, &["--json", "--window", "all", "--no-cache"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let actual = String::from_utf8(out.stdout).expect("JSON is UTF-8");
    serde_json::from_str::<serde_json::Value>(&actual).expect("the output parses as JSON");

    let name = fixture.trim_end_matches(".git");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(format!("{name}.json"));
    if std::env::var_os("COMMITSCAPE_UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &actual).expect("writing the golden file");
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "{} is missing: run with COMMITSCAPE_UPDATE_GOLDEN=1 and review it",
            path.display()
        )
    });
    if let Some((n, (want, got))) = expected
        .lines()
        .zip(actual.lines())
        .enumerate()
        .find(|(_, (want, got))| want != got)
    {
        panic!(
            "{name}.json differs at line {}:\n  golden: {want}\n  actual: {got}",
            n + 1
        );
    }
    assert_eq!(
        expected.lines().count(),
        actual.lines().count(),
        "{name}.json differs in length"
    );
}

#[test]
fn linear() {
    golden("linear");
}

#[test]
fn coupling() {
    golden("coupling");
}

#[test]
fn ownership() {
    golden("ownership");
}

#[test]
fn renames() {
    golden("renames");
}

#[test]
fn bulk() {
    golden("bulk");
}

#[test]
fn merges() {
    golden("merges");
}

#[test]
fn conflict() {
    golden("conflict");
}

#[test]
fn rhythm() {
    golden("rhythm");
}

#[test]
fn shallow() {
    golden("shallow");
}

#[test]
fn detached() {
    golden("detached");
}

#[test]
fn bare() {
    golden("bare.git");
}

#[test]
fn an_empty_repository_fails_with_a_message_not_a_document() {
    let out = commitscape("empty", &["--json", "--no-cache"]);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty(), "no partial document on stdout");
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("no commits"), "{err}");
    assert!(!err.contains("panicked"), "{err}");
}
