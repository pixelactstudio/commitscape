//! `commitscape card`: the binary draws the repository's story and writes
//! it as an SVG image.

#![allow(clippy::expect_used)]

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

#[test]
fn card_writes_the_story_of_all_of_history_as_an_svg() {
    // The rhythm fixture: six commits by three people between 1 and 8
    // January 2024.
    let dir = tempfile::tempdir().expect("a temporary directory");
    let out = dir.path().join("rhythm.svg");
    let run = Command::new(env!("CARGO_BIN_EXE_commitscape"))
        .arg("card")
        .arg(fixture("rhythm"))
        .arg("--out")
        .arg(&out)
        .args(["--no-cache", "--offline"])
        .output()
        .expect("running commitscape");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let svg = std::fs::read_to_string(&out).expect("the card was written");
    assert!(svg.starts_with("<svg"), "an SVG image");
    assert!(svg.contains(">all of history · made with</text>"));
    assert!(svg.contains(">6</text>"), "its six commits");
    let said = String::from_utf8_lossy(&run.stdout);
    assert!(
        said.contains("rhythm.svg"),
        "it says where the card went: {said}"
    );
}
