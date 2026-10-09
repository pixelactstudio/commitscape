use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    pub binary: PathBuf,
    pub repos: PathBuf,
    pub workspace: PathBuf,
}

impl BenchContext {
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

const BENCHMARKS: &[Benchmark] = &[
    Benchmark {
        name: "startup",
        description: "process launch to exit, doing no work — the floor of the warm-start budget",
        default_iterations: 20,
        run: bench_startup,
    },
    Benchmark {
        name: "cold-index-rust",
        description: "full index of rust-lang/rust, history walk and HEAD pass, no cache; ADR-0002 budget is 60s",
        default_iterations: 1,
        run: bench_cold_index_rust,
    },
    Benchmark {
        name: "warm-start-rust",
        description: "binary start to exit on rust-lang/rust with a warm cache, listing its authors; ADR-0002 budget is 100ms",
        default_iterations: 20,
        run: bench_warm_start_rust,
    },
    Benchmark {
        name: "warm-start-linux",
        description: "binary start to exit on torvalds/linux with a warm cache; the budget holds at every scale",
        default_iterations: 20,
        run: bench_warm_start_linux,
    },
    Benchmark {
        name: "warm-update-rust",
        description: "binary start to exit on rust-lang/rust when a few hundred commits are new; ADR-0002 budget is 300ms",
        default_iterations: 10,
        run: bench_warm_update_rust,
    },
    Benchmark {
        name: "cold-index-linux",
        description: "binary start to exit on torvalds/linux with no cache; an honest stress number, not gating",
        default_iterations: 1,
        run: bench_cold_index_linux,
    },
];

fn bench_cache(ctx: &BenchContext, name: &str) -> PathBuf {
    ctx.workspace.join("target").join("bench-cache").join(name)
}

fn time_binary(ctx: &BenchContext, repo: &Path, cache: &Path) -> Result<Duration> {
    let start = Instant::now();
    let out = Command::new(&ctx.binary)
        .arg("signatures")
        .arg(repo)
        .arg("--out")
        .arg(std::env::temp_dir().join("commitscape-bench-signatures.json"))
        .env("COMMITSCAPE_CACHE_DIR", cache)
        .output()
        .with_context(|| format!("spawning {}", ctx.binary.display()))?;
    let elapsed = start.elapsed();
    if !out.status.success() {
        bail!(
            "commitscape exited with {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(elapsed)
}

fn warm_start(ctx: &BenchContext, name: &str) -> Result<Option<Duration>> {
    let Some(repo) = ctx.repo(name) else {
        return Ok(None);
    };
    let cache = bench_cache(ctx, name);
    time_binary(ctx, &repo, &cache)?;
    time_binary(ctx, &repo, &cache).map(Some)
}

fn bench_warm_start_rust(ctx: &BenchContext) -> Result<Option<Duration>> {
    warm_start(ctx, "rust")
}

fn bench_warm_start_linux(ctx: &BenchContext) -> Result<Option<Duration>> {
    warm_start(ctx, "linux")
}

fn bench_cold_index_linux(ctx: &BenchContext) -> Result<Option<Duration>> {
    let Some(repo) = ctx.repo("linux") else {
        return Ok(None);
    };
    let cache = bench_cache(ctx, "linux-cold");
    if cache.exists() {
        std::fs::remove_dir_all(&cache).context("clearing the cold-index cache")?;
    }
    let elapsed = time_binary(ctx, &repo, &cache)?;
    println!("  memory is not measured here: the index runs in a child process");
    Ok(Some(elapsed))
}

const UPDATE_REWIND: u32 = 40;

fn bench_warm_update_rust(ctx: &BenchContext) -> Result<Option<Duration>> {
    let Some(source) = ctx.repo("rust") else {
        return Ok(None);
    };
    let scratch = ctx
        .workspace
        .join("target")
        .join("bench-scratch")
        .join("rust-update");
    let cache = bench_cache(ctx, "rust-update");
    let saved = bench_cache(ctx, "rust-update-saved");
    let git = |args: &[&str]| -> Result<String> {
        let out = Command::new("git")
            .arg("-C")
            .arg(&scratch)
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
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    };

    if !scratch.join(".git").is_dir() {
        std::fs::create_dir_all(scratch.parent().unwrap_or(&scratch))?;
        let status = Command::new("git")
            .args(["clone", "--quiet", "--shared", "--no-checkout"])
            .arg(&source)
            .arg(&scratch)
            .status()
            .context("making a shared clone for the update benchmark")?;
        if !status.success() {
            bail!("could not make a shared clone of {}", source.display());
        }
        let tip = git(&["rev-parse", "refs/remotes/origin/main"])?;
        git(&["config", "commitscape.bench.tip", &tip])?;
        for r in git(&["for-each-ref", "--format=%(refname)", "refs/remotes"])?.lines() {
            git(&["update-ref", "-d", r])?;
        }
    }
    let tip = git(&["config", "--get", "commitscape.bench.tip"])?;
    let old = git(&["rev-parse", &format!("{tip}~{UPDATE_REWIND}")])?;

    if !saved.join("done").exists() {
        git(&["update-ref", "refs/heads/main", &old])?;
        if cache.exists() {
            std::fs::remove_dir_all(&cache)?;
        }
        time_binary(ctx, &scratch, &cache)?;
        copy_dir(&cache, &saved)?;
        std::fs::write(saved.join("done"), b"")?;
    }

    let new = git(&["rev-list", "--count", &format!("{old}..{tip}")])?;
    if cache.exists() {
        std::fs::remove_dir_all(&cache)?;
    }
    copy_dir(&saved, &cache)?;
    git(&["update-ref", "refs/heads/main", &tip])?;
    let elapsed = time_binary(ctx, &scratch, &cache)?;
    git(&["update-ref", "refs/heads/main", &old])?;
    println!("  {new} new commits");
    Ok(Some(elapsed))
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), to.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn bench_cold_index_rust(ctx: &BenchContext) -> Result<Option<Duration>> {
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
    println!("  files at HEAD: {}", index.head.len());
    println!(
        "  memory: peak {} resident; now {} anonymous, {} mapped from files",
        proc_status_mb("VmHWM"),
        proc_status_mb("RssAnon"),
        proc_status_mb("RssFile")
    );

    Ok(Some(elapsed))
}

fn proc_status_mb(field: &str) -> String {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|status| {
            status
                .lines()
                .find_map(|l| l.strip_prefix(field)?.strip_prefix(':'))
                .and_then(|v| v.trim().strip_suffix("kB"))
                .and_then(|kb| kb.trim().parse::<u64>().ok())
        })
        .map(|kb| format!("{} MB", kb / 1024))
        .unwrap_or_else(|| "unavailable on this platform".to_string())
}

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

    let status = Command::new(env!("CARGO"))
        .args(["build", "--release", "--package", "commitscape"])
        .current_dir(&root)
        .status()
        .context("building the release binary")?;
    if !status.success() {
        bail!("release build failed; refusing to benchmark a debug build");
    }

    let ctx = BenchContext {
        binary,
        repos: bench_repo_root(),
        workspace: root.clone(),
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
