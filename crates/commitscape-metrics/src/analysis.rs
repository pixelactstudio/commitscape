//! One Index, one Window, one set of thresholds: every metric the interface
//! shows.

use std::cmp::Ordering;
use std::ops::Range;

use commitscape_core::{CommitMeta, FileId, HeadFile, Index};
use serde::Serialize;

use crate::window::Window;

/// Commits touching more files than this are Bulk Commits unless the caller
/// says otherwise.
///
/// Chosen from the changeset sizes of seven repositories (`cargo xtask
/// changesets`, recorded in STATE.md). Over 50 files is 0.15% of Linux's
/// commits and 1.2% of rust-lang/rust's: the reformat and mass-move tail. In
/// young application repositories it is 2 to 6%, mostly scaffolding drops,
/// which are what must not drive Change Coupling; a commit of 51 to 100 files
/// alone makes 1,275 to 4,950 pairs.
pub const DEFAULT_MAX_CHANGESET_SIZE: u32 = 50;

/// Change Coupling ignores files that changed in fewer commits than this.
pub const DEFAULT_COUPLING_SUPPORT: u32 = 5;

/// Directories with fewer commits than this in the Window are not reported
/// for Ownership: one person making the only two commits in a directory is
/// not a finding.
pub const DEFAULT_OWNERSHIP_MIN_COMMITS: u32 = 10;

/// The most rows a ranking returns. No Panel shows more, and ordering every
/// one of a large repository's 90,000 files to show the first dozen measured
/// 23ms of a warm start. A file past this is still reachable by asking about
/// it directly, as [`Analysis::churn_of`] does.
pub const RANKING_LIMIT: usize = 1000;

/// The thresholds an Analysis applies. Changing one never touches the Index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Options {
    /// A commit touching more files than this is a Bulk Commit, excluded
    /// from Churn and Change Coupling.
    pub max_changeset_size: u32,
    /// Files that changed in fewer commits than this within the Window are
    /// left out of Change Coupling.
    pub coupling_support: u32,
    /// Directories with fewer commits than this within the Window are left
    /// out of Ownership.
    pub ownership_min_commits: u32,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            max_changeset_size: DEFAULT_MAX_CHANGESET_SIZE,
            coupling_support: DEFAULT_COUPLING_SUPPORT,
            ownership_min_commits: DEFAULT_OWNERSHIP_MIN_COMMITS,
        }
    }
}

/// The Window starts before the history loaded so far. Wait for the rest of
/// history to load, or use a shorter Window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the window starts before the history loaded so far")]
pub struct NotLoaded;

/// What happened to the commits in the Window.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CommitCounts {
    pub in_window: u64,
    /// Merge Commits, excluded from Churn.
    pub merges: u64,
    /// Bulk Commits, excluded from Churn. Shown, so an exclusion is never
    /// silent.
    pub bulk: u64,
    /// Commits Churn counted: the rest.
    pub counted: u64,
}

/// A file's Churn in the Window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Churn {
    pub file: FileId,
    pub commits: u32,
}

/// A Hotspot, with the numbers its score is made of.
///
/// Both factors are percentile ranks: the share of files whose value is at or
/// below this one's. Ranks rather than fractions of the maximum, because
/// real repositories have pathological files; rust-lang/rust has a parser
/// test a hundred times more deeply indented than any real source, and
/// dividing by it made every other score round to zero.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Hotspot {
    pub file: FileId,
    /// Churn in the Window.
    pub churn: u32,
    /// Complexity Proxy at HEAD: the sum of indentation levels.
    pub complexity: u32,
    /// Where `churn` ranks among files with any Churn in the Window.
    pub churn_percentile: f64,
    /// Where `complexity` ranks among every file that can be ranked.
    pub complexity_percentile: f64,
    /// `churn_percentile * complexity_percentile`.
    pub score: f64,
}

/// A file at HEAD, by size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LargeFile {
    pub file: FileId,
    pub loc: u32,
    pub bytes: u64,
    pub complexity: u32,
}

/// Every metric over one Window of one Index.
pub struct Analysis<'i> {
    index: &'i Index,
    window: Window,
    options: Options,
    /// The Window's commits, a contiguous run of the time-ordered history.
    range: Range<usize>,
    /// Churn by `FileId`.
    churn: Vec<u32>,
    counts: CommitCounts,
}

impl<'i> Analysis<'i> {
    /// Refuses a Window reaching past the history loaded so far, rather than
    /// computing numbers from part of it.
    pub fn new(index: &'i Index, window: Window, options: Options) -> Result<Self, NotLoaded> {
        if !window.is_loaded(index) {
            return Err(NotLoaded);
        }
        let start = window
            .from
            .map_or(0, |from| index.commits.partition_point(|c| c.time < from));
        let end = index.commits.partition_point(|c| c.time <= window.to);
        let range = start..end.max(start);

        let mut churn = vec![0u32; index.paths.len()];
        let mut counts = CommitCounts::default();
        for commit in index.commits.get(range.clone()).unwrap_or(&[]) {
            counts.in_window += 1;
            match exclusion(commit, &options) {
                Some(Excluded::Merge) => counts.merges += 1,
                Some(Excluded::Bulk) => counts.bulk += 1,
                None => {
                    counts.counted += 1;
                    for change in index.changes_of(commit) {
                        if let Some(n) = churn.get_mut(change.file.idx()) {
                            *n += 1;
                        }
                    }
                }
            }
        }
        Ok(Analysis {
            index,
            window,
            options,
            range,
            churn,
            counts,
        })
    }

