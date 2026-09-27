//! `commitscape report --data`: the Report's data alone, gzipped, as the
//! Site stores it (ADR-0015), and as a hosted Report must be: no email
//! address anywhere (ADR-0019).

#![allow(clippy::expect_used)]
// Indexing a `serde_json::Value` gives `null` for what is missing: it does
// not panic.
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

fn report_data(args: &[&str]) -> serde_json::Value {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let out = dir.path().join("ownership.json.gz");
    let run = Command::new(env!("CARGO_BIN_EXE_commitscape"))
        .args([
            "report",
            "--data",
            "--no-cache",
            "--offline",
            "--window",
            "all",
        ])
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
    let bytes = std::fs::read(&out).expect("the report was written");
    let mut json = String::new();
    flate2::read::GzDecoder::new(bytes.as_slice())
        .read_to_string(&mut json)
        .expect("gzipped");
    serde_json::from_str(&json).expect("JSON")
}

#[test]
fn a_report_for_the_site_names_people_but_holds_no_address() {
    // The ownership fixture: Alice commits under three addresses the
    // mailmap and case join, alice@example.com among them.
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
    // Its profiles and Commit List are there, without addresses.
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
