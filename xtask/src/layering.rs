use anyhow::{bail, Context, Result};
use std::process::Command;

struct Rule {
    package: &'static str,
    forbidden: &'static [&'static str],
    why: &'static str,
}

const RULES: &[Rule] = &[
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
    Rule {
        package: "commitscape-report",
        forbidden: &["gix", "commitscape-index", "ratatui", "crossterm"],
        why: "The Report is computed from an Index, as the terminal interface is, and is \
              handed everything else by the binary. It draws in no terminal.",
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
