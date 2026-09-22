//! The `--json` document: every metric an Analysis has, for scripts, CI and
//! dashboards.
//!
//! Reproducible by construction. The Window is anchored at the newest commit,
//! not at the clock, and nothing machine-specific is included: no timings, no
//! cache paths, no path the repository was opened from. The same repository
//! state always produces the same bytes, which is what the golden files in
//! `tests/golden/` rely on.
//!
//! Every number arrives with what it was computed from, as the metrics
//! themselves do: a Hotspot's score with its churn and complexity and their
//! percentiles, a coupled pair's Jaccard degree with its commit counts.

use commitscape_core::{iso8601, FileId, Index};
use commitscape_metrics::{Analysis, Span};
use serde::Serialize;

/// Bumped when a field is removed or changes meaning. Adding a field does not
/// bump it.
pub const SCHEMA: u32 = 1;

#[derive(Serialize)]
pub struct Report {
    pub schema: u32,
    pub repository: Repository,
    pub window: WindowReport,
    pub options: commitscape_metrics::Options,
    pub hotspots: Vec<Hotspot>,
    pub largest: Vec<Large>,
    pub churn: Vec<Churn>,
    pub coupling: Coupling,
    pub ownership: Ownership,
    pub staleness: Staleness,
    pub code_age: Vec<Quarter>,
    pub changeset_sizes: commitscape_metrics::ChangesetSizes,
    pub suspected_duplicates: Vec<Duplicate>,
}

#[derive(Serialize)]
pub struct Repository {
    /// The commit HEAD pointed at.
    pub head: Option<String>,
    pub commits: u64,
    pub merges: u64,
    pub first_commit: Option<String>,
    pub last_commit: Option<String>,
    /// A shallow clone: `commits` is a floor, not a total.
    pub history_truncated: bool,
    pub files_at_head: usize,
    pub people: usize,
}

#[derive(Serialize)]
pub struct WindowReport {
    pub span: Span,
    /// `null` for all of history.
    pub from: Option<String>,
    pub to: String,
    /// What `to` is: always the newest commit, so the output is reproducible.
    pub anchor: &'static str,
    pub commits: u64,
    pub merges_excluded: u64,
    pub bulk_excluded: u64,
}

#[derive(Serialize)]
pub struct Hotspot {
    pub path: String,
    pub churn: u32,
    pub complexity: u32,
    pub churn_percentile: f64,
    pub complexity_percentile: f64,
    pub score: f64,
}

#[derive(Serialize)]
pub struct Large {
    pub path: String,
    pub lines: u32,
    pub bytes: u64,
    pub complexity: u32,
}

#[derive(Serialize)]
pub struct Churn {
    pub path: String,
    pub commits: u32,
}

#[derive(Serialize)]
pub struct Coupling {
    pub support: u32,
    pub files: u32,
    pub pairs_seen: u64,
    pub pairs: Vec<Pair>,
}

#[derive(Serialize)]
pub struct Pair {
    pub first: String,
    pub second: String,
    pub together: u32,
    pub first_commits: u32,
    pub second_commits: u32,
    pub jaccard: f64,
    pub first_given_second: f64,
    pub second_given_first: f64,
    pub cross_directory: bool,
}

#[derive(Serialize)]
pub struct Ownership {
    /// Directories with at least `options.ownership_min_commits` commits in
    /// the Window, including those past `--top`.
    pub directories: u32,
    /// Of those, how many one person holds.
    pub bus_factor_one: u32,
    /// Fewest owners first, then most commits.
    pub by_directory: Vec<Directory>,
}

#[derive(Serialize)]
pub struct Directory {
    /// Ends in `/`; `""` is the repository root.
    pub directory: String,
    pub commits: u32,
    pub bus_factor: u32,
    pub owners: Vec<Owner>,
}

#[derive(Serialize)]
pub struct Owner {
    pub name: String,
    pub email: String,
    pub commits: u32,
    pub share: f64,
}

#[derive(Serialize)]
pub struct Staleness {
    pub buckets: Vec<Bucket>,
    pub stalest: Vec<Stale>,
}

#[derive(Serialize)]
pub struct Bucket {
    pub age: commitscape_metrics::Age,
    pub label: &'static str,
    pub files: u32,
}

#[derive(Serialize)]
pub struct Stale {
    pub path: String,
    pub last_touched: String,
    pub days: i64,
}

#[derive(Serialize)]
pub struct Quarter {
    /// `2024-Q1`.
    pub quarter: String,
    pub lines: u64,
    pub files: u32,
}

#[derive(Serialize)]
pub struct Duplicate {
    pub people: Vec<Person>,
    /// Lines for `.mailmap` that would join them under the first person.
    pub mailmap: String,
}

