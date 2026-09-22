//! Cross-checks the history walk against git itself.
//!
//! The walk computes its own tree diffs, including git's combined diff for
//! merges, so it needs an independent source of truth on real history, not
//! only on fixtures shaped the way we expected. `git diff-tree -c` is that
//! source: for a sample of commits, the set of paths and how each was touched
//! must match exactly.
//!
//! This shells out to `git`, like the fixture generator, under the same
//! declared exception to ADR-0001: test tooling, never product code.

use std::collections::{BTreeSet, HashMap};
use std::io::Write;
use std::ops::ControlFlow;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};
use commitscape_core::Oid;
use commitscape_index::source::{CommitSink, RawChange, RawChangeKind, RawCommit};
use commitscape_index::{Frontier, GixRepo, RepoSource};

/// `(status, path)` pairs, where status is `A`, `M` or `D`.
type Changes = BTreeSet<(char, String)>;

struct Sampler {
    every: u64,
    seen: u64,
    merges_seen: u64,
    commits: u64,
    sampled: HashMap<Oid, (bool, Changes)>,
}

impl CommitSink for Sampler {
    fn on_commit(&mut self, commit: &RawCommit<'_>, changes: &[RawChange<'_>]) -> ControlFlow<()> {
        self.commits += 1;
        let merge = commit.parent_count > 1;
        let take = if merge {
            self.merges_seen += 1;
            (self.merges_seen - 1).is_multiple_of(self.every)
        } else {
            self.seen += 1;
            (self.seen - 1).is_multiple_of(self.every)
        };
        if take {
            let set = changes
                .iter()
                .map(|c| {
                    let status = match c.kind {
                        RawChangeKind::Added => 'A',
                        RawChangeKind::Modified => 'M',
                        RawChangeKind::Deleted => 'D',
                    };
                    (status, String::from_utf8_lossy(c.path).into_owned())
                })
                .collect();
            self.sampled.insert(commit.id, (merge, set));
        }
        ControlFlow::Continue(())
    }
}

pub fn run(repo: &Path, every: u64) -> Result<()> {
    let source = GixRepo::open(repo).context("opening the repository")?;
    let mut sampler = Sampler {
        every: every.max(1),
        seen: 0,
        merges_seen: 0,
        commits: 0,
        sampled: HashMap::new(),
    };
    source
        .walk_history(&Frontier::new(), &mut sampler)
        .context("walking history")?;

    let expected_count = git(
        repo,
        &[
            "rev-list",
            "--count",
            "HEAD",
            "--branches",
            "--remotes",
            "--tags",
        ],
    )?;
    let expected_count: u64 = expected_count
        .trim()
        .parse()
        .context("parsing rev-list --count")?;
    println!(
        "commits walked: {} (git rev-list says {expected_count})",
        sampler.commits
    );

    let ids: Vec<Oid> = sampler.sampled.keys().copied().collect();
    let from_git = diff_tree(repo, &ids)?;

    let mut mismatches = 0usize;
    let mut merges = 0usize;
    for (id, (merge, ours)) in &sampler.sampled {
        if *merge {
            merges += 1;
        }
        let theirs = from_git.get(id).cloned().unwrap_or_default();
        if &theirs != ours {
            mismatches += 1;
            if mismatches <= 5 {
                println!("MISMATCH {} (merge: {merge})", id.to_hex());
                for extra in ours.difference(&theirs).take(5) {
                    println!("  only ours: {} {}", extra.0, extra.1);
                }
                for missing in theirs.difference(ours).take(5) {
                    println!("  only git:  {} {}", missing.0, missing.1);
                }
            }
        }
    }
    println!(
        "sampled {} commits ({merges} merges): {mismatches} mismatches",
        sampler.sampled.len()
    );
    if mismatches > 0 || sampler.commits != expected_count {
        bail!("the walk disagrees with git");
    }
    println!("the walk agrees with git");
    Ok(())
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .with_context(|| format!("running git {}", args.join(" ")))?;
    if !out.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    String::from_utf8(out.stdout).context("git output was not UTF-8")
}

/// Runs one `git diff-tree` over every sampled commit and parses its output.
///
/// `-c` gives the combined diff for merges, `--root` makes root commits diff
/// against the empty tree, and `--no-renames` reports renames as the delete and
/// add the walk also reports. For a merge, git prints one status letter per
/// parent; `A` from every parent is an addition, `D` from every parent a
/// deletion, and anything else a modification.
///
/// Raw output carries modes, which is how submodule entries (mode 160000) are
/// recognised and dropped: the walk skips them on purpose, because a gitlink
/// points into another repository rather than at a file in this one.
fn diff_tree(repo: &Path, ids: &[Oid]) -> Result<HashMap<Oid, Changes>> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args([
            "diff-tree",
            "--stdin",
            "-r",
            "-c",
            "--root",
            "--raw",
            "--no-renames",
            "--no-ext-diff",
            "-z",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .context("spawning git diff-tree")?;
    {
        let mut stdin = child.stdin.take().context("git stdin")?;
        let input: String = ids.iter().map(|id| format!("{}\n", id.to_hex())).collect();
        std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    }
    let out = child
        .wait_with_output()
        .context("waiting for git diff-tree")?;
    if !out.status.success() {
        bail!("git diff-tree failed");
    }

    // With -z, fields are NUL-separated: a commit id, then pairs of a raw
    // header (`:modes... oids... STATUS`) and a path, until the next commit id.
    let mut result: HashMap<Oid, Changes> = HashMap::new();
    let mut current: Option<Oid> = None;
    let mut fields = out.stdout.split(|&b| b == 0).peekable();
    while let Some(field) = fields.next() {
        let text = String::from_utf8_lossy(field);
        let text = text.trim_matches('\n');
        if text.is_empty() {
            continue;
        }
        if let Some(id) = Oid::from_hex(text) {
            current = Some(id);
            result.entry(id).or_default();
            continue;
        }
        let Some(id) = current else {
            continue;
        };
        let Some(path) = fields.next() else {
            break;
        };
        let header = text.trim_start_matches(':');
        let parts: Vec<&str> = header.split(' ').collect();
        let Some(letters) = parts.last() else {
            continue;
        };
        // Modes come first: one per parent, then the commit's own.
        let modes = parts.len().saturating_sub(1) / 2;
        let is_gitlink = |m: &&str| *m == "160000";
        let own_mode = parts.get(modes.saturating_sub(1));
        let parent_modes = parts.get(..modes.saturating_sub(1)).unwrap_or(&[]);
        let submodule = own_mode.is_some_and(is_gitlink)
            || (own_mode == Some(&"000000")
                && parent_modes.iter().all(|m| is_gitlink(m) || *m == "000000"));
        if submodule {
            continue;
        }
        let text = *letters;
        let status = if text.chars().all(|c| c == 'A') {
            'A'
        } else if text.chars().all(|c| c == 'D') {
            'D'
        } else {
            'M'
        };
        result
            .entry(id)
            .or_default()
            .insert((status, String::from_utf8_lossy(path).into_owned()));
    }
    Ok(result)
}
