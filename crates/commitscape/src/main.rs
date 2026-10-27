mod build;
mod clone;
mod events;
mod format;
mod health;
mod mark;
mod share;
mod signatures;
mod surviving;
mod telemetry;

use std::collections::HashMap;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use clap::{Args, Parser, Subcommand};
use commitscape_core::Index;
use commitscape_forge::Remote;
use commitscape_index::cache::cols::{self, Masking};
use commitscape_index::identity::Account;
use commitscape_index::lines::{line_pass_kept, remask};
use commitscape_index::RepoSource;
use commitscape_index::{
    default_cache_root, line_pass, load, reresolve_authors, CacheOptions, GixRepo, IdentityRules,
    IdentityStore, LinePlan, LineStore, Progress,
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
    /// gzipped JSON: what a Shared Report uploads.
    #[command(hide = true)]
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
    /// Write the Index as Postgres COPY files for the Site: every commit
    /// with its Changeset and Mainline, its people, folders and HEAD, or only
    /// what is new since the commits a previous export held.
    #[command(hide = true)]
    Export(build::ExportArgs),
    /// Everything a Build stores, from one reading of the history: the
    /// export, the pack the engine service answers from, and the Report's
    /// meta, stats and people.
    #[command(hide = true)]
    Build(build::ExportArgs),
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
    run: RunArgs,

    #[command(flatten)]
    common: Common,
}

/// How long the line pass may take, and where timings go.
#[derive(Args, Clone)]
pub(crate) struct RunArgs {
    /// Stop counting lines after this many seconds. What was counted is
    /// kept, and the next run carries on from there.
    #[arg(long, value_name = "SECONDS")]
    lines_budget: Option<u64>,

    /// Write one JSON line here for each step as it finishes: its name, when
    /// it started and ended, and what it counted.
    #[arg(long, value_name = "FILE")]
    pub(crate) events: Option<PathBuf>,
}

impl RunArgs {
    pub(crate) fn budget(&self) -> Option<Duration> {
        self.lines_budget.map(Duration::from_secs)
    }
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

    /// Name the cache by this key instead of the repository's path, so
    /// every clone of one repository shares one cache.
    #[arg(long, value_name = "KEY", hide = true)]
    cache_key: Option<String>,

    /// Index from scratch and neither read nor write a cache.
    #[arg(long)]
    no_cache: bool,

    /// Never ask GitHub about the repository.
    #[arg(long)]
    pub(crate) offline: bool,

    /// End every Window at this moment, in unix seconds, instead of now, so
    /// the output comes out the same every time it is made.
    #[arg(long, value_name = "SECONDS", hide = true)]
    anchor: Option<i64>,
}

impl Common {
    pub(crate) fn cache(&self) -> CacheOptions {
        CacheOptions {
            root: if self.no_cache {
                None
            } else {
                self.cache_dir.clone().or_else(default_cache_root)
            },
            key: self.cache_key.clone(),
        }
    }

