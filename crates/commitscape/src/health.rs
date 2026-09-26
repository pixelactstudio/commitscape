//! `commitscape health <github-url>`: whether a project is alive and
//! whether it depends on one person. It keeps a partial clone (history and
//! trees, no old file contents) in the cache directory and reads that.

use std::io::Write;
use std::path::PathBuf;

use clap::Args;
use commitscape_forge::{GitHub, Remote};
use commitscape_index::{default_cache_root, load, GixRepo, Since};
use commitscape_metrics::{Analysis, Health, Span, Window};
use commitscape_tui::format::{ago, days, grouped};

use crate::clone::{clone, remote, Clone};
use crate::{now, repo_name, Common, ProgressLine};

#[derive(Args)]
pub struct HealthArgs {
    /// The project: a GitHub URL, or owner/name.
    url: String,

    /// Where to write its card. Defaults to <owner>-<name>-card.svg here.
    #[arg(long, value_name = "FILE")]
    card: Option<PathBuf>,

    /// Print it as JSON, and draw no card.
    #[arg(long)]
    json: bool,

    #[command(flatten)]
    common: Common,
}

pub fn run(args: HealthArgs) -> anyhow::Result<()> {
    let remote = remote(&args.url).ok_or_else(|| {
        anyhow::anyhow!(
            "{} is not a GitHub project: give its URL or owner/name",
            args.url
        )
    })?;
    let options = args.common.cache();
    let root = options
        .root
        .clone()
        .or_else(default_cache_root)
        .ok_or_else(|| {
            anyhow::anyhow!("there is no cache directory to clone into; pass --cache-dir")
        })?;
    let dir = clone(&remote, &root, Clone::Partial)?;
    let repo = GixRepo::open(&dir)?;
    let mut meter = ProgressLine::new();
    let loaded = load(&repo, &options, Since::All, &mut |p| meter.show(p))?;
    meter.clear();

    let github = if args.common.offline {
        Err("--offline was given".to_string())
    } else {
        GitHub::fetch(&remote).map_err(|e| e.to_string())
    };
    let issues: Option<Vec<(i64, Option<i64>)>> = github.as_ref().ok().map(|g| {
        g.recent_issues
            .iter()
            .map(|i| (i.created, i.first_answer))
            .collect()
    });
    let anchor = now();
    let analysis = Analysis::new(&loaded.index, Window::all(anchor), args.common.metrics())?;
    let health = analysis.health(&repo.version_tags(), issues.as_deref());

    let mut out = std::io::stdout().lock();
    if args.json {
        let value = crate::with_names(serde_json::to_value(&health)?, &loaded.index.authors);
        serde_json::to_writer_pretty(&mut out, &value)?;
        writeln!(out)?;
        return Ok(());
    }
    let name = |id| {
        loaded
            .index
            .authors
            .get(id)
            .map(|a| a.name.to_string())
            .unwrap_or_default()
    };
    let archived = github.as_ref().is_ok_and(|g| g.archived);
    let why = github.as_ref().err().map(String::as_str);
    write!(out, "{}", words(&remote, &health, archived, why, &name))?;

    let card = args
        .card
        .unwrap_or_else(|| PathBuf::from(format!("{}-{}-card.svg", remote.owner, remote.name)));
    let session = commitscape_tui::Session {
        name: repo_name(&loaded.index),
        index: loaded.index,
        anchor,
        span: Span::All,
        options: args.common.metrics(),
        older: None,
        github: Err("not asked for a card".to_string()),
        people: None,
        link_accounts: None,
        lines: None,
        releases: None,
        theme: commitscape_tui::Theme::Dark,
    };
    std::fs::write(&card, commitscape_tui::svg(&commitscape_tui::card(session)))?;
    writeln!(out, "  Card:        {}", card.display())?;
    Ok(())
}

fn many(n: u32, one: &str, more: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{} {more}", grouped(u64::from(n)))
    }
}

