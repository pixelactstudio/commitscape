//! `commitscape` binary entry point.

mod json;
mod people;
mod text;

use std::io::{IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use commitscape_core::Index;
use commitscape_forge::{GitHub, Remote};
use commitscape_index::RepoSource;
use commitscape_index::{
    default_cache_root, load, reresolve_authors, CacheOptions, GixRepo, IdentityRules,
    IdentityStore, Progress, Since,
};
use commitscape_metrics::{Analysis, Options, Span};
use commitscape_tui::format::grouped;
use commitscape_tui::{ChangePeople, LinkAccounts, LoadGitHub, LoadOlder, Session};

#[derive(Parser)]
#[command(
    name = "commitscape",
    version,
    about = "Reads a git repository and reports what changes what you do next.",
    args_conflicts_with_subcommands = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

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

    /// Print the plain-text summary even in a terminal, instead of opening
    /// the interface.
    #[arg(long, conflicts_with = "json")]
    summary: bool,

    /// Rows in each ranking of the JSON output.
    #[arg(long, default_value_t = 20, value_name = "ROWS")]
    top: usize,

    #[command(flatten)]
    common: Common,

    /// Draw the interface's first frame and exit: what the first-paint
    /// benchmark times.
    #[arg(long, hide = true)]
    exit_after_first_paint: bool,
}

#[derive(Subcommand)]
enum Command {
    /// Draw the repository's story on a card to share, as an SVG image.
    Card(CardArgs),
}

#[derive(Args)]
struct CardArgs {
    /// Path to the repository. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// Where to write the card. Defaults to <repository>-card.svg in the
    /// current directory.
    #[arg(long, value_name = "FILE")]
    out: Option<PathBuf>,

    /// The Window the card tells: 30d, 90d, 1y or all.
    #[arg(long, default_value = "all", value_parser = parse_span)]
    window: Span,

    #[command(flatten)]
    common: Common,
}

/// Options every way of running it shares.
#[derive(Args)]
struct Common {
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

    /// Never ask GitHub (through the gh CLI) about the repository.
    #[arg(long)]
    offline: bool,
}

impl Common {
    fn cache(&self) -> CacheOptions {
        CacheOptions {
            root: if self.no_cache {
                None
            } else {
                self.cache_dir.clone().or_else(default_cache_root)
            },
        }
    }

    fn metrics(&self) -> Options {
        let defaults = Options::default();
        Options {
            max_changeset_size: self
                .max_changeset_size
                .unwrap_or(defaults.max_changeset_size),
            coupling_support: self.coupling_support.unwrap_or(defaults.coupling_support),
            ..defaults
        }
    }
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
    if let Some(Command::Card(args)) = cli.command {
        return card(args);
    }
    let repo = GixRepo::open(&cli.repo)?;
    let options = cli.common.cache();
    // `--json` ends the Window at the newest commit so its output is
    // reproducible; the summary ends it now, as the interface does.
    let since = match (cli.window.days(), cli.json) {
        (None, _) => Since::All,
        (Some(days), true) => Since::BeforeNewest(i64::from(days) * DAY),
        (Some(days), false) => Since::Time(now() - i64::from(days) * DAY),
    };

    let interactive = cli.exit_after_first_paint
        || (!cli.json
            && !cli.summary
            && std::io::stdout().is_terminal()
            && std::io::stdin().is_terminal());

    let mut meter = ProgressLine::new();
    let mut loaded = load(&repo, &options, since, &mut |p| meter.show(p))?;
    meter.clear();

    let anchor = if cli.json {
        // Reproducible means from the repository alone: GitHub's links and
        // the user's undos live in the cache directory, so they are left out.
        let store = IdentityStore::for_repo(&options, &loaded.index.repo);
        if store.is_some_and(|s| s.rules(Default::default()).has_extras()) {
            reresolve_authors(
                &mut loaded.index,
                &IdentityRules::from_mailmap(repo.mailmap()?),
            );
        }
        loaded.index.span.newest.unwrap_or(0)
    } else {
        now()
    };
    let metrics = cli.common.metrics();