    pub fn index(&self) -> &'i Index {
        self.index
    }

    pub fn window(&self) -> Window {
        self.window
    }

    pub fn options(&self) -> Options {
        self.options
    }

    /// The Window's commits, in time order.
    pub fn window_commits(&self) -> &'i [CommitMeta] {
        self.index.commits.get(self.range.clone()).unwrap_or(&[])
    }

    /// How many commits the Window holds, and which were excluded.
    pub fn commits(&self) -> CommitCounts {
        self.counts
    }

    /// Churn of every file that can be ranked, most churned first. Files with
    /// none in the Window are left out.
    pub fn churn(&self) -> Vec<Churn> {
        let mut out: Vec<Churn> = self
            .ranked()
            .filter_map(|h| {
                let commits = self.churn_of(h.file);
                (commits > 0).then_some(Churn {
                    file: h.file,
                    commits,
                })
            })
            .collect();
        top(&mut out, |a, b| {
            b.commits
                .cmp(&a.commits)
                .then_with(|| self.by_path(a.file, b.file))
        });
        out
    }

    /// Code files that are both heavily changed and structurally complex,
    /// highest score first. A file with no Churn in the Window, or no
    /// indentation at all, is not a Hotspot.
    pub fn hotspots(&self) -> Vec<Hotspot> {
        let mut churns: Vec<u32> = self
            .code()
            .map(|h| self.churn_of(h.file))
            .filter(|&c| c > 0)
            .collect();
        churns.sort_unstable();
        let mut complexities: Vec<u32> = self.code().map(|h| h.indent_levels).collect();
        complexities.sort_unstable();

        let mut out: Vec<Hotspot> = self
            .code()
            .filter_map(|h| {
                let churn = self.churn_of(h.file);
                if churn == 0 || h.indent_levels == 0 {
                    return None;
                }
                let churn_percentile = percentile(&churns, churn);
                let complexity_percentile = percentile(&complexities, h.indent_levels);
                Some(Hotspot {
                    file: h.file,
                    churn,
                    complexity: h.indent_levels,
                    churn_percentile,
                    complexity_percentile,
                    score: churn_percentile * complexity_percentile,
                })
            })
            .collect();
        top(&mut out, |a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| self.by_path(a.file, b.file))
        });
        out
    }

    /// Code files at HEAD, most lines first.
    pub fn largest(&self) -> Vec<LargeFile> {
        let mut out: Vec<LargeFile> = self
            .code()
            .map(|h| LargeFile {
                file: h.file,
                loc: h.loc,
                bytes: h.bytes,
                complexity: h.indent_levels,
            })
            .collect();
        top(&mut out, |a, b| {
            b.loc.cmp(&a.loc).then_with(|| self.by_path(a.file, b.file))
        });
        out
    }

    /// The Window's counted commits that touched every one of `files`,
    /// newest first: the commits behind a Churn number or a coupled pair.
    /// Merge Commits and Bulk Commits are left out, as they are from both.
    pub fn commits_touching(&self, files: &[FileId]) -> Vec<&'i CommitMeta> {
        let index = self.index;
        self.window_commits()
            .iter()
            .rev()
            .filter(|c| counts(c, &self.options))
            .filter(|c| {
                let changes = index.changes_of(c);
                files.iter().all(|f| changes.iter().any(|ch| ch.file == *f))
            })
            .collect()
    }

    /// Churn of one file in the Window.
    pub fn churn_of(&self, file: FileId) -> u32 {
        self.churn.get(file.idx()).copied().unwrap_or(0)
    }

    /// Files at HEAD a person wrote: the only ones any ranking shows.
    pub(crate) fn ranked(&self) -> impl Iterator<Item = &'i HeadFile> {
        self.index.head.iter().filter(|h| h.class.is_rankable())
    }

    /// Code files at HEAD a person wrote: the ones size and the Complexity
    /// Proxy mean anything for.
    pub(crate) fn code(&self) -> impl Iterator<Item = &'i HeadFile> {
        self.index.head.iter().filter(|h| h.class.is_code())
    }

    pub(crate) fn by_path(&self, a: FileId, b: FileId) -> Ordering {
        self.index.paths.path(a).cmp(&self.index.paths.path(b))
    }
}

/// The share of a sorted population at or below `value`.
fn percentile(sorted: &[u32], value: u32) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted.partition_point(|&v| v <= value) as f64 / sorted.len() as f64
}

/// Keeps the first [`RANKING_LIMIT`] rows in `order`, sorted: a linear
/// selection, then a sort of what is kept.
pub(crate) fn top<T>(rows: &mut Vec<T>, mut order: impl FnMut(&T, &T) -> Ordering) {
    if rows.len() > RANKING_LIMIT {
        rows.select_nth_unstable_by(RANKING_LIMIT, &mut order);
        rows.truncate(RANKING_LIMIT);
    }
    rows.sort_by(order);
}

enum Excluded {
    Merge,
    Bulk,
}

/// Whether a commit counts for Churn, Ownership and Change Coupling: not a
/// Merge Commit and not a Bulk Commit.
pub(crate) fn counts(commit: &CommitMeta, options: &Options) -> bool {
    exclusion(commit, options).is_none()
}

/// Why a commit is left out of Churn, if it is.
fn exclusion(commit: &CommitMeta, options: &Options) -> Option<Excluded> {
    if commit.is_merge() {
        Some(Excluded::Merge)
    } else if commit.changes_len > options.max_changeset_size {
        Some(Excluded::Bulk)
    } else {
        None
    }
}
