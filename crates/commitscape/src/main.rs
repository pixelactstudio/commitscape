//! `commitscape` binary entry point.

mod json;
mod text;

use std::io::{IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use commitscape_index::{default_cache_root, load, CacheOptions, GixRepo, Progress, Since};
use commitscape_metrics::{Analysis, Options, Span};

use crate::text::grouped;

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

    /// Print every metric as one JSON document. The Window ends at the newest
    /// commit rather than now, so the same repository gives the same output.
    #[arg(long)]
    json: bool,

    /// Rows in each ranking of the JSON output.
    #[arg(long, default_value_t = 20, value_name = "ROWS")]
    top: usize,

    /// A commit touching more files than this is a Bulk Commit, left out of
    /// Churn, Ownership and Change Coupling.
    #[arg(long, value_name = "FILES")]
    max_changeset_size: Option<u32>,

    /// The fewest commits a file needs in the Window to be counted for
    /// Change Coupling.
    #[arg(long, value_name = "COMMITS")]
    coupling_support: Option<u32>,

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
    // `--json` ends the Window at the newest commit so its output is
    // reproducible; the summary ends it now, as the interface does.
    let since = match (cli.window.days(), cli.json) {
        (None, _) => Since::All,
        (Some(days), true) => Since::BeforeNewest(i64::from(days) * DAY),
        (Some(days), false) => Since::Time(now() - i64::from(days) * DAY),
    };

    let mut meter = ProgressLine::new();
    let loaded = load(&repo, &options, since, &mut |p| meter.show(p))?;
    meter.clear();

    let anchor = if cli.json {
        loaded.index.span.newest.unwrap_or(0)
    } else {
        now()
    };
    let defaults = Options::default();
    let metrics = Options {
        max_changeset_size: cli
            .max_changeset_size
            .unwrap_or(defaults.max_changeset_size),
        coupling_support: cli.coupling_support.unwrap_or(defaults.coupling_support),
        ..defaults
    };
    let analysis = Analysis::new(&loaded.index, cli.window.window(anchor), metrics)?;

    let mut out = std::io::stdout().lock();
    if cli.json {
        serde_json::to_writer_pretty(&mut out, &json::report(&analysis, cli.window, cli.top))?;
        writeln!(out)?;
    } else {
        let summary = text::summary(&cli.repo, &loaded.index, loaded.freshness);
        write!(out, "{summary}{}", text::rankings(&analysis, cli.window))?;
    }
    Ok(())
}

const DAY: i64 = 86_400;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
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
