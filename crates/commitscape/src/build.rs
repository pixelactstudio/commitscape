use std::collections::{HashMap, HashSet};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use clap::Args;
use commitscape_core::{CommitFlags, Index, Oid};
use commitscape_index::graph::CommitGraph;
use commitscape_index::mainline::mainline_since;
use commitscape_index::{load, GixRepo, LineStore, Loaded, Mainline, RepoSource};
use commitscape_metrics::Span;
use commitscape_report::export::{self, Manifest, Since};
use commitscape_report::pack::{write_pack, Pack, Reading};
use commitscape_report::report::{summary, Report};
use commitscape_report::universe::write_rows;
use tracing::field::Empty;

use crate::mark::{fingerprint, Mark};
use crate::{
    commit_link, count_lines_into, events, read_accounts, repo_name, with_accounts, Common,
    LineCount, ProgressLine, RunArgs,
};

#[derive(Args)]
pub struct ExportArgs {
    /// Path to the repository.
    #[arg(default_value = ".")]
    repo: PathBuf,

    /// The folder to write the files into.
    #[arg(long, value_name = "DIR")]
    out: PathBuf,

    /// A JSON object of email addresses to GitHub logins.
    #[arg(long, value_name = "FILE")]
    accounts: Option<PathBuf>,

    /// Leave out the lines each change added and removed.
    #[arg(long)]
    no_lines: bool,

    /// A file of commit ids, one per line: the frontier of the previous
    /// export. Only commits not reachable from them are written.
    #[arg(long, value_name = "FILE", requires = "lineage")]
    after: Option<PathBuf>,

    /// The lineage of the cache the previous export came from. When the
    /// cache has another, everything is written.
    #[arg(long)]
    lineage: Option<u64>,

    /// The mark the export the Site last loaded left in its manifest. While
    /// it holds, only the Mainline that moved and the Lines Changed counted
    /// since are written for the commits the Site has.
    #[arg(long, value_name = "MARK", requires = "after")]
    since: Option<String>,

    #[command(flatten)]
    run: RunArgs,

    #[command(flatten)]
    common: Common,
}

struct Read {
    repo: GixRepo,
    loaded: Loaded,
    mainline: Mainline,
    lines: Option<LineCount>,
    accounts: HashMap<String, String>,
    known: Option<Vec<bool>>,
    moved: Option<Vec<bool>>,
    counted: Option<HashSet<Oid>>,
    mark: Mark,
    releases: Vec<(String, i64)>,
    release_commits: Vec<(String, Oid)>,
    anchor: i64,
}

fn read(args: &ExportArgs) -> anyhow::Result<Read> {
    let options = args.common.cache();
    let given = args.accounts.as_deref().map(read_accounts).transpose()?;
    let repo = GixRepo::open(&args.repo)?;
    let mut meter = ProgressLine::new();
    let mut loaded = load(&repo, &options, &mut |p| meter.show(p))?;
    meter.clear();
    let truncated = loaded.index.history_truncated;
    let mut graph = (!truncated)
        .then(|| CommitGraph::of(&repo, &options, &loaded.index, loaded.lineage))
        .transpose()?;
    let known = match (&args.after, args.lineage) {
        (Some(file), Some(lineage)) if lineage == loaded.lineage => match &graph {
            Some(g) => g.reached_from(&loaded.index, &frontier(file)?),
            None => repo.ancestors(&frontier(file)?)?.map(|reached| {
                loaded
                    .index
                    .commits
                    .iter()
                    .map(|c| reached.contains(&c.id))
                    .collect()
            }),
        },
        _ => None,
    };
    let ignored = repo.blame_ignore_revs()?;
    let fingerprint = fingerprint(
        args.common.metrics().max_changeset_size,
        &ignored,
        truncated,
    );
    let held = args
        .since
        .as_deref()
        .and_then(Mark::parse)
        .filter(|m| known.is_some() && m.fingerprint == fingerprint);
    let before = held.and_then(|m| m.head).filter(|_| !truncated);
    let (mainline, moved) = match graph.as_mut() {
        Some(g) => {
            let found = g.mainline_since(&loaded.index, before);
            g.keep(&loaded.index);
            found
        }
        None => mainline_since(&repo, &loaded.index, before)?,
    };
    let lines = if args.no_lines {
        None
    } else {
        Some(count_lines_into(
            &repo,
            &options,
            &mut loaded.index,
            args.common.metrics(),
            args.run.budget(),
            Some(mainline.bits.clone()),
        )?)
    };
    let (log, counted) = match LineStore::for_repo(&options, &loaded.index.repo) {
        Some(store) => {
            let (now, after) = store.since(held.and_then(|m| m.lines));
            (Some(now), after.map(|a| a.into_iter().collect()))
        }
        None => (None, None),
    };
    let mark = Mark {
        head: loaded.index.head_commit,
        lines: match (&lines, &known) {
            (Some(_), _) => log,
            (None, Some(_)) => held.and_then(|m| m.lines),
            (None, None) => None,
        },
        fingerprint,
    };
    mark_ignored(&mut loaded.index, &ignored);
    let accounts = with_accounts(&repo, &options, &mut loaded.index, given.as_ref())?;
    let tags = repo.release_tags();
    Ok(Read {
        releases: tags.iter().map(|(n, t, _)| (n.clone(), *t)).collect(),
        release_commits: tags.into_iter().map(|(n, _, c)| (n, c)).collect(),
        repo,
        loaded,
        mainline,
        lines,
        accounts,
        known,
        moved,
        counted,
        mark,
        anchor: args.common.anchor(),
    })
}

