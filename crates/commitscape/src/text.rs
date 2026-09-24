//! The plain-text summary: what the binary prints when its output is not a
//! terminal, or with `--summary`.

use std::path::Path;

use commitscape_core::Index;
use commitscape_index::{Freshness, RebuildReason};
use commitscape_metrics::{Age, Analysis, Span};
use commitscape_tui::format::{counted, date, grouped};

/// How many rows each ranking shows.
const TOP: usize = 10;

pub fn summary(repo: &Path, index: &Index, freshness: Freshness) -> String {
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
        "{}\n  {}, {} of them merges{dates}{floor}\n  {} at HEAD, {} tracked over time, {}\n  {how}\n",
        repo.display(),
        counted(span.commits, "commit", "commits"),
        grouped(span.merges),
        counted(index.head.len() as u64, "file", "files"),
        grouped(index.paths.len() as u64),
        counted(
            index.authors.iter().filter(|(_, a)| !a.traits.is_bot()).count() as u64,
            "person",
            "people"
        ),
    )
}

pub fn rankings(analysis: &Analysis<'_>, span: Span) -> String {
    let index = analysis.index();
    let path = |f| index.paths.path_lossy(f);
    let counts = analysis.commits();
    let mut out = String::new();
    out.push_str(&format!(
        "\nWindow {}: {} in the window; {} merges and {} bulk commits (over {} files) not counted\n",
        span.label(),
        counted(counts.in_window, "commit", "commits"),
        grouped(counts.merges),
        grouped(counts.bulk),
        analysis.options().max_changeset_size,
    ));

    out.push_str("\nLargest files (lines, generated files excluded)\n");
    for (i, f) in analysis.largest().iter().take(TOP).enumerate() {
        out.push_str(&format!(
            "  {:>2}  {:>9}  {}\n",
            i + 1,
            grouped(f.loc as u64),
            path(f.file)
        ));
    }

    out.push_str("\nHotspots (churn in the window, and indentation complexity, both ranked)\n");
    let hotspots = analysis.hotspots();
    if hotspots.is_empty() {
        out.push_str("  none: nothing a person wrote changed in this window\n");
    }
    for (i, h) in hotspots.iter().take(TOP).enumerate() {
        out.push_str(&format!(
            "  {:>2}  churn {:>5}  complexity {:>9}  {}\n",
            i + 1,
            grouped(h.churn as u64),
            grouped(h.complexity as u64),
            path(h.file)
        ));
    }

    let ownership = analysis.ownership();
    out.push_str(&format!(
        "\nDirectories one person holds (bus factor 1, of {} with {} or more commits in the window): {}\n",
        grouped(ownership.directory_count as u64),
        analysis.options().ownership_min_commits,
        grouped(ownership.bus_factor_one as u64)
    ));
    for (i, d) in ownership.held_alone().into_iter().take(TOP).enumerate() {
        let owner = d.owners.first();
        let who = owner
            .and_then(|o| index.authors.get(o.author))
            .map(|a| a.name.to_string())
            .unwrap_or_default();
        let share = owner.map_or(0.0, |o| 100.0 * o.commits as f64 / d.commits.max(1) as f64);
        out.push_str(&format!(
            "  {:>2}  {:>3.0}% of {:>4} commits  {:<24}  {}\n",
            i + 1,
            share,
            d.commits,
            who,
            d.label()
        ));
    }

    let coupling = analysis.coupling();
    out.push_str(&format!(
        "\nChange coupling (files with {} or more commits in the window: {}, pairs seen together: {})\n",
        coupling.support,
        grouped(coupling.files as u64),
        grouped(coupling.pair_count)
    ));
    if coupling.pairs.is_empty() {
        out.push_str("  none: no two such files changed together\n");
    }
    for (i, p) in coupling.pairs.iter().take(TOP).enumerate() {
        out.push_str(&format!(
            "  {:>2}  {:>3.0}% together  {}  {} <-> {}\n",
            i + 1,
            100.0 * p.jaccard,
            if p.cross_directory {
                "across dirs"
            } else {
                "same dir   "
            },
            path(p.first),
            path(p.second)
        ));
    }

    let sizes = analysis.changeset_sizes();
    out.push_str(&format!(
        "\nFiles per commit: median {}, 90% touch {} or fewer, 99% touch {} or fewer, largest {}\n",
        sizes.median, sizes.p90, sizes.p99, sizes.max
    ));

    let staleness = analysis.staleness();
    out.push_str("\nStaleness of the files people wrote, by last touch\n");
    for bucket in &staleness.buckets {
        out.push_str(&format!(
            "  {:<16} {:>7}\n",
            bucket.age.label(),
            grouped(bucket.files as u64)
        ));
    }
    debug_assert_eq!(staleness.buckets.len(), Age::EVERY.len());

    let duplicates = analysis.suspected_duplicates();
    if !duplicates.is_empty() {
        out.push_str(&format!(
            "\n{} groups of people may be one person each. Nothing was merged; to join them, add lines like these to .mailmap:\n",
            duplicates.len()
        ));
        if let Some(first) = duplicates.first() {
            for line in analysis.mailmap_for(first).lines().take(3) {
                out.push_str(&format!("  {line}\n"));
            }
        }
    }
    out
}