#[derive(Serialize)]
pub struct Person {
    pub name: String,
    pub email: String,
    pub commits: u32,
}

/// Builds the document. Each ranking holds at most `top` rows.
pub fn report(analysis: &Analysis<'_>, span: Span, top: usize) -> Report {
    let index = analysis.index();
    let path = |f: FileId| index.paths.path_lossy(f);
    let counts = analysis.commits();
    let window = analysis.window();

    let coupling = analysis.coupling();
    let ownership = analysis.ownership();
    let staleness = analysis.staleness();

    Report {
        schema: SCHEMA,
        repository: repository(index),
        window: WindowReport {
            span,
            from: window.from.map(iso8601),
            to: iso8601(window.to),
            anchor: "newest-commit",
            commits: counts.in_window,
            merges_excluded: counts.merges,
            bulk_excluded: counts.bulk,
        },
        options: analysis.options(),
        hotspots: analysis
            .hotspots()
            .into_iter()
            .take(top)
            .map(|h| Hotspot {
                path: path(h.file),
                churn: h.churn,
                complexity: h.complexity,
                churn_percentile: h.churn_percentile,
                complexity_percentile: h.complexity_percentile,
                score: h.score,
            })
            .collect(),
        largest: analysis
            .largest()
            .into_iter()
            .take(top)
            .map(|l| Large {
                path: path(l.file),
                lines: l.loc,
                bytes: l.bytes,
                complexity: l.complexity,
            })
            .collect(),
        churn: analysis
            .churn()
            .into_iter()
            .take(top)
            .map(|c| Churn {
                path: path(c.file),
                commits: c.commits,
            })
            .collect(),
        coupling: Coupling {
            support: coupling.support,
            files: coupling.files,
            pairs_seen: coupling.pair_count,
            pairs: coupling
                .pairs
                .iter()
                .take(top)
                .map(|p| Pair {
                    first: path(p.first),
                    second: path(p.second),
                    together: p.both,
                    first_commits: p.first_commits,
                    second_commits: p.second_commits,
                    jaccard: p.jaccard,
                    first_given_second: p.first_given_second,
                    second_given_first: p.second_given_first,
                    cross_directory: p.cross_directory,
                })
                .collect(),
        },
        ownership: Ownership {
            directories: ownership.directory_count,
            bus_factor_one: ownership.bus_factor_one,
            by_directory: ownership
                .directories
                .iter()
                .take(top)
                .map(|d| Directory {
                    directory: String::from_utf8_lossy(&d.dir).into_owned(),
                    commits: d.commits,
                    bus_factor: d.bus_factor,
                    owners: d
                        .owners
                        .iter()
                        .map(|o| {
                            let person = index.authors.get(o.author);
                            Owner {
                                name: person.map(|p| p.name.to_string()).unwrap_or_default(),
                                email: person.map(|p| p.email.to_string()).unwrap_or_default(),
                                commits: o.commits,
                                share: o.commits as f64 / d.commits.max(1) as f64,
                            }
                        })
                        .collect(),
                })
                .collect(),
        },
        staleness: Staleness {
            buckets: staleness
                .buckets
                .iter()
                .map(|b| Bucket {
                    age: b.age,
                    label: b.age.label(),
                    files: b.files,
                })
                .collect(),
            stalest: staleness
                .files
                .iter()
                .take(top)
                .map(|f| Stale {
                    path: path(f.file),
                    last_touched: iso8601(f.last_touched),
                    days: f.days,
                })
                .collect(),
        },
        code_age: analysis
            .code_age()
            .into_iter()
            .map(|q| Quarter {
                quarter: format!("{}-Q{}", q.year, q.quarter),
                lines: q.lines,
                files: q.files,
            })
            .collect(),
        changeset_sizes: analysis.changeset_sizes(),
        suspected_duplicates: analysis
            .suspected_duplicates()
            .into_iter()
            .take(top)
            .map(|group| Duplicate {
                mailmap: analysis.mailmap_for(&group),
                people: group
                    .people
                    .iter()
                    .zip(&group.commits)
                    .map(|(p, commits)| {
                        let person = index.authors.get(*p);
                        Person {
                            name: person.map(|a| a.name.to_string()).unwrap_or_default(),
                            email: person.map(|a| a.email.to_string()).unwrap_or_default(),
                            commits: *commits,
                        }
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn repository(index: &Index) -> Repository {
    Repository {
        head: index.head_commit.map(|c| c.to_hex()),
        commits: index.span.commits,
        merges: index.span.merges,
        first_commit: index.span.oldest.map(iso8601),
        last_commit: index.span.newest.map(iso8601),
        history_truncated: index.history_truncated,
        files_at_head: index.head.len(),
        people: index.authors.len(),
    }
}