fn frontier(file: &Path) -> anyhow::Result<Vec<Oid>> {
    std::fs::read_to_string(file)?
        .split_whitespace()
        .map(|t| Oid::from_hex(t).ok_or_else(|| anyhow::anyhow!("{t} is not a commit id")))
        .collect()
}

fn mark_ignored(index: &mut Index, ignored: &[Oid]) {
    let ignored: HashSet<Oid> = ignored.iter().copied().collect();
    if ignored.is_empty() {
        return;
    }
    for c in index.commits.iter_mut() {
        if ignored.contains(&c.id) {
            c.flags = c.flags.with(CommitFlags::BLAME_IGNORED);
        }
    }
}

fn write_export(r: &Read, args: &ExportArgs) -> anyhow::Result<Manifest> {
    let span = tracing::info_span!("export", commits = Empty, total = Empty);
    let _entered = span.enter();
    let manifest = export::write(
        &export::Export {
            index: &r.loaded.index,
            accounts: &r.accounts,
            options: args.common.metrics(),
            anchor: r.anchor,
            releases: &r.releases,
            release_commits: &r.release_commits,
            lines: r.lines.as_ref().map(|l| export::Lines {
                settled: &l.settled,
                counted: l.counted,
                left: l.left,
            }),
            mainline: export::Mainline {
                bits: &r.mainline.bits,
                arrival: &r.mainline.arrival,
            },
            known: r.known.as_deref(),
            since: Since {
                moved: r.moved.as_deref(),
                counted: r.counted.as_ref(),
            },
            mark: r.mark.to_string(),
            lineage: r.loaded.lineage,
            kept: r.loaded.kept,
        },
        &args.out,
    )?;
    span.record("commits", manifest.commits);
    span.record("total", manifest.total);
    Ok(manifest)
}

fn said(manifest: &Manifest) -> &'static str {
    if manifest.full {
        "everything"
    } else {
        "new since the last export"
    }
}

/// `commitscape export`: writes the Index as Postgres `COPY` files.
pub fn export(args: ExportArgs) -> anyhow::Result<()> {
    events::record_to(args.run.events.as_deref())?;
    let r = read(&args)?;
    let manifest = write_export(&r, &args)?;
    println!(
        "exported {} of {} commits ({}) to {}",
        manifest.commits,
        manifest.total,
        said(&manifest),
        args.out.display()
    );
    Ok(())
}

/// `commitscape build`: from one reading of the history, writes the export, the Report's meta, stats and people as `meta.json`, the pack as `pack.bin`, and the rows the Universe's Atlas is made from as `universe.jsonl`.
pub fn build(args: ExportArgs) -> anyhow::Result<()> {
    events::record_to(args.run.events.as_deref())?;
    let r = read(&args)?;
    let manifest = write_export(&r, &args)?;
    let Read {
        repo,
        loaded,
        mainline,
        lines,
        accounts,
        releases,
        release_commits,
        anchor,
        ..
    } = r;
    let report = Report {
        name: repo_name(&loaded.index),
        index: loaded.index,
        anchor,
        span: Span::All,
        options: args.common.metrics(),
        releases,
        lines_counted: lines.is_some(),
        accounts,
        avatars: !args.common.offline,
        commit_link: commit_link(&repo),
        emails: false,
    };

    let span = tracing::info_span!("meta", people = Empty);
    let entered = span.enter();
    let meta = summary(&report);
    std::fs::write(args.out.join("meta.json"), serde_json::to_vec(&meta)?)?;
    span.record("people", meta.people.len());
    drop(entered);
    drop(span);

    let span = tracing::info_span!("pack", bytes = Empty);
    let entered = span.enter();
    let pack = Pack::of(
        report,
        Reading {
            lineage: loaded.lineage,
            lines_complete: manifest.lines,
            lines_mainline: manifest.lines_mainline,
            mainline: mainline.bits,
            arrival: mainline.arrival,
            release_commits: release_commits
                .into_iter()
                .map(|(name, commit)| (name, commit.to_hex()))
                .collect(),
        },
    );
    let path = args.out.join("pack.bin");
    let mut out = BufWriter::with_capacity(1 << 20, std::fs::File::create(&path)?);
    write_pack(&pack, &mut out)?;
    out.flush()?;
    drop(out);
    span.record("bytes", std::fs::metadata(&path)?.len());
    drop(entered);
    drop(span);

    let span = tracing::info_span!("universe", bytes = Empty);
    let entered = span.enter();
    let path = args.out.join("universe.jsonl");
    let mut out = BufWriter::with_capacity(1 << 20, std::fs::File::create(&path)?);
    write_rows(&pack, &mut out)?;
    out.flush()?;
    drop(out);
    span.record("bytes", std::fs::metadata(&path)?.len());
    drop(entered);
    drop(span);

    println!(
        "built {} of {} commits ({}) into {}",
        manifest.commits,
        manifest.total,
        said(&manifest),
        args.out.display()
    );
    Ok(())
}
