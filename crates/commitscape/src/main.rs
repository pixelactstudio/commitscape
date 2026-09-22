//! `commitscape` binary entry point.

use std::io::{IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use commitscape_core::{civil_from_unix, Index};
use commitscape_index::{
    default_cache_root, load, CacheOptions, Freshness, GixRepo, Progress, RebuildReason, Since,
};

/// The window the summary is loaded for until windows are selectable.
const DEFAULT_WINDOW_DAYS: i64 = 90;
const DAY: i64 = 86_400;

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

    /// Where to keep the index cache. Defaults to COMMITSCAPE_CACHE_DIR, then
    /// the platform's cache directory.
    #[arg(long, value_name = "DIR")]
    cache_dir: Option<PathBuf>,

    /// Index from scratch and neither read nor write a cache.
    #[arg(long)]
    no_cache: bool,
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
            cli.cache_dir.or_else(default_cache_root)
        },
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut meter = ProgressLine::new();
    let loaded = load(
        &repo,
        &options,
        Since::Time(now - DEFAULT_WINDOW_DAYS * DAY),
        &mut |p| meter.show(p),
    )?;
    meter.clear();

    print!("{}", summary(&cli.repo, &loaded.index, loaded.freshness));
    Ok(())
}

fn summary(path: &std::path::Path, index: &Index, freshness: Freshness) -> String {
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
        "{}\n  {}, {} of them merges{dates}{floor}\n  {} tracked over time, {}\n  {how}\n",
        path.display(),
        counted(span.commits, "commit", "commits"),
        grouped(span.merges),
        counted(index.paths.len() as u64, "file", "files"),
        counted(index.authors.len() as u64, "person", "people"),
    )
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
        let Progress::History { done, total } = p;
        let mut err = std::io::stderr().lock();
        let _ = write!(
            err,
            "\r\x1b[2Kindexing history: {} / {} commits",
            grouped(done),
            grouped(total)
        );
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
