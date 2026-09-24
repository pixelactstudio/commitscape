//! `commitscape` binary entry point.

mod check;
mod health;
mod json;
mod people;
mod text;
mod web;
mod who;
mod wrapped;

use std::io::{IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use commitscape_core::Index;
use commitscape_forge::{GitHub, Remote};
use commitscape_index::RepoSource;
use commitscape_index::{
    default_cache_root, line_pass, load, reresolve_authors, CacheOptions, GixRepo, IdentityRules,
    IdentityStore, LineStore, Progress, Since,
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

    /// Open the browser interface, even where no browser can be opened: the
    /// link to open is printed.
    #[arg(long, conflicts_with_all = ["tui", "json", "summary"])]
    web: bool,

    /// Open the terminal interface, even where a browser could be opened.
    #[arg(long, conflicts_with_all = ["json", "summary"])]
    tui: bool,

    /// Serve the browser interface on this address rather than this machine
    /// only, for a Tailscale or LAN address. The link still carries a secret
    /// token.
    #[arg(long, value_name = "ADDRESS", conflicts_with = "tui")]
    listen: Option<std::net::IpAddr>,

    /// The browser interface's port. Defaults to 7878, or any free one.
    #[arg(long, value_name = "PORT")]
    port: Option<u16>,

    /// Leave out the lines each person added and removed, so the JSON
    /// output does not wait for them to be counted.
    #[arg(long, requires = "json")]
    no_lines: bool,

    /// Rows in each ranking of the JSON output.
    #[arg(long, default_value_t = 20, value_name = "ROWS")]
    top: usize,

    /// The interface's colours: terminal (its own colours), dark or light.
    /// Press t to change them.
    #[arg(long, default_value = "terminal", value_parser = parse_theme)]
    theme: commitscape_tui::Theme,

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
    /// What you probably forgot to change: files that nearly always change
    /// with the ones staged (or on a branch, in a pull request, in a
    /// commit) and are missing.
    Check(check::CheckArgs),
    /// Who to ask about a file or folder: who worked on it most, and most
    /// recently, and whether they still commit.
    Who(who::WhoArgs),
    /// Whether a project on GitHub is alive and whether it depends on one
    /// person: its maintainers, Bus Factor, releases, issue answers and
    /// trend, and its card. Keeps a partial clone in the cache directory.
    Health(health::HealthArgs),
    /// Your year across every repository under a folder, as a page and a
    /// card: your own commits only, private repositories included, nothing
    /// uploaded.
    Wrapped(wrapped::WrappedArgs),
    /// Fetch the repository's pull requests, issues and releases from GitHub
    /// now, through the gh CLI. The interface does this in the background;
    /// a fetch that stops, at GitHub's rate limit say, resumes next time.
    Github(GithubArgs),
    /// Write the browser interface as one HTML file that needs no server:
    /// every screen for every Window, to send or keep.
    Report(ReportArgs),
}

#[derive(Args)]
struct ReportArgs {
    /// Path to the repository. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// Where to write it. Defaults to <repository>-report.html in the
    /// current directory.
    #[arg(long, value_name = "FILE")]
    out: Option<PathBuf>,

    /// The Window it opens on: 30d, 90d, 1y or all.
    #[arg(long, default_value = "90d", value_parser = parse_span)]
    window: Span,

    #[command(flatten)]
    common: Common,
}

#[derive(Args)]
struct GithubArgs {
    /// Path to the repository. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// Where to keep the index cache and what is fetched beside it.
    #[arg(long, value_name = "DIR")]
    cache_dir: Option<PathBuf>,
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
pub(crate) struct Common {
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
    pub(crate) fn cache(&self) -> CacheOptions {
        CacheOptions {
            root: if self.no_cache {
                None
            } else {
                self.cache_dir.clone().or_else(default_cache_root)
            },
        }
    }

    pub(crate) fn metrics(&self) -> Options {
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

fn parse_theme(s: &str) -> Result<commitscape_tui::Theme, String> {
    commitscape_tui::Theme::parse(s)
        .ok_or_else(|| format!("expected terminal, dark or light, got {s:?}"))
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
    match cli.command {
        Some(Command::Card(args)) => return card(args),
        Some(Command::Check(args)) => return check::run(args),
        Some(Command::Who(args)) => return who::run(args),
        Some(Command::Health(args)) => return health::run(args),
        Some(Command::Wrapped(args)) => return wrapped::run(args),
        Some(Command::Github(args)) => return github_history(args),
        Some(Command::Report(args)) => return report(args),
        None => {}
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

    let browser = !cli.tui
        && !cli.json
        && !cli.summary
        && !cli.exit_after_first_paint
        && (cli.web || cli.listen.is_some() || (interactive && web::can_open_browser()));
    if browser {
        return serve_web(&cli, &repo, &options, loaded, anchor, metrics);
    }

    if interactive {
        // The rest of history is read on another thread once the first frame
        // is up, so a longer Window is ready by the time anyone asks for it.
        let older = loaded.take_rest().map(|rest| -> LoadOlder {
            Box::new(move |recent: &Index| rest.complete(recent).ok())
        });
        let offline = cli.common.offline || cli.exit_after_first_paint;
        let loaded_repo = loaded.index.repo.clone();
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
            lines: Some(count_lines(&cli.repo, &options, &loaded_repo)),
            releases: Some(releases(&cli.repo)),
            theme: cli.theme,
        };
        if cli.exit_after_first_paint {
            commitscape_tui::paint_once(session)?;
        } else {
            commitscape_tui::run(session)?;
            if let Some(hint) = web::ssh_hint(web::DEFAULT_PORT) {
                eprintln!(
                    "For the browser interface, run commitscape --web here and, on your laptop:\n  {hint}"
                );
            }
        }
        return Ok(());
    }

    let lines = cli.json && !cli.no_lines;
    if lines {
        let store = LineStore::for_repo(&options, &loaded.index.repo);
        let mut meter = ProgressLine::new();
        let pass = line_pass(&repo, &loaded.index, store.as_ref(), &mut |done, total| {
            meter.lines(done, total)
        })?;
        meter.clear();
        pass.apply(&mut loaded.index);
    }
    let analysis = Analysis::new(&loaded.index, cli.window.window(anchor), metrics)?;

    let mut out = std::io::stdout().lock();
    if cli.json {
        let report = json::report(&analysis, cli.window, cli.top, lines);
        serde_json::to_writer_pretty(&mut out, &report)?;
        writeln!(out)?;
    } else {
        let summary = text::summary(&cli.repo, &loaded.index, loaded.freshness);
        write!(out, "{summary}{}", text::rankings(&analysis, cli.window))?;
    }
    Ok(())
}

/// Serves the browser interface, opens it where a browser can be opened,
/// and says how to reach it where one cannot.
fn serve_web(
    cli: &Cli,
    repo: &GixRepo,
    options: &CacheOptions,
    mut loaded: commitscape_index::Loaded,
    anchor: i64,
    metrics: Options,
) -> anyhow::Result<()> {
    let older = loaded
        .take_rest()
        .map(|rest| -> commitscape_web::LoadOlder {
            Box::new(move |recent: &Index| rest.complete(recent).ok())
        });
    let (change, link) = identities(&cli.repo, repo, options, &loaded.index, cli.common.offline);
    let identity = loaded.index.repo.clone();
    let name = repo_name(&loaded.index);
    let session = commitscape_web::Session {
        name: name.clone(),
        index: loaded.index,
        anchor,
        span: cli.window,
        options: metrics,
        older,
        lines: Some(count_lines(&cli.repo, options, &identity)),
        link_accounts: link,
        github: github(repo, cli.common.offline),
        releases: Some(releases(&cli.repo)),
        history: whole_history(repo, options, &identity, cli.common.offline),
        accounts: accounts(options, &identity),
        people: change.map(|change| -> commitscape_web::ChangePeople {
            std::sync::Arc::new(move |table, id, undo| {
                let what = if undo {
                    commitscape_tui::PeopleChange::Undo(id)
                } else {
                    commitscape_tui::PeopleChange::Redo(id)
                };
                change(table, what)
            })
        }),
        card: Some(draw_card(name, metrics)),
    };
    let name = session.name.clone();
    let wanted = web::address(cli.listen, cli.port);
    let listener = match std::net::TcpListener::bind(wanted) {
        Ok(l) => l,
        Err(e) if cli.port.is_some() => {
            anyhow::bail!(
                "port {} cannot be used ({e}); choose another with --port",
                wanted.port()
            )
        }
        // The default port is taken: any free one will do.
        Err(_) => std::net::TcpListener::bind(std::net::SocketAddr::new(wanted.ip(), 0))?,
    };
    let running = commitscape_web::serve(
        session,
        commitscape_web::Listen {
            listener,
            machine: web::machine(),
            token: commitscape_web::Token::random()?,
        },
    )?;
    let url = running.url.clone();
    println!("commitscape is showing {name} at\n  {url}");
    let opened = !cli.web && cli.listen.is_none() && web::can_open_browser() && web::open(&url);
    if opened {
        println!("It opened in your browser.");
    } else if let (Some(hint), None) = (web::ssh_hint(running.addr.port()), cli.listen) {
        println!("From your laptop, forward the port, then open the link there:\n  {hint}");
    }
    if !commitscape_web::built() {
        println!("This build has no web app; the page says how to build one.");
    }
    println!("Press Ctrl-C to stop.");
    running.run();
    Ok(())
}

/// Writes the browser interface as one file: all of history, its lines
/// counted, and what was read from GitHub before.
fn report(args: ReportArgs) -> anyhow::Result<()> {
    let repo = GixRepo::open(&args.repo)?;
    let options = args.common.cache();
    let mut meter = ProgressLine::new();
    let mut loaded = load(&repo, &options, Since::All, &mut |p| meter.show(p))?;
    meter.clear();
    let identity = loaded.index.repo.clone();
    let store = LineStore::for_repo(&options, &identity);
    let mut meter = ProgressLine::new();
    let pass = line_pass(&repo, &loaded.index, store.as_ref(), &mut |done, total| {
        meter.lines(done, total)
    })?;
    meter.clear();
    pass.apply(&mut loaded.index);
    let name = repo_name(&loaded.index);
    let history = github_file(&options, &identity)
        .map(|p| commitscape_forge::history::History::load(&p))
        .filter(|h| !h.pull_requests.is_empty() || !h.issues.is_empty());
    if history.is_none() {
        eprintln!("No GitHub history is saved for it; run commitscape github first to include pull requests.");
    }
    let metrics = args.common.metrics();
    let html = commitscape_web::report::report(commitscape_web::report::Report {
        name: name.clone(),
        index: loaded.index,
        anchor: now(),
        span: args.window,
        options: metrics,
        releases: repo.version_tags(),
        lines_counted: true,
        history,
        accounts: accounts(&options, &identity)
            .map(|a| a())
            .unwrap_or_default(),
        card: Some(draw_card(name.clone(), metrics)),
    });
    if !commitscape_web::built() {
        eprintln!("This build has no web app, so the report only says how to build one.");
    }
    let out = args
        .out
        .unwrap_or_else(|| PathBuf::from(format!("{name}-report.html")));
    std::fs::write(&out, html)?;
    println!("wrote {}", out.display());
    Ok(())
}

/// How the browser interface draws the card: the terminal's, as SVG, never
/// asking GitHub.
fn draw_card(name: String, options: Options) -> commitscape_web::DrawCard {
    std::sync::Arc::new(move |index: &Index, span, anchor| {
        let session = Session {
            name: name.clone(),
            index: index.clone(),
            anchor,
            span,
            options,
            older: None,
            github: Err("not asked for a card".to_string()),
            people: None,
            link_accounts: None,
            lines: None,
            releases: None,
            theme: commitscape_tui::Theme::Dark,
        };
        commitscape_tui::svg(&commitscape_tui::card(session))
    })
}

/// Where GitHub's whole history is kept for a repository.
fn github_file(
    options: &CacheOptions,
    identity: &commitscape_core::RepoIdentity,
) -> Option<PathBuf> {
    commitscape_index::repo_dir(options, identity).map(|d| d.join("github.json"))
}

/// How the browser interface reads GitHub's whole history: what was saved,
/// then what is new (ADR-0009).
fn whole_history(
    repo: &GixRepo,
    options: &CacheOptions,
    identity: &commitscape_core::RepoIdentity,
    offline: bool,
) -> Option<commitscape_web::LoadHistory> {
    use commitscape_forge::history::History;
    let path = github_file(options, identity)?;
    let remote = if offline {
        None
    } else {
        repo.remote_url().as_deref().and_then(Remote::parse)
    };
    // Offline with nothing read before, there is no history to show: not
    // an empty one.
    if remote.is_none() && !path.exists() {
        return None;
    }
    Some(Box::new(move |progress| {
        let mut history = History::load(&path);
        progress(Some(&history), "reading");
        let Some(remote) = remote else {
            return Some(history);
        };
        // On an error what was read is kept, and marked incomplete.
        let _ = history.update(
            Some(&path),
            &mut commitscape_forge::history::gh(&remote),
            &mut |p| {
                let what = match p.connection {
                    "pullRequests" => "pull requests",
                    other => other,
                };
                progress(None, &format!("reading {what}: {} of {}", p.read, p.total));
            },
        );
        Some(history)
    }))
}

/// The GitHub login of each address GitHub linked to an account, as kept.
fn accounts(
    options: &CacheOptions,
    identity: &commitscape_core::RepoIdentity,
) -> Option<commitscape_web::ReadAccounts> {
    let store = IdentityStore::for_repo(options, identity)?;
    Some(std::sync::Arc::new(move || {
        store
            .rules(Default::default())
            .accounts
            .into_iter()
            .map(|(email, a)| (email, a.login))
            .collect()
    }))
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
        lines: None,
        releases: None,
        theme: commitscape_tui::Theme::Dark,
    };
    let out = args
        .out
        .unwrap_or_else(|| PathBuf::from(format!("{name}-card.svg")));
    std::fs::write(&out, commitscape_tui::svg(&commitscape_tui::card(session)))?;
    println!("wrote {}", out.display());
    Ok(())
}

/// Fetches what is new on GitHub and says what is known.
fn github_history(args: GithubArgs) -> anyhow::Result<()> {
    use commitscape_forge::history::History;
    let repo = GixRepo::open(&args.repo)?;
    let url = repo
        .remote_url()
        .ok_or_else(|| anyhow::anyhow!("this repository has no remote"))?;
    let remote = Remote::parse(&url)
        .ok_or_else(|| anyhow::anyhow!("its remote is not on GitHub ({url})"))?;
    let options = CacheOptions {
        root: args.cache_dir.or_else(default_cache_root),
    };
    let identity = repo.identity()?;
    let path = commitscape_index::repo_dir(&options, &identity)
        .ok_or_else(|| anyhow::anyhow!("there is no cache directory to keep it in"))?
        .join("github.json");
    let mut history = History::load(&path);
    let live = std::io::stderr().is_terminal();
    let result = history.update(
        Some(&path),
        &mut commitscape_forge::history::gh(&remote),
        &mut |p| {
            if live {
                let what = match p.connection {
                    "pullRequests" => "pull requests",
                    other => other,
                };
                eprint!(
                    "\r\x1b[2Kreading {what}: {} of {}",
                    grouped(p.read),
                    grouped(p.total)
                );
            }
        },
    );
    if live {
        eprint!("\r\x1b[2K");
    }
    let merged = history
        .pull_requests
        .iter()
        .filter(|p| p.merged.is_some())
        .count();
    let closed = history.issues.iter().filter(|i| i.closed.is_some()).count();
    println!(
        "{}/{}: {} pull requests ({} merged), {} issues ({} closed), {} releases",
        remote.owner,
        remote.name,
        grouped(history.pull_requests.len() as u64),
        grouped(merged as u64),
        grouped(history.issues.len() as u64),
        grouped(closed as u64),
        grouped(history.releases.len() as u64),
    );
    if let Err(e) = result {
        println!("stopped early: {e}. Run it again to carry on from here.");
    }
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

/// How the interface reads the releases: the repository's version tags.
fn releases(path: &std::path::Path) -> commitscape_tui::LoadReleases {
    let path = path.to_path_buf();
    Box::new(move || {
        GixRepo::open(&path)
            .map(|r| r.version_tags())
            .unwrap_or_default()
    })
}

/// How the interface counts lines (ADR-0012): in the background, kept in
/// the cache directory when there is one.
fn count_lines(
    path: &std::path::Path,
    options: &CacheOptions,
    repo: &commitscape_core::RepoIdentity,
) -> commitscape_tui::CountLines {
    let path = path.to_path_buf();
    let store = LineStore::for_repo(options, repo);
    Box::new(move |index: &Index| {
        let source = GixRepo::open(&path).ok()?;
        line_pass(&source, index, store.as_ref(), &mut |_, _| {}).ok()
    })
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
pub(crate) fn repo_name(index: &Index) -> String {
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

pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A single progress line on stderr, redrawn in place. Silent when stderr is
/// not a terminal, so piped output stays clean.
pub(crate) struct ProgressLine {
    live: bool,
    drawn: bool,
}

impl ProgressLine {
    pub(crate) fn new() -> Self {
        ProgressLine {
            live: std::io::stderr().is_terminal(),
            drawn: false,
        }
    }

    pub(crate) fn show(&mut self, p: Progress) {
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

    fn lines(&mut self, done: u64, total: u64) {
        if !self.live || total == 0 {
            return;
        }
        let mut err = std::io::stderr().lock();
        let _ = write!(
            err,
            "\r\x1b[2Kcounting lines: {} / {} commits",
            grouped(done),
            grouped(total)
        );
        let _ = err.flush();
        self.drawn = true;
    }

    pub(crate) fn clear(&mut self) {
        if self.drawn {
            let mut err = std::io::stderr().lock();
            let _ = write!(err, "\r\x1b[2K");
            let _ = err.flush();
        }
    }
}

/// `value` with each person's name written beside their id: the id alone
/// means nothing outside this run.
pub(crate) fn with_names(
    mut value: serde_json::Value,
    authors: &commitscape_core::AuthorTable,
) -> serde_json::Value {
    fn walk(v: &mut serde_json::Value, authors: &commitscape_core::AuthorTable) {
        match v {
            serde_json::Value::Object(map) => {
                for key in ["author", "instead"] {
                    let name = map
                        .get(key)
                        .and_then(serde_json::Value::as_u64)
                        .and_then(|id| authors.get(commitscape_core::AuthorId(id as u32)))
                        .map(|a| a.name.to_string());
                    if let Some(name) = name {
                        map.insert(format!("{key}_name"), name.into());
                    }
                }
                for child in map.values_mut() {
                    walk(child, authors);
                }
            }
            serde_json::Value::Array(items) => {
                for child in items {
                    walk(child, authors);
                }
            }
            _ => {}
        }
    }
    walk(&mut value, authors);
    value
}
