//! Asserts the crate layering ADR-0001 relies on.
//!
//! The seam between git and everything else is enforced by the dependency
//! graph, not by review. If `commitscape-metrics` ever acquires a path to
//! `gix` — directly or transitively — that enforcement is gone and nobody
//! would notice from reading a diff. This turns it into a test.

use anyhow::{bail, Context, Result};
use std::process::Command;

/// Crates that must never appear anywhere in the metrics crate's dependency
/// tree. `gix` is the one that matters; the rest are listed because their
/// presence would mean something has reached for I/O from a layer defined as
/// pure.
const FORBIDDEN_IN_METRICS: &[&str] = &["gix", "commitscape-index", "ratatui", "crossterm"];

pub fn check() -> Result<()> {
    let output = Command::new(env!("CARGO"))
        .args([
            "tree",
            "--package",
            "commitscape-metrics",
            "--edges",
            "normal",
            "--prefix",
            "none",
            "--no-dedupe",
        ])
        .current_dir(crate::workspace_root())
        .output()
        .context("running `cargo tree` for commitscape-metrics")?;

    if !output.status.success() {
        bail!(
            "cargo tree failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let tree = String::from_utf8(output.stdout).context("cargo tree output was not UTF-8")?;

    // `cargo tree --prefix none` emits one `name version` per line. Match on
    // the crate name only, so `gix-hash` is caught as well as `gix` itself.
    let mut violations = Vec::new();
    for line in tree.lines() {
        let Some(name) = line.split_whitespace().next() else {
            continue;
        };
        for forbidden in FORBIDDEN_IN_METRICS {
            let matches = name == *forbidden
                || (*forbidden == "gix" && name.starts_with("gix-"))
                || (*forbidden == "gix" && name == "gix");
            if matches {
                violations.push(name.to_string());
            }
        }
    }
    violations.sort_unstable();
    violations.dedup();

    if !violations.is_empty() {
        bail!(
            "ADR-0001 layering violated: commitscape-metrics can reach {}.\n\
             The metrics layer is defined as pure functions over the index. If it can see \
             git, the seam is decorative.",
            violations.join(", ")
        );
    }

    println!("layering ok: commitscape-metrics cannot reach any of {FORBIDDEN_IN_METRICS:?}");
    Ok(())
}
