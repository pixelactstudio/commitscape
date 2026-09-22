//! `commitscape` binary entry point.

use std::io::{IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use commitscape_core::{civil_from_unix, Index};
use commitscape_index::{
    default_cache_root, load, CacheOptions, Freshness, GixRepo, Progress, RebuildReason, Since,
};
use commitscape_metrics::{Age, Analysis, Options, Span};

/// How many rows each ranking shows.
const TOP: usize = 10;

#[derive(Parser)]
#[command(
    name = "commitscape",
    version,
    about = "Reads a git repository and reports what changes what you do next."
)]
struct Cli {
    /// Path to the repository. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// The Window every number is computed over: 30d, 90d, 1y or all.
    #[arg(long, default_value = "90d", value_parser = parse_span)]
    window: Span,

    /// A commit touching more files than this is a Bulk Commit, left out of
    /// Churn and Change Coupling.
    #[arg(long, value_name = "FILES")]
    max_changeset_size: Option<u32>,

    /// Where to keep the index cache. Defaults to COMMITSCAPE_CACHE_DIR, then
    /// the platform's cache directory.
    #[arg(long, value_name = "DIR")]
    cache_dir: Option<PathBuf>,

    /// Index from scratch and neither read nor write a cache.
    #[arg(long)]
    no_cache: bool,
}

