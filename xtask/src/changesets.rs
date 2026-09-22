//! The data `--max-changeset-size` is chosen from: how many files commits
//! touch, and how large Change Coupling's pair map gets, on real
//! repositories.

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use commitscape_index::{load, CacheOptions, GixRepo, Since};
use commitscape_metrics::{Analysis, Options, Span};

pub fn run(repos: &[PathBuf]) -> Result<()> {
    for repo in repos {
        report(repo).with_context(|| format!("reporting on {}", repo.display()))?;
    }
    Ok(())
}

fn report(path: &Path) -> Result<()> {
    let source = GixRepo::open(path)?;
    let cache = crate::workspace_root()
        .join("target")
        .join("bench-cache")
        .join("changesets");
    let loaded = load(
        &source,
        &CacheOptions { root: Some(cache) },
        Since::All,
        &mut |_| {},
    )?;
    let index = &loaded.index;
    let anchor = index.span.newest.unwrap_or(0);
    println!(
        "{}: {} commits, {} files at HEAD",
        path.display(),
        index.span.commits,
        index.head.len()
    );

    for span in [Span::All, Span::Year] {
        let a = Analysis::new(index, span.window(anchor), Options::default())?;
        let sizes = a.changeset_sizes();
        let row: Vec<String> = sizes
            .buckets
            .iter()
            .map(|b| {
                let range = match (b.from, b.to) {
                    (f, t) if f == t => format!("{f}"),
                    (f, u32::MAX) => format!("{f}+"),
                    (f, t) => format!("{f}-{t}"),
                };
                let share = 100.0 * b.commits as f64 / sizes.commits.max(1) as f64;
                format!("{range}:{share:.1}%")
            })
            .collect();
        println!(
            "  {:<4} {} non-merge commits; median {}, p90 {}, p99 {}, max {}",
            span.label(),
            sizes.commits,
            sizes.median,
            sizes.p90,
            sizes.p99,
            sizes.max
        );
        println!("       {}", row.join("  "));
        // Each threshold is a histogram bound, so whole buckets sum exactly.
        for threshold in [20u32, 50, 100] {
            let over = sizes
                .buckets
                .iter()
                .filter(|b| b.from > threshold)
                .map(|b| b.commits)
                .sum::<u32>();
            println!(
                "       over {threshold}: {over} commits ({:.2}%)",
                100.0 * over as f64 / sizes.commits.max(1) as f64
            );
        }
    }

    for span in [Span::Quarter, Span::Year, Span::All] {
        let a = Analysis::new(index, span.window(anchor), Options::default())?;
        let t = Instant::now();
        let coupling = a.coupling();
        println!(
            "  coupling {:<4} support {}: {} files, pair map {} pairs, {:.1}ms",
            span.label(),
            coupling.support,
            coupling.files,
            coupling.pair_count,
            t.elapsed().as_secs_f64() * 1000.0
        );
    }
    Ok(())
}