    pub(crate) fn anchor(&self) -> i64 {
        self.anchor.unwrap_or_else(now)
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

fn counted_as(command: Option<&Command>) -> Option<&'static str> {
    match command {
        None | Some(Command::Share(_)) => Some("share"),
        Some(Command::Health(_)) => Some("health"),
        Some(Command::Surviving(_)) => Some("surviving"),
        Some(Command::Report(_)) => Some("report"),
        Some(Command::Signatures(_) | Command::Export(_) | Command::Build(_)) => None,
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let _ = rayon::ThreadPoolBuilder::new()
        .num_threads(commitscape_index::threads(usize::MAX))
        .build_global();
    let counted = telemetry::start(counted_as(cli.command.as_ref()));
    let result = run(cli);
    if let Some(run) = counted {
        run.finish(result.is_ok());
    }
    match result {
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
        Some(Command::Export(args)) => build::export(args),
        Some(Command::Build(args)) => build::build(args),
        None => share::run(cli.share),
    }
}

fn report(args: ReportArgs) -> anyhow::Result<()> {
    events::record_to(args.run.events.as_deref())?;
    let options = args.common.cache();
    let accounts = args.accounts.as_deref().map(read_accounts).transpose()?;
    let path = repo_source(&args.repo, args.partial, &options)?;
    let count_lines = !(args.no_lines || args.partial);
    let (name, report) = make_report(
        &path,
        &args.common,
        args.window,
        count_lines,
        args.run.budget(),
        !args.no_emails,
        accounts.as_ref(),
    )?;
    let out = args
        .out
        .unwrap_or_else(|| PathBuf::from(format!("{name}-report.json.gz")));
    let span = tracing::info_span!("report", bytes = tracing::field::Empty);
    let entered = span.enter();
    let written = commitscape_report::report::write(report, args.commits_out.is_some());
    let gzipped = gzip(written.report.as_bytes())?;
    std::fs::write(&out, &gzipped)?;
    let mut bytes = gzipped.len();
    let commits = match (&args.commits_out, &written.commits) {
        (Some(path), Some(commits)) => {
            let gzipped = gzip(commits.as_bytes())?;
            std::fs::write(path, &gzipped)?;
            bytes += gzipped.len();
            Some(path)
        }
        _ => None,
    };
    span.record("bytes", bytes);
    drop(entered);
    drop(span);
    println!("wrote {}", out.display());
    if let Some(path) = commits {
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
    budget: Option<Duration>,
    emails: bool,
    given: Option<&HashMap<String, String>>,
) -> anyhow::Result<(String, commitscape_report::report::Report)> {
    let options = common.cache();
    let repo = GixRepo::open(path)?;
    let mut meter = ProgressLine::new();
    let mut loaded = load(&repo, &options, &mut |p| meter.show(p))?;
    meter.clear();
    if count_lines {
        count_lines_into(
            &repo,
            &options,
            &mut loaded.index,
            common.metrics(),
            budget,
            None,
        )?;
    }
    let accounts = with_accounts(&repo, &options, &mut loaded.index, given)?;
    let name = repo_name(&loaded.index);
    let report = commitscape_report::report::Report {
        name: name.clone(),
        index: loaded.index,
        anchor: common.anchor(),
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

pub(crate) struct LineCount {
    pub(crate) counted: u64,
    pub(crate) left: u64,
    pub(crate) settled: Vec<bool>,
}

/// Counts the Lines Changed the Index lacks, the Mainline first (worked out here unless given), never Bulk Commits, lockfiles or Generated Files, for at most `budget`.
pub(crate) fn count_lines_into(
    repo: &GixRepo,
    options: &CacheOptions,
    index: &mut Index,
    metrics: Options,
    budget: Option<Duration>,
    mainline: Option<Vec<u8>>,
) -> anyhow::Result<LineCount> {
    let plan = LinePlan {
        skip_commits: index.commits.iter().map(|c| metrics.is_bulk(c)).collect(),
        skip_files: commitscape_metrics::skipped_files(index),
        mainline,
        budget,
    };
    let store = LineStore::for_repo(options, &index.repo);
    let mut meter = ProgressLine::new();
    let mut pass = line_pass(repo, index, &plan, store.as_ref(), &mut |done, total| {
        meter.lines(done, total)
    })?;
    meter.clear();
    let count = LineCount {
        counted: pass.counted,
        left: pass.left,
        settled: std::mem::take(&mut pass.settled),
    };
    pass.apply(index);
    if count.left > 0 {
        eprintln!(
            "lines not counted yet for {} commits: the next run carries on",
            grouped(count.left)
        );
    }
    Ok(count)
}

/// Counts Lines Changed as `count_lines_into` does, from the Index's kept columns when they were read and counted with the same masking: only the commits they do not hold settled are read from the line store or counted, and only those are written back. Otherwise every commit's lines are put in as before and the columns are written whole for the cache's generation.
pub(crate) fn count_lines_kept(
    repo: &GixRepo,
    options: &CacheOptions,
    loaded: &mut commitscape_index::Loaded,
    metrics: Options,
    budget: Option<Duration>,
    mainline: Option<Vec<u8>>,
) -> anyhow::Result<LineCount> {
    let index = &mut loaded.index;
    let plan = LinePlan {
        skip_commits: index.commits.iter().map(|c| metrics.is_bulk(c)).collect(),
        skip_files: commitscape_metrics::skipped_files(index),
        mainline,
        budget,
    };
    let masking = Masking {
        bulk: metrics.max_changeset_size,
        skipped: plan.skip_files.clone(),
    };
    let store = LineStore::for_repo(options, &index.repo);
    let mut meter = ProgressLine::new();
    let kept = loaded.columns.kept.as_mut().and_then(|k| {
        let flipped = k.masking.flips(&masking)?;
        Some((k, flipped))
    });
    let count = match kept {
        Some((kept, flipped)) => {
            let remasked = remask(index, &plan, store.as_ref(), &flipped, &kept.settled);
            let (mut pass, newly) = line_pass_kept(
                repo,
                index,
                &plan,
                store.as_ref(),
                &mut kept.settled,
                &mut |done, total| meter.lines(done, total),
            )?;
            meter.clear();
            let count = LineCount {
                counted: pass.counted,
                left: pass.left,
                settled: std::mem::take(&mut pass.settled),
            };
            pass.apply(index);
            let mut written = newly;
            written.extend(remasked);
            written.sort_unstable();
            written.dedup();
            if let Err(e) = kept.save(index, &written, &masking) {
                tracing::warn!("the kept columns were not brought up to date: {e}");
            }
            count
        }
        None => {
            let mut pass = line_pass(repo, index, &plan, store.as_ref(), &mut |done, total| {
                meter.lines(done, total)
            })?;
            meter.clear();
            let count = LineCount {
                counted: pass.counted,
                left: pass.left,
                settled: std::mem::take(&mut pass.settled),
            };
            pass.apply(index);
            if let Some((dir, generation)) = loaded.columns.at.as_ref() {
                let marks: Vec<u8> = count.settled.iter().map(|&s| u8::from(s)).collect();
                if let Err(e) = cols::write(dir, *generation, index, &marks, &masking) {
                    tracing::warn!("the Index's columns were not kept: {e}");
                }
            }
            count
        }
    };
    if count.left > 0 {
        eprintln!(
            "lines not counted yet for {} commits: the next run carries on",
            grouped(count.left)
        );
    }
    Ok(count)
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

pub(crate) fn commit_link(repo: &GixRepo) -> Option<String> {
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