fn parse_span(s: &str) -> Result<Span, String> {
    Span::from_label(s).ok_or_else(|| format!("expected 30d, 90d, 1y or all, got {s:?}"))
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("commitscape: {e:#}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> anyhow::Result<()> {
    let repo = GixRepo::open(&cli.repo)?;
    let options = CacheOptions {
        root: if cli.no_cache {
            None
        } else {
            cli.cache_dir.clone().or_else(default_cache_root)
        },
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let window = cli.window.window(now);

    let mut meter = ProgressLine::new();
    let loaded = load(
        &repo,
        &options,
        window.from.map_or(Since::All, Since::Time),
        &mut |p| meter.show(p),
    )?;
    meter.clear();

    let metrics = Options {
        max_changeset_size: cli
            .max_changeset_size
            .unwrap_or(Options::default().max_changeset_size),
        ..Options::default()
    };
    let analysis = Analysis::new(&loaded.index, window, metrics)?;
    print!("{}", summary(&cli, &loaded.index, loaded.freshness));
    print!("{}", rankings(&analysis, cli.window));
    Ok(())
}

fn summary(cli: &Cli, index: &Index, freshness: Freshness) -> String {
    let span = index.span;
    let dates = match (span.oldest, span.newest) {
        (Some(a), Some(b)) => format!(", from {} to {}", date(a), date(b)),
        _ => String::new(),
    };
    let floor = if index.history_truncated {
        " (shallow clone: history is truncated, so this is a floor)"
    } else {
        ""
    };
    let how = match freshness {
        Freshness::Warm => "read from cache".to_string(),
        Freshness::Updated { added } => format!("cache updated with {added} new commits"),
        Freshness::Built { reason } => format!(
            "indexed from scratch ({})",
            match reason {
                RebuildReason::Disabled => "cache disabled",
                RebuildReason::NoCache => "first run",
                RebuildReason::SchemaChanged => "cache from another version",
                RebuildReason::Unreadable => "cache was damaged",
                RebuildReason::HistoryRewritten => "history was rewritten",
            }
        ),
    };
    format!(
        "{}\n  {}, {} of them merges{dates}{floor}\n  {} at HEAD, {} tracked over time, {}\n  {how}\n",
        cli.repo.display(),
        counted(span.commits, "commit", "commits"),
        grouped(span.merges),
        counted(index.head.len() as u64, "file", "files"),
        grouped(index.paths.len() as u64),
        counted(index.authors.len() as u64, "person", "people"),
    )
}

fn rankings(analysis: &Analysis<'_>, span: Span) -> String {
    let index = analysis.index();
    let path = |f| index.paths.path_lossy(f);
    let counts = analysis.commits();
    let mut out = String::new();
    out.push_str(&format!(
        "\nWindow {}: {} in the window; {} merges and {} bulk commits (over {} files) not counted\n",
        span.label(),
        counted(counts.in_window, "commit", "commits"),
        grouped(counts.merges),
        grouped(counts.bulk),
        analysis.options().max_changeset_size,
    ));

    out.push_str("\nLargest files (lines, generated files excluded)\n");
    for (i, f) in analysis.largest().iter().take(TOP).enumerate() {
        out.push_str(&format!(
            "  {:>2}  {:>9}  {}\n",
            i + 1,
            grouped(f.loc as u64),
            path(f.file)
        ));
    }

    out.push_str("\nHotspots (churn in the window, and indentation complexity, both ranked)\n");
    let hotspots = analysis.hotspots();
    if hotspots.is_empty() {
        out.push_str("  none: nothing a person wrote changed in this window\n");
    }
    for (i, h) in hotspots.iter().take(TOP).enumerate() {
        out.push_str(&format!(
            "  {:>2}  churn {:>5}  complexity {:>9}  {}\n",
            i + 1,
            grouped(h.churn as u64),
            grouped(h.complexity as u64),
            path(h.file)
        ));
    }

    let held: Vec<_> = analysis
        .ownership()
        .into_iter()
        .filter(|d| d.bus_factor == 1 && !d.dir.is_empty())
        .collect();
    out.push_str(&format!(
        "\nDirectories one person holds (bus factor 1, over {} commits in the window): {}\n",
        analysis.options().ownership_min_commits,
        grouped(held.len() as u64)
    ));
    for (i, d) in held.iter().take(TOP).enumerate() {
        let owner = d.owners.first();
        let who = owner
            .and_then(|o| index.authors.get(o.author))
            .map(|a| a.name.to_string())
            .unwrap_or_default();
        let share = owner.map_or(0.0, |o| 100.0 * o.commits as f64 / d.commits.max(1) as f64);
        out.push_str(&format!(
            "  {:>2}  {:>3.0}% of {:>4} commits  {:<24}  {}\n",
            i + 1,
            share,
            d.commits,
            who,
            String::from_utf8_lossy(&d.dir)
        ));
    }

    let staleness = analysis.staleness();
    out.push_str("\nStaleness of the files people wrote, by last touch\n");
    for bucket in &staleness.buckets {
        out.push_str(&format!(
            "  {:<16} {:>7}\n",
            bucket.age.label(),
            grouped(bucket.files as u64)
        ));
    }
    debug_assert_eq!(staleness.buckets.len(), Age::EVERY.len());

    let duplicates = analysis.suspected_duplicates();
    if !duplicates.is_empty() {
        out.push_str(&format!(
            "\n{} groups of people may be one person each. Nothing was merged; to join them, add lines like these to .mailmap:\n",
            duplicates.len()
        ));
        if let Some(first) = duplicates.first() {
            for line in analysis.mailmap_for(first).lines().take(3) {
                out.push_str(&format!("  {line}\n"));
            }
        }
    }
    out
}

fn counted(n: u64, one: &str, many: &str) -> String {
    format!("{} {}", grouped(n), if n == 1 { one } else { many })
}

fn date(unix: i64) -> String {
    let (y, m, d) = civil_from_unix(unix);
    format!("{y:04}-{m:02}-{d:02}")
}

/// `1234567` as `1,234,567`.
fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// A single progress line on stderr, redrawn in place. Silent when stderr is
/// not a terminal, so piped output stays clean.
struct ProgressLine {
    live: bool,
    drawn: bool,
}

impl ProgressLine {
    fn new() -> Self {
        ProgressLine {
            live: std::io::stderr().is_terminal(),
            drawn: false,
        }
    }

    fn show(&mut self, p: Progress) {
        if !self.live {
            return;
        }
        let line = match p {
            Progress::History { done, total } => format!(
                "indexing history: {} / {} commits",
                grouped(done),
                grouped(total)
            ),
            Progress::HeadFiles => "reading the files at HEAD".to_string(),
        };
        let mut err = std::io::stderr().lock();
        let _ = write!(err, "\r\x1b[2K{line}");
        let _ = err.flush();
        self.drawn = true;
    }

    fn clear(&mut self) {
        if self.drawn {
            let mut err = std::io::stderr().lock();
            let _ = write!(err, "\r\x1b[2K");
            let _ = err.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::grouped;

    #[test]
    fn large_numbers_are_grouped_in_thousands() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(1000), "1,000");
        assert_eq!(grouped(345_135), "345,135");
        assert_eq!(grouped(1_489_215), "1,489,215");
    }
}
