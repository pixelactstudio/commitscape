use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use clap::Args;
use commitscape_core::{AuthorId, Index, Oid};
use commitscape_index::{
    line_pass, load, BlameCommit, BlameSource, BlameThreads, GixError, GixRepo, GixThreads,
    InParent, LineStore, Moves, RepoSource, Survival, Survived,
};
use commitscape_metrics::{Analysis, Window};
use commitscape_report::api::{Surviving, SurvivingPerson, SurvivingStatus};

use crate::{now, read_accounts, repo_source, with_accounts, Common, ProgressLine};

#[derive(Args)]
pub struct SurvivingArgs {
    /// Path to the repository, or a GitHub URL or owner/name, which is
    /// cloned into the cache as the report command does. Defaults to the
    /// current directory.
    #[arg(default_value = ".")]
    repo: String,

    /// A person, by the id the repository's Report gives them (made with the
    /// same cache directory). Give it once for each person.
    #[arg(long = "person", value_name = "ID", required = true)]
    people: Vec<u32>,

    /// How long each person may take. Past it they are not counted, never
    /// estimated.
    #[arg(long, default_value_t = 60, value_name = "N")]
    budget_seconds: u64,

    /// The clone has history without old file contents: leave out the lines
    /// each person added, and fetch the old contents blame needs from the
    /// clone's remote as it goes.
    #[arg(long)]
    partial: bool,

    /// A JSON object of email addresses to GitHub logins, as report takes:
    /// give the same file to get the same person ids.
    #[arg(long, value_name = "FILE")]
    accounts: Option<PathBuf>,

    #[command(flatten)]
    common: Common,
}

/// Counts the asked-for people's Surviving Lines and prints them, with the lines each added, as one JSON document.
pub fn run(args: SurvivingArgs) -> anyhow::Result<()> {
    let options = args.common.cache();
    let given = args.accounts.as_deref().map(read_accounts).transpose()?;
    let path = if Path::new(&args.repo).exists() {
        PathBuf::from(&args.repo)
    } else {
        repo_source(&args.repo, args.partial, &options)?
    };
    let repo = GixRepo::open(&path)?;
    let mut meter = ProgressLine::new();
    let mut loaded = load(&repo, &options, &mut |p| meter.show(p))?;
    meter.clear();
    if given.is_some() {
        with_accounts(&repo, &options, &mut loaded.index, given.as_ref())?;
    }
    let count_lines = !args.partial;
    if count_lines {
        let store = LineStore::for_repo(&options, &loaded.index.repo);
        let pass = line_pass(&repo, &loaded.index, store.as_ref(), &mut |_, _| {})?;
        pass.apply(&mut loaded.index);
    }
    let index = &loaded.index;
    let metrics = args.common.metrics();
    let added = if count_lines {
        Some(added_by_person(index, metrics)?)
    } else {
        None
    };
    let ignored = repo.blame_ignore_revs()?;
    let mut survival = Survival::new(index, &ignored, metrics.max_changeset_size, &options)
        .ok_or_else(|| anyhow::anyhow!("the repository has no commit at its head"))?;
    let budget = Duration::from_secs(args.budget_seconds);
    let threads = repo.threads();
    let fetching = Fetching {
        threads: repo.threads(),
        dir: path.clone(),
    };

    let mut people = Vec::with_capacity(args.people.len());
    for id in args.people {
        let started = Instant::now();
        let author = AuthorId(id);
        let Some(name) = index.authors.get(author).map(|a| a.name.to_string()) else {
            people.push(SurvivingPerson {
                id,
                name: None,
                status: SurvivingStatus::UnknownPerson,
                surviving: None,
                added: None,
                files: 0,
                oldest: None,
                seconds: 0.0,
            });
            continue;
        };
        let survived = if args.partial {
            survival.person(&fetching, author, budget)?
        } else {
            survival.person(&threads, author, budget)?
        };
        let (status, surviving, files, oldest) = match survived {
            Survived::Counted {
                lines,
                files,
                oldest,
            } => (SurvivingStatus::Counted, Some(lines), files, oldest),
            Survived::OverBudget { files } => (SurvivingStatus::OverBudget, None, files, None),
        };
        people.push(SurvivingPerson {
            id,
            name: Some(name),
            status,
            surviving,
            added: added.as_ref().map(|a| a.get(&author).copied().unwrap_or(0)),
            files,
            oldest,
            seconds: (started.elapsed().as_secs_f64() * 1000.0).round() / 1000.0,
        });
    }

    let out = Surviving {
        head: survival.head().to_hex(),
        people,
    };
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &out)?;
    writeln!(stdout)?;
    Ok(())
}

fn added_by_person(
    index: &Index,
    metrics: commitscape_metrics::Options,
) -> anyhow::Result<HashMap<AuthorId, u64>> {
    let analysis = Analysis::new(index, Window::all(now()), metrics);
    Ok(analysis
        .lines_by_person()
        .into_iter()
        .map(|(author, lines)| (author, lines.added))
        .collect())
}

struct Fetching {
    threads: GixThreads,
    dir: PathBuf,
}

struct Fetched {
    repo: GixRepo,
    dir: PathBuf,
}

impl BlameThreads for Fetching {
    type Local = Fetched;

    fn local(&self) -> Fetched {
        Fetched {
            repo: self.threads.local(),
            dir: self.dir.clone(),
        }
    }
}

#[derive(Debug)]
enum FetchError {
    Git(GixError),
    Missing(Oid, String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::Git(e) => e.fmt(f),
            FetchError::Missing(id, why) => {
                write!(
                    f,
                    "could not fetch file contents {id} from the remote: {why}"
                )
            }
        }
    }
}

impl std::error::Error for FetchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            FetchError::Git(e) => Some(e),
            FetchError::Missing(..) => None,
        }
    }
}

impl BlameSource for Fetched {
    type Error = FetchError;

    fn blame_commit(&self, id: Oid) -> Result<Option<BlameCommit>, Self::Error> {
        self.repo.blame_commit(id).map_err(FetchError::Git)
    }

    fn blame_compare(
        &self,
        commit: Oid,
        parent: Oid,
        paths: &[&[u8]],
    ) -> Result<Vec<InParent>, Self::Error> {
        self.repo
            .blame_compare(commit, parent, paths)
            .map_err(FetchError::Git)
    }

    fn blame_moves(&self, commit: Oid, parent: Oid) -> Result<Moves, Self::Error> {
        self.repo
            .blame_moves(commit, parent)
            .map_err(FetchError::Git)
    }

    fn blame_blob(&self, blob: Oid) -> Result<Vec<u8>, Self::Error> {
        if let Ok(bytes) = self.repo.blame_blob(blob) {
            return Ok(bytes);
        }
        let out = Command::new("git")
            .arg("-C")
            .arg(&self.dir)
            .args(["cat-file", "blob", &blob.to_hex()])
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| FetchError::Missing(blob, e.to_string()))?;
        if !out.status.success() {
            return Err(FetchError::Missing(
                blob,
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        Ok(out.stdout)
    }
}