    if interactive {
        // The rest of history is read on another thread once the first frame
        // is up, so a longer Window is ready by the time anyone asks for it.
        let older = loaded.take_rest().map(|rest| -> LoadOlder {
            Box::new(move |recent: &Index| rest.complete(recent).ok())
        });
        let offline = cli.common.offline || cli.exit_after_first_paint;
        let (change, link) = identities(&cli.repo, &repo, &options, &loaded.index, offline);
        let session = Session {
            name: repo_name(&loaded.index),
            index: loaded.index,
            anchor,
            span: cli.window,
            options: metrics,
            older,
            github: github(&repo, offline),
            people: change,
            link_accounts: link,
        };
        if cli.exit_after_first_paint {
            commitscape_tui::paint_once(session)?;
        } else {
            commitscape_tui::run(session)?;
        }
        return Ok(());
    }

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

/// Draws the card and writes it where it was asked to go.
fn card(args: CardArgs) -> anyhow::Result<()> {
    let repo = GixRepo::open(&args.repo)?;
    let mut meter = ProgressLine::new();
    let options = args.common.cache();
    let loaded = load(&repo, &options, Since::All, &mut |p| meter.show(p))?;
    meter.clear();
    let name = repo_name(&loaded.index);
    let (change, link) = identities(
        &args.repo,
        &repo,
        &options,
        &loaded.index,
        args.common.offline,
    );
    let session = Session {
        name: name.clone(),
        index: loaded.index,
        anchor: now(),
        span: args.window,
        options: args.common.metrics(),
        older: None,
        github: github(&repo, args.common.offline),
        people: change,
        link_accounts: link,
    };
    let out = args
        .out
        .unwrap_or_else(|| PathBuf::from(format!("{name}-card.svg")));
    std::fs::write(&out, commitscape_tui::svg(&commitscape_tui::card(session)))?;
    println!("wrote {}", out.display());
    Ok(())
}

const DAY: i64 = 86_400;

/// How the interface asks GitHub about the repository, or why it will not
/// (ADR-0009).
fn github(repo: &GixRepo, offline: bool) -> Result<LoadGitHub, String> {
    if offline {
        return Err("--offline was given".to_string());
    }
    let url = repo
        .remote_url()
        .ok_or_else(|| "this repository has no remote".to_string())?;
    let remote =
        Remote::parse(&url).ok_or_else(|| format!("its remote is not on GitHub ({url})"))?;
    Ok(Box::new(move || {
        GitHub::fetch(&remote).map_err(|e| e.to_string())
    }))
}

/// How the interface undoes merges and links GitHub accounts: neither
/// without a cache directory to keep them in, and no links offline or off
/// GitHub.
fn identities(
    path: &std::path::Path,
    repo: &GixRepo,
    options: &CacheOptions,
    index: &Index,
    offline: bool,
) -> (Option<ChangePeople>, Option<LinkAccounts>) {
    let Some(store) = IdentityStore::for_repo(options, &index.repo) else {
        return (None, None);
    };
    let path = path.to_path_buf();
    let remote = repo.remote_url().as_deref().and_then(Remote::parse);
    let link = remote
        .filter(|_| !offline)
        .map(|r| people::link(path.clone(), store.clone(), r));
    (Some(people::change(path, store)), link)
}

/// The repository's directory name: the parent of `.git`, or a bare
/// repository's own directory.
fn repo_name(index: &Index) -> String {
    let git_dir = std::path::Path::new(&index.repo.git_dir);
    let dir = if git_dir.file_name().is_some_and(|n| n == ".git") {
        git_dir.parent()
    } else {
        Some(git_dir)
    };
    dir.and_then(|d| d.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repository".to_string())
}

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
