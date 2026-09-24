//! `commitscape check`: what a change probably forgot, from what history
//! says usually changes with the files it changed. It stays quiet unless
//! the evidence is strong, and fails only with `--strict`.

use std::io::Write;
use std::path::PathBuf;

use clap::Args;
use commitscape_forge::{pull_request_files, Remote};
use commitscape_index::{load, GixRepo, RepoSource, Since};
use commitscape_metrics::{Analysis, Forgotten, Window};
use serde::Serialize;

use crate::{now, Common, ProgressLine};

#[derive(Args)]
pub struct CheckArgs {
    /// The repository, or any folder in it. Defaults to the current
    /// directory.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// Check what the current branch changed since it left BASE (its merge
    /// base with BASE), instead of what is staged.
    #[arg(long, value_name = "BASE", conflicts_with_all = ["pr", "commit"])]
    branch: Option<String>,

    /// Check the files a GitHub pull request changes, through the gh CLI.
    #[arg(long, value_name = "NUMBER", conflicts_with = "commit")]
    pr: Option<u64>,

    /// Check what one commit changed, against the history before it.
    #[arg(long, value_name = "REV")]
    commit: Option<String>,

    /// Exit with status 1 when something looks forgotten.
    #[arg(long)]
    strict: bool,

    /// How to write it: text, markdown (a pull request comment) or json.
    #[arg(long, default_value = "text", value_parser = ["text", "markdown", "json"])]
    format: String,

    #[command(flatten)]
    common: Common,
}

#[derive(Serialize)]
struct Report<'a> {
    /// What was checked: `staged`, `branch`, `pr` or `commit`.
    checked: &'a str,
    changed: &'a [String],
    forgotten: &'a [Forgotten],
}

pub fn run(args: CheckArgs) -> anyhow::Result<()> {
    let repo = GixRepo::discover(&args.repo)?;
    let (checked, changed, before) = if let Some(base) = &args.branch {
        ("branch", repo.changed_since(base)?, None)
    } else if let Some(number) = args.pr {
        let url = repo.remote_url().ok_or_else(|| {
            anyhow::anyhow!("this repository has no remote to find the pull request on")
        })?;
        let remote = Remote::parse(&url)
            .ok_or_else(|| anyhow::anyhow!("its remote is not on GitHub ({url})"))?;
        ("pr", pull_request_files(&remote, number)?, None)
    } else if let Some(rev) = &args.commit {
        let (paths, time) = repo.commit_changes(rev)?;
        ("commit", paths, Some(time))
    } else {
        ("staged", repo.staged()?, None)
    };

    let mut out = std::io::stdout().lock();
    if changed.is_empty() {
        if args.format == "json" {
            serde_json::to_writer_pretty(
                &mut out,
                &Report {
                    checked,
                    changed: &changed,
                    forgotten: &[],
                },
            )?;
            writeln!(out)?;
        } else if args.format == "text" {
            let why = match checked {
                "staged" => "nothing is staged. Stage your changes, or pass --branch main, --pr N or --commit REV",
                "branch" => "the branch changed no files since it left its base",
                "pr" => "the pull request changes no files",
                _ => "the commit changed no files",
            };
            writeln!(out, "Nothing to check: {why}.")?;
        }
        return Ok(());
    }

    let mut meter = ProgressLine::new();
    let loaded = load(&repo, &args.common.cache(), Since::All, &mut |p| {
        meter.show(p)
    })?;
    meter.clear();
    // A past commit is checked against the history before it.
    let window = Window {
        from: None,
        to: before.map_or_else(now, |t| t - 1),
    };
    let analysis = Analysis::new(&loaded.index, window, args.common.metrics())?;
    let paths: Vec<&str> = changed.iter().map(String::as_str).collect();
    let forgotten = analysis.forgotten(&paths);

    match args.format.as_str() {
        "json" => {
            serde_json::to_writer_pretty(
                &mut out,
                &Report {
                    checked,
                    changed: &changed,
                    forgotten: &forgotten,
                },
            )?;
            writeln!(out)?;
        }
        "markdown" => {
            // Nothing at all when nothing looks forgotten: no comment.
            if !forgotten.is_empty() {
                write!(out, "{}", markdown(&forgotten))?;
            }
        }
        _ => write!(out, "{}", text(&forgotten, changed.len()))?,
    }
    out.flush()?;
    if args.strict && !forgotten.is_empty() {
        std::process::exit(1);
    }
    Ok(())
}

/// What `f` is, in words: a file, or a file in a folder.
fn missing(f: &Forgotten, code: fn(&str) -> String) -> String {
    if f.folder {
        format!("a file in {}", code(&f.missing))
    } else {
        code(&f.missing)
    }
}

fn evidence(f: &Forgotten, code: fn(&str) -> String) -> String {
    format!(
        "You changed {}. {} of the last {} commits that did also changed {}.",
        code(&f.because),
        f.together,
        f.of,
        missing(f, code)
    )
}

fn text(forgotten: &[Forgotten], files: usize) -> String {
    if forgotten.is_empty() {
        let files = if files == 1 {
            "file".to_string()
        } else {
            format!("{files} files")
        };
        return format!("Nothing looks forgotten: history says nothing strong about what usually changes with the {files} changed.\n");
    }
    let mut s = String::from("Probably forgotten:\n");
    for f in forgotten {
        s.push_str(&format!("  {}\n", evidence(f, |p| p.to_string())));
    }
    s
}

fn markdown(forgotten: &[Forgotten]) -> String {
    let mut s = String::from("**commitscape check: probably forgotten**\n\n");
    for f in forgotten {
        s.push_str(&format!("- {}\n", evidence(f, |p| format!("`{p}`"))));
    }
    s.push_str(
        "\nFrom this repository's history: each file named usually changes with the one before it. \
         If this change does not need it, ignore this.\n",
    );
    s
}
