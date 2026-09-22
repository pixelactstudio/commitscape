//! The benchmark harness.
//!
//! ADR-0002 states budgets as acceptance criteria, so they need a number to
//! regress against from the first day rather than the day someone suspects a
//! problem. This harness exists before the thing it measures, deliberately.
//!
//! It refuses to run against a debug build. A debug-profile number would be
//! meaningless and, worse, would look like evidence.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Where the large benchmark repositories live. These are real clones, not
/// fixtures: the product thesis is performance at scale, and a number from a
/// small repository is not evidence about a large one.
fn bench_repo_root() -> PathBuf {
    std::env::var_os("COMMITSCAPE_BENCH_REPOS")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            crate::workspace_root()
                .parent()
                .unwrap_or(Path::new("."))
                .join(".commitscape-bench")
        })
}

pub struct BenchContext {
    /// Path to the release binary under test.
    pub binary: PathBuf,
    /// Root containing the large benchmark clones.
    pub repos: PathBuf,
}

impl BenchContext {
    /// Path to a named benchmark repository, if it has been cloned.
    // Unused until the Phase 1 cold-index benchmark lands; it is the mechanism
    // by which a benchmark reports SKIPPED instead of silently measuring nothing.
    #[allow(dead_code)]
    pub fn repo(&self, name: &str) -> Option<PathBuf> {
        let p = self.repos.join(name);
        p.join(".git").is_dir().then_some(p)
    }
}

struct Benchmark {
    name: &'static str,
    description: &'static str,
    default_iterations: u32,
    run: fn(&BenchContext) -> Result<Option<Duration>>,
}

/// The benchmark registry.
///
/// A benchmark returns `Ok(None)` when its inputs are not present (an unclonedd
/// repository, a cache that has not been built yet). That is reported as
/// SKIPPED rather than as a pass, because a benchmark that silently measures
/// nothing is worse than one that fails.
const BENCHMARKS: &[Benchmark] = &[
    Benchmark {
        name: "startup",
        description: "process launch to exit, doing no work — the floor of the warm-start budget",
        default_iterations: 20,
        run: bench_startup,
    },
    Benchmark {
        name: "cold-walk-rust",
        description: "full history walk of rust-lang/rust, no cache — ADR-0002 budget is 60s",
        default_iterations: 1,
        run: bench_cold_walk_rust,
    },
];

/// One full, uncached walk of `rust-lang/rust`.
///
/// The gating cold-index budget in ADR-0002. Reports the shape of the resulting
/// index as well as the time, because a fast walk that collected the wrong
/// amount of data is not a pass.
fn bench_cold_walk_rust(ctx: &BenchContext) -> Result<Option<Duration>> {
    let Some(path) = ctx.repo("rust") else {
        return Ok(None);
    };
    let repo = commitscape_index::GixRepo::open(&path).context("opening rust-lang/rust")?;

    let start = Instant::now();
    let index = commitscape_index::index_from_scratch(&repo).context("indexing rust-lang/rust")?;
    let elapsed = start.elapsed();

    let merges = index.commits.iter().filter(|c| c.is_merge()).count();
    let merge_changes: usize = index
        .commits
        .iter()
        .filter(|c| c.is_merge())
        .map(|c| c.changes_len as usize)
        .sum();

    println!(
        "  index: {} commits ({} merges), {} changes, {} paths, {} authors",
        index.commits.len(),
        merges,
        index.changes.len(),
        index.paths.len(),
        index.authors.len()
    );
    println!(
        "  merge commits account for {} of {} changes ({:.1}%)",
        merge_changes,
        index.changes.len(),
        100.0 * merge_changes as f64 / (index.changes.len().max(1)) as f64
    );
    println!(
        "  throughput: {:.0} commits/sec",
        index.commits.len() as f64 / elapsed.as_secs_f64().max(f64::EPSILON)
    );
    println!("  time ordered: {}", index.is_time_ordered());

    Ok(Some(elapsed))
}

