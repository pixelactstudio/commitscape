//! `commitscape who <path>`: who to ask about a file or a folder, and
//! whether they are still around.

use std::io::Write;
use std::path::{Path, PathBuf};

use clap::Args;
use commitscape_index::{load, GixRepo, Since};
use commitscape_metrics::{Analysis, Window};
use commitscape_tui::format::{ago, grouped};

use crate::{now, Common, ProgressLine};

/// How many people are listed.
const SHOWN: usize = 8;
const DAY: i64 = 86_400;

#[derive(Args)]
pub struct WhoArgs {
    /// The file or folder to ask about, from where you are.
    path: PathBuf,

    /// The repository. Defaults to the one the path is in.
    #[arg(long, value_name = "DIR")]
    repo: Option<PathBuf>,

    /// Print it as JSON.
    #[arg(long)]
    json: bool,

    #[command(flatten)]
    common: Common,
}

/// `path` made absolute and tidied without touching the disk: it may name
/// a file that has since been deleted.
fn absolute(path: &Path) -> PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    let mut out = PathBuf::new();
    for part in joined.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// The nearest folder at or above `path` that exists: where to look for
/// the repository from.
fn existing(path: &Path) -> PathBuf {
    path.ancestors()
        .find(|p| p.is_dir())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
}

/// `path` as the repository at `top` names it: from its top, with `/`
/// between. `None` when it is not in the repository.
fn in_repo(top: &Path, path: &Path) -> Option<String> {
    let top = std::fs::canonicalize(top).unwrap_or_else(|_| top.to_path_buf());
    // The folders above `path` may be reached through a link; resolve the
    // part that exists and keep the rest as written.
    let base = existing(path);
    let real = std::fs::canonicalize(&base).unwrap_or_else(|_| base.clone());
    let rest = path.strip_prefix(&base).unwrap_or(Path::new(""));
    let full = real.join(rest);
    let relative = full.strip_prefix(&top).ok()?;
    Some(
        relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

pub fn run(args: WhoArgs) -> anyhow::Result<()> {
    let path = absolute(&args.path);
    let repo = match &args.repo {
        Some(dir) => GixRepo::discover(dir)?,
        None => GixRepo::discover(&existing(&path))?,
    };
    // A relative path outside the repository is read from its top: `who
    // src --repo ../app`.
    let path = match in_repo(repo.top(), &path) {
        Some(p) => p,
        None if args.path.is_relative() => args
            .path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .filter(|c| c != ".")
            .collect::<Vec<_>>()
            .join("/"),
        None => anyhow::bail!(
            "{} is not in the repository at {}",
            args.path.display(),
            repo.top().display()
        ),
    };
    let mut meter = ProgressLine::new();
    let loaded = load(&repo, &args.common.cache(), Since::All, &mut |p| {
        meter.show(p)
    })?;
    meter.clear();
    let anchor = now();
    let analysis = Analysis::new(&loaded.index, Window::all(anchor), args.common.metrics())?;
    let who = analysis
        .who(&path)
        .ok_or_else(|| anyhow::anyhow!("the repository has never had {path}"))?;

    let authors = &loaded.index.authors;
    let name = |id| {
        authors
            .get(id)
            .map(|a| a.name.to_string())
            .unwrap_or_default()
    };
    let mut out = std::io::stdout().lock();
    if args.json {
        let value = crate::with_names(serde_json::to_value(&who)?, &loaded.index.authors);
        serde_json::to_writer_pretty(&mut out, &value)?;
        writeln!(out)?;
        return Ok(());
    }
    let shown = if who.path.is_empty() || who.path == "/" {
        "the whole repository".to_string()
    } else {
        who.path.clone()
    };
    if who.people.is_empty() {
        writeln!(
            out,
            "Nobody has changed {shown}, merges and bulk commits left out."
        )?;
        return Ok(());
    }
    writeln!(out, "Who to ask about {shown}:\n")?;
    let width = who
        .people
        .iter()
        .take(SHOWN)
        .map(|e| name(e.author).chars().count())
        .max()
        .unwrap_or(0);
    let days = |t: i64| (anchor - t).div_euclid(DAY);
    for e in who.people.iter().take(SHOWN) {
        let commits = if e.commits == 1 {
            "1 commit".to_string()
        } else {
            format!("{} commits", grouped(u64::from(e.commits)))
        };
        let mut line = format!(
            "  {:<width$}  {commits} here, the last {}",
            name(e.author),
            ago(days(e.last_here))
        );
        if !e.active {
            line.push_str(&format!(" · last seen {}", ago(days(e.last_seen))));
        }
        writeln!(out, "{line}")?;
    }
    if who.people.len() > SHOWN {
        writeln!(out, "  and {} more", who.people.len() - SHOWN)?;
    }
    if let (Some(first), Some(instead)) = (who.people.first(), who.instead) {
        writeln!(
            out,
            "\n{} has not committed for {}: ask {} instead.",
            name(first.author),
            commitscape_tui::format::days(days(first.last_seen)),
            name(instead)
        )?;
    }
    Ok(())
}