/// The health in plain words: a verdict, then each number and what it is.
fn words(
    remote: &Remote,
    h: &Health,
    archived: bool,
    // Why GitHub's issues are not known, when they are not.
    github_why: Option<&str>,
    name: &dyn Fn(commitscape_core::AuthorId) -> String,
) -> String {
    let t = &h.trend;
    let alive = if archived {
        "archived on GitHub".to_string()
    } else if t.commits == 0 {
        "quiet: no commits in the last 90 days".to_string()
    } else {
        "alive".to_string()
    };
    let depends = match h.bus_factor {
        Some(1) => "and it depends on one person",
        Some(_) => "and it does not depend on one person",
        None => "with no commits in the last year to say who it depends on",
    };
    let mut s = format!("{}/{}: {alive}, {depends}.\n\n", remote.owner, remote.name);

    let maintainers = if h.maintainers.is_empty() {
        "nobody made 3 or more commits in the last 90 days".to_string()
    } else {
        let names: Vec<String> = h
            .maintainers
            .iter()
            .take(5)
            .map(|m| format!("{} ({})", name(m.author), grouped(u64::from(m.commits))))
            .collect();
        let more = h.maintainers.len().saturating_sub(5);
        format!(
            "{} with 3 or more commits in the last 90 days: {}{}",
            many(h.maintainers.len() as u32, "person", "people"),
            names.join(", "),
            if more > 0 {
                format!(" and {more} more")
            } else {
                String::new()
            }
        )
    };
    s.push_str(&format!("  Maintainers: {maintainers}\n"));
    s.push_str(&match h.bus_factor {
        Some(b) => format!(
            "  Bus factor:  {b}, the fewest people who made over 80% of the last year's commits\n"
        ),
        None => "  Bus factor:  not known, with no commits in the last year\n".to_string(),
    });
    let r = &h.releases;
    let releases = match (r.in_year, r.typical_gap_days, r.since_last_days) {
        (_, _, None) => "no version tags".to_string(),
        (0, _, Some(last)) => format!("none in the last year; the last {}", ago(last)),
        (n, Some(gap), Some(last)) => format!(
            "{} in the last year, typically {} apart; the last {}",
            many(n, "release", "releases"),
            days(gap),
            ago(last)
        ),
        (n, None, Some(last)) => format!(
            "{} in the last year, {}",
            many(n, "release", "releases"),
            ago(last)
        ),
    };
    s.push_str(&format!("  Releases:    {releases}\n"));
    s.push_str(&match &h.answers {
        None => format!(
            "  Issues:      not known: {}\n",
            github_why.unwrap_or("GitHub was not asked")
        ),
        Some(a) if a.asked == 0 => "  Issues:      none opened lately\n".to_string(),
        Some(a) => {
            let typical = a.typical_hours.map_or(String::new(), |h| {
                if h < 48.0 {
                    format!(", typically within {} hours", h.round().max(1.0))
                } else {
                    format!(", typically within {} days", (h / 24.0).round())
                }
            });
            format!(
                "  Issues:      {} of the last {} got a first answer from someone else{typical}\n",
                grouped(u64::from(a.answered)),
                many(a.asked, "issue", "issues")
            )
        }
    });
    let way = |now: u32, before: u32| {
        let (n, b) = (f64::from(now), f64::from(before));
        if n > b * 1.2 {
            "up from"
        } else if n < b * 0.8 {
            "down from"
        } else {
            "about the same as"
        }
    };
    s.push_str(&format!(
        "  Trend:       {} in the last 90 days, {} {} in the 90 before; {}, {} {}\n",
        many(t.commits, "commit", "commits"),
        way(t.commits, t.commits_before),
        grouped(u64::from(t.commits_before)),
        many(t.people, "person", "people"),
        way(t.people, t.people_before),
        grouped(u64::from(t.people_before))
    ));
    s
}
