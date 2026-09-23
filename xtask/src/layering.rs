//! Asserts the crate layering ADR-0001 relies on.
//!
//! The seam between git and everything else is enforced by the dependency
//! graph, not by review. If `commitscape-metrics` ever acquires a path to
//! `gix` — directly or transitively — that enforcement is gone and nobody
//! would notice from reading a diff. This turns it into a test.

use anyhow::{bail, Context, Result};
use std::process::Command;

/// A crate, and the crates that must never appear anywhere in its normal
/// dependency tree.
struct Rule {
    package: &'static str,
    forbidden: &'static [&'static str],
    why: &'static str,
}

const RULES: &[Rule] = &[
    // `gix` is the one that matters; the rest are listed because their
    // presence would mean something has reached for I/O from a layer defined
    // as pure.
    Rule {
        package: "commitscape-metrics",
        forbidden: &[
            "gix",
            "commitscape-index",
            "commitscape-forge",
            "ratatui",
            "crossterm",
        ],
        why: "The metrics layer is defined as pure functions over the index. If it can see \
              git, or the network, the seam is decorative.",
    },
    Rule {
        package: "commitscape-forge",
        forbidden: &["gix", "commitscape-index", "ratatui", "crossterm"],
        why: "The forge turns a remote URL into a host's numbers (ADR-0009). It has no \
              business with git history or the terminal.",
    },
    Rule {
        package: "commitscape-tui",
        forbidden: &["gix", "commitscape-index"],
        why: "The interface draws an Index and receives older history through a function \
              its caller provides. If it can see git or the cache, it can go around both.",
    },
];

pub fn check() -> Result<()> {
    for rule in RULES {
        check_rule(rule)?;
    }
    Ok(())
}

fn check_rule(rule: &Rule) -> Result<()> {
    let output = Command::new(env!("CARGO"))
        .args([
            "tree",
            "--package",
            rule.package,
            "--edges",
            "normal",
            "--prefix",
            "none",
            "--no-dedupe",
        ])
        .current_dir(crate::workspace_root())
        .output()
        .with_context(|| format!("running `cargo tree` for {}", rule.package))?;

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
        for forbidden in rule.forbidden {
            let matches = name == *forbidden || (*forbidden == "gix" && name.starts_with("gix-"));
            if matches {
                violations.push(name.to_string());
            }
        }
    }
    violations.sort_unstable();
    violations.dedup();

    if !violations.is_empty() {
        bail!(
            "ADR-0001 layering violated: {} can reach {}.\n{}",
            rule.package,
            violations.join(", "),
            rule.why
        );
    }

    println!(
        "layering ok: {} cannot reach any of {:?}",
        rule.package, rule.forbidden
    );
    Ok(())
}