/// Measures bare process startup: exec, dynamic linking, runtime init, exit.
///
/// This is the floor under ADR-0002's 100ms warm-start budget. Every
/// millisecond here is one the index is not allowed to spend, and it is also
/// the number the npm shim in ADR-0003 adds Node's own startup on top of.
fn bench_startup(ctx: &BenchContext) -> Result<Option<Duration>> {
    let start = Instant::now();
    let status = Command::new(&ctx.binary)
        .arg("--version")
        .output()
        .with_context(|| format!("spawning {}", ctx.binary.display()))?;
    let elapsed = start.elapsed();
    if !status.status.success() {
        bail!(
            "benchmark binary exited with {}: {}",
            status.status,
            String::from_utf8_lossy(&status.stderr)
        );
    }
    Ok(Some(elapsed))
}

struct Stats {
    min: Duration,
    median: Duration,
    mean: Duration,
    max: Duration,
    samples: usize,
}

fn stats(mut samples: Vec<Duration>) -> Option<Stats> {
    if samples.is_empty() {
        return None;
    }
    samples.sort_unstable();
    let n = samples.len();
    let total: Duration = samples.iter().sum();
    Some(Stats {
        min: *samples.first()?,
        median: *samples.get(n / 2)?,
        mean: total / (n as u32),
        max: *samples.last()?,
        samples: n,
    })
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

pub fn run(filter: Option<&str>, iterations: Option<u32>) -> Result<()> {
    let root = crate::workspace_root();
    let binary = root.join("target/release/commitscape");

    if !binary.is_file() {
        println!("release binary not found, building it first...");
        let status = Command::new(env!("CARGO"))
            .args(["build", "--release", "--package", "commitscape"])
            .current_dir(&root)
            .status()
            .context("building the release binary")?;
        if !status.success() {
            bail!("release build failed; refusing to benchmark a debug build");
        }
    }

    let ctx = BenchContext {
        binary,
        repos: bench_repo_root(),
    };

    println!("commitscape benchmark harness");
    println!("  binary: {}", ctx.binary.display());
    println!("  repos:  {}", ctx.repos.display());
    println!();

    let mut records = Vec::new();
    let mut ran_any = false;

    for b in BENCHMARKS {
        if let Some(f) = filter {
            if !b.name.contains(f) {
                continue;
            }
        }
        ran_any = true;
        let iters = iterations.unwrap_or(b.default_iterations);

        let mut samples = Vec::new();
        let mut skipped = false;
        for _ in 0..iters {
            match (b.run)(&ctx)? {
                Some(d) => samples.push(d),
                None => {
                    skipped = true;
                    break;
                }
            }
        }

        if skipped {
            println!("{:<14} SKIPPED  (inputs not present)", b.name);
            println!("{:<14}          {}", "", b.description);
            continue;
        }

        let Some(s) = stats(samples) else {
            println!("{:<14} SKIPPED  (no samples)", b.name);
            continue;
        };

        println!(
            "{:<14} min {:>8.2}ms   median {:>8.2}ms   mean {:>8.2}ms   max {:>8.2}ms   n={}",
            b.name,
            ms(s.min),
            ms(s.median),
            ms(s.mean),
            ms(s.max),
            s.samples
        );
        println!("{:<14} {}", "", b.description);

        records.push(format!(
            r#"    {{"name":"{}","min_ms":{:.3},"median_ms":{:.3},"mean_ms":{:.3},"max_ms":{:.3},"samples":{}}}"#,
            b.name,
            ms(s.min),
            ms(s.median),
            ms(s.mean),
            ms(s.max),
            s.samples
        ));
    }

    if !ran_any {
        bail!("no benchmark matched the filter");
    }

    write_results(&root, &records)?;
    Ok(())
}

fn write_results(root: &Path, records: &[String]) -> Result<()> {
    let dir = root.join("bench-results");
    std::fs::create_dir_all(&dir).context("creating bench-results/")?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let sha = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".into());

    let body = format!(
        "{{\n  \"unix_time\": {stamp},\n  \"commit\": \"{sha}\",\n  \"benchmarks\": [\n{}\n  ]\n}}\n",
        records.join(",\n")
    );

    let path = dir.join(format!("{stamp}-{sha}.json"));
    std::fs::write(&path, &body).with_context(|| format!("writing {}", path.display()))?;
    std::fs::write(dir.join("latest.json"), &body).context("writing latest.json")?;

    println!();
    println!("recorded -> {}", path.display());
    Ok(())
}
