//! What the line pass (ADR-0012) costs on a real repository: every
//! non-merge commit's changes diffed line by line, timed, with the share
//! that Bulk Commits and lockfiles take.

use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

use anyhow::{Context, Result};
use commitscape_index::{load, CacheOptions, GixRepo, RepoSource, Since};

pub fn run(path: &Path, newest: Option<usize>, verify: bool) -> Result<()> {
    let source = GixRepo::open(path)?;
    let cache = crate::workspace_root()
        .join("target")
        .join("bench-cache")
        .join("line-cost");
    let loaded = load(
        &source,
        &CacheOptions { root: Some(cache) },
        Since::All,
        &mut |_| {},
    )
    .context("loading the index")?;
    let index = loaded.index;
    let mut commits: Vec<_> = index
        .commits
        .iter()
        .rev()
        .filter(|c| !c.is_merge())
        .map(|c| (c.id, c.changes_len))
        .collect();
    let all = commits.len();
    if let Some(n) = newest {
        commits.truncate(n);
    }
    if verify {
        return compare_with_git(path, &source, &commits);
    }
    let bulk = |n: u32| n > 50;
    let (small, big): (Vec<_>, Vec<_>) = commits.iter().partition(|(_, n)| !bulk(*n));
    for (label, set) in [
        ("commits of 50 files or fewer", small),
        ("Bulk Commits", big),
    ] {
        let ids: Vec<_> = set.iter().map(|(id, _)| *id).collect();
        let totals = Mutex::new((0u64, 0u64, 0u64, 0u64));
        let started = Instant::now();
        source.count_lines(&ids, &|_, raws, deltas| {
            if let Ok(mut t) = totals.lock() {
                for (raw, d) in raws.iter().zip(deltas) {
                    t.0 += 1;
                    match d {
                        Some(d) => t.1 += u64::from(d.added) + u64::from(d.removed),
                        None => t.2 += 1,
                    }
                    let name = raw.path.rsplit(|&b| b == b'/').next().unwrap_or(raw.path);
                    if name.ends_with(b".lock")
                        || name.ends_with(b"-lock.json")
                        || name == b"pnpm-lock.yaml"
                    {
                        t.3 += 1;
                    }
                }
            }
        })?;
        let took = started.elapsed();
        let (changes, lines, uncounted, locks) = totals.into_inner().unwrap_or_default();
        println!(
            "{label}: {} commits, {changes} changes ({locks} to lockfiles), {lines} lines, {uncounted} not counted, {:.1}s, {:.0} commits/s",
            ids.len(),
            took.as_secs_f64(),
            ids.len() as f64 / took.as_secs_f64().max(1e-9)
        );
    }
    println!("non-merge commits in all of history: {all}");
    Ok(())
}

/// Compares every change's count with `git show --numstat --no-renames`.
fn compare_with_git(
    path: &Path,
    source: &GixRepo,
    commits: &[(commitscape_core::Oid, u32)],
) -> Result<()> {
    let ids: Vec<_> = commits.iter().map(|(id, _)| *id).collect();
    let ours = Mutex::new(Vec::new());
    source.count_lines(&ids, &|id, raws, deltas| {
        if let Ok(mut o) = ours.lock() {
            for (raw, d) in raws.iter().zip(deltas) {
                o.push((id, String::from_utf8_lossy(raw.path).into_owned(), *d));
            }
        }
    })?;
    let ours = ours.into_inner().unwrap_or_default();
    let (mut same, mut differ, mut uncounted) = (0, 0, 0);
    let (mut git_total, mut our_total) = (0u64, 0u64);
    let mut shown = 0;
    for id in &ids {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(path)
            .args([
                "show",
                "--numstat",
                "--no-renames",
                "--diff-algorithm=myers",
                "--format=",
            ])
            .arg(id.to_string())
            .output()?;
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let mut parts = line.splitn(3, '\t');
            let (Some(a), Some(r), Some(p)) = (parts.next(), parts.next(), parts.next()) else {
                continue;
            };
            let mine = ours.iter().find(|(i, q, _)| i == id && q == p).map(|x| x.2);
            if let (Ok(a), Ok(r), Some(Some(d))) = (a.parse::<u64>(), r.parse::<u64>(), mine) {
                git_total += a + r;
                our_total += u64::from(d.added) + u64::from(d.removed);
            }
            match (a.parse::<u32>(), r.parse::<u32>(), mine) {
                (Ok(a), Ok(r), Some(Some(d))) if d.added == a && d.removed == r => same += 1,
                (_, _, Some(None)) => uncounted += 1,
                (a, r, mine) => {
                    differ += 1;
                    if shown < 15 {
                        shown += 1;
                        println!("{id} {p}: git {a:?}/{r:?}, ours {mine:?}");
                    }
                }
            }
        }
    }
    println!("same as git: {same}, different: {differ}, not counted by us: {uncounted}");
    println!(
        "lines changed where both counted: git {git_total}, ours {our_total} ({:+.2}%)",
        100.0 * (our_total as f64 - git_total as f64) / (git_total.max(1) as f64)
    );
    Ok(())
}
