mod clone;
mod format;
mod health;
mod share;
mod signatures;
mod surviving;

use std::collections::HashMap;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use commitscape_core::Index;
use commitscape_forge::Remote;
use commitscape_index::identity::Account;
use commitscape_index::RepoSource;
use commitscape_index::{
    default_cache_root, line_pass, load, reresolve_authors, CacheOptions, GixRepo, IdentityRules,
    IdentityStore, LineStore, Progress,
};
use commitscape_metrics::{Options, Span};

use crate::format::grouped;

#[derive(Parser)]
#[command(
    name = "commitscape",
    version,
    about = "Reads a git repository's history and shares what each person built there.",
    long_about = "Reads a git repository's history and shares what each person built there.\n\n\
                  Run on its own, it shares the repository: the same as commitscape share.",
    args_conflicts_with_subcommands = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    #[command(flatten)]
    share: share::ShareArgs,
}

#[derive(Subcommand)]
enum Command {
    /// Upload this repository's Report, locked with a key only the printed
    /// link holds, and open it in the browser. The Site cannot read it, and
    /// the link works for a few hours. What commitscape does on its own.
    Share(share::ShareArgs),
    /// Write the repository's Report, every screen for every Window, as
    /// gzipped JSON: what the Site stores and a Shared Report uploads.
    Report(ReportArgs),
    /// Whether a project on GitHub is alive and whether it depends on one
    /// person: its maintainers, Bus Factor, releases, issue answers and
    /// trend. Keeps a partial clone in the cache directory.
    Health(health::HealthArgs),
    /// Count each person's Surviving Lines: the lines at the head that blame
    /// gives them, passing Bulk Commits and the commits named in
    /// .git-blame-ignore-revs through to who wrote the lines before, and
    /// leaving out Generated Files and Prose Files. Prints one JSON document.
    Surviving(surviving::SurvivingArgs),
    /// Write every author address in the history, after the mailmap, with
    /// its name, its commits and its newest commit, as JSON.
    #[command(hide = true)]
    Signatures(signatures::SignaturesArgs),
}

#[derive(Args)]
struct ReportArgs {
    /// Path to the repository, or a GitHub URL or owner/name, which is
    /// cloned into the cache. Defaults to the current directory.
    #[arg(default_value = ".")]
    repo: String,

    /// Where to write it. Defaults to <repository>-report.json.gz in the
    /// current directory.
    #[arg(long, value_name = "FILE")]
    out: Option<PathBuf>,

    /// Write the commit list here, as gzipped JSON, and leave it out of the
    /// Report.
    #[arg(long, value_name = "FILE")]
    commits_out: Option<PathBuf>,

    /// A JSON object of email addresses to GitHub logins. Addresses with the
    /// same login are one person, shown with that login.
    #[arg(long, value_name = "FILE")]
    accounts: Option<PathBuf>,

    /// The Window it opens on: 30d, 90d, 1y or all.
    #[arg(long, default_value = "90d", value_parser = parse_span)]
    window: Span,

    /// Leave out the lines each change added and removed: the Report says
    /// they were not counted. Quicker, and needed for a partial clone.
    #[arg(long)]
    no_lines: bool,

    /// Given a GitHub project: clone its history without old file
    /// contents, for a large project. Implies --no-lines.
    #[arg(long)]
    partial: bool,

    /// Leave every email address out, as a Report for the Site does
    /// (ADR-0019): people appear by name and GitHub login only.
    #[arg(long)]
    no_emails: bool,

    #[command(flatten)]
    common: Common,
}

/// Options every way of running it shares.
#[derive(Args, Clone)]
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

    /// Never ask GitHub about the repository.
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
        Some(Command::Share(args)) => share::run(args),
        Some(Command::Report(args)) => report(args),
        Some(Command::Health(args)) => health::run(args),
        Some(Command::Surviving(args)) => surviving::run(args),
        Some(Command::Signatures(args)) => signatures::run(args),
        None => share::run(cli.share),
    }
}

fn report(args: ReportArgs) -> anyhow::Result<()> {
    let options = args.common.cache();
    let accounts = args.accounts.as_deref().map(read_accounts).transpose()?;
    let path = repo_source(&args.repo, args.partial, &options)?;
    let count_lines = !(args.no_lines || args.partial);
    let (name, report) = make_report(
        &path,
        &args.common,
        args.window,
        count_lines,
        !args.no_emails,
        accounts.as_ref(),
    )?;
    let out = args
        .out
        .unwrap_or_else(|| PathBuf::from(format!("{name}-report.json.gz")));
    let written = commitscape_report::report::write(report, args.commits_out.is_some());
    std::fs::write(&out, gzip(written.report.as_bytes())?)?;
    println!("wrote {}", out.display());
    if let (Some(path), Some(commits)) = (&args.commits_out, &written.commits) {
        std::fs::write(path, gzip(commits.as_bytes())?)?;
        println!("wrote {}", path.display());
    }
    Ok(())
}

pub(crate) fn read_accounts(path: &Path) -> anyhow::Result<HashMap<String, String>> {
    let bytes = std::fs::read(path)
        .map_err(|e| anyhow::anyhow!("could not read {}: {e}", path.display()))?;
    let accounts: HashMap<String, String> = serde_json::from_slice(&bytes).map_err(|e| {
        anyhow::anyhow!(
            "{} is not a JSON object of email addresses to logins: {e}",
            path.display()
        )
    })?;
    Ok(accounts
        .into_iter()
        .filter(|(email, login)| !email.is_empty() && !login.is_empty())
        .map(|(email, login)| (email.to_ascii_lowercase(), login))
        .collect())
}

/// Reads a repository and gathers everything its Report is made from.
pub(crate) fn make_report(
    path: &Path,
    common: &Common,
    window: Span,
    count_lines: bool,
    emails: bool,
    given: Option<&HashMap<String, String>>,
) -> anyhow::Result<(String, commitscape_report::report::Report)> {
    let options = common.cache();
    let repo = GixRepo::open(path)?;
    let mut meter = ProgressLine::new();
    let mut loaded = load(&repo, &options, &mut |p| meter.show(p))?;
    meter.clear();
    let identity = loaded.index.repo.clone();
    if count_lines {
        let store = LineStore::for_repo(&options, &identity);
        let mut meter = ProgressLine::new();
        let pass = line_pass(&repo, &loaded.index, store.as_ref(), &mut |done, total| {
            meter.lines(done, total)
        })?;
        meter.clear();
        pass.apply(&mut loaded.index);
    }
    let accounts = with_accounts(&repo, &options, &mut loaded.index, given)?;
    let name = repo_name(&loaded.index);
    let report = commitscape_report::report::Report {
        name: name.clone(),
        index: loaded.index,
        anchor: now(),
        span: window,
        options: common.metrics(),
        releases: repo.version_tags(),
        lines_counted: count_lines,
        accounts,
        avatars: !common.offline,
        commit_link: commit_link(&repo),
        emails,
    };
    Ok((name, report))
}

/// Joins the addresses given one GitHub login into one person, and returns every known address's login.
pub(crate) fn with_accounts(
    repo: &GixRepo,
    options: &CacheOptions,
    index: &mut Index,
    given: Option<&HashMap<String, String>>,
) -> anyhow::Result<HashMap<String, String>> {
    let store = IdentityStore::for_repo(options, &index.repo);
    let mut rules = match &store {
        Some(store) => store.rules(repo.mailmap()?),
        None => IdentityRules::from_mailmap(repo.mailmap()?),
    };
    if let Some(given) = given {
        join_accounts(&mut rules, index, given);
        reresolve_authors(index, &rules);
    }
    Ok(rules
        .accounts
        .into_iter()
        .map(|(email, a)| (email, a.login))
        .collect())
}

fn join_accounts(rules: &mut IdentityRules, index: &Index, given: &HashMap<String, String>) {
    let mut ids: HashMap<String, u64> = HashMap::new();
    for a in rules.accounts.values() {
        ids.insert(a.login.to_ascii_lowercase(), a.id);
    }
    for i in 0..index.authors.signature_count() {
        let Some(sig) = index
            .authors
            .signature(commitscape_core::SignatureId(i as u32))
        else {
            continue;
        };
        let email = sig.email.to_ascii_lowercase();
        let Some(local) = email.strip_suffix("@users.noreply.github.com") else {
            continue;
        };
        if let Some((id, login)) = local.split_once('+') {
            if let Ok(id) = id.parse() {
                ids.entry(login.to_string()).or_insert(id);
            }
        }
    }
    for (email, login) in given {
        let key = login.to_ascii_lowercase();
        let id = *ids.entry(key.clone()).or_insert_with(|| login_id(&key));
        rules.accounts.insert(
            email.clone(),
            Account {
                id,
                login: login.clone(),
            },
        );
    }
}

fn login_id(login: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in login.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h | 1 << 63
}

pub(crate) fn repo_source(
    repo: &str,
    partial: bool,
    options: &CacheOptions,
) -> anyhow::Result<PathBuf> {
    let local = PathBuf::from(repo);
    if local.exists() {
        anyhow::ensure!(
            !partial,
            "--partial is for a GitHub project, not a local repository"
        );
        return Ok(local);
    }
    let remote = clone::remote(repo)
        .ok_or_else(|| anyhow::anyhow!("{} is neither a folder here nor a GitHub project", repo))?;
    let root = options
        .root
        .clone()
        .or_else(default_cache_root)
        .ok_or_else(|| {
            anyhow::anyhow!("there is no cache directory to clone into; pass --cache-dir")
        })?;
    let how = if partial {
        clone::Clone::Partial
    } else {
        clone::Clone::Full
    };
    clone::clone(&remote, &root, how)
}

pub(crate) fn gzip(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut out = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    out.write_all(bytes)?;
    out.finish()
}

fn commit_link(repo: &GixRepo) -> Option<String> {
    let remote = Remote::parse(&repo.remote_url()?)?;
    Some(format!(
        "https://github.com/{}/{}/commit/",
        remote.owner, remote.name
    ))
}

pub(crate) fn repo_name(index: &Index) -> String {
    let git_dir = Path::new(&index.repo.git_dir);
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
