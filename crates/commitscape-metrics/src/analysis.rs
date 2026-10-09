use std::cmp::Ordering;
use std::ops::Range;

use commitscape_core::{AuthorId, CommitFlags, CommitMeta, FileId, HeadFile, Index};
use serde::Serialize;

use crate::window::Window;

pub const DEFAULT_MAX_CHANGESET_SIZE: u32 = 50;

pub const DEFAULT_COUPLING_SUPPORT: u32 = 5;

pub const DEFAULT_OWNERSHIP_MIN_COMMITS: u32 = 10;

pub const RANKING_LIMIT: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Options {
    pub max_changeset_size: u32,
    pub coupling_support: u32,
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

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CommitCounts {
    pub in_window: u64,
    pub merges: u64,
    pub bulk: u64,
    pub counted: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Churn {
    pub file: FileId,
    pub commits: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LargeFile {
    pub file: FileId,
    pub loc: u32,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Totals {
    pub commits: u64,
    pub merges: u64,
    pub first_commit: Option<i64>,
    pub last_commit: Option<i64>,
    pub people: usize,
    pub files: u32,
    pub code_files: u32,
    pub code_lines: u64,
    pub prose_lines: u64,
    pub generated_files: u32,
}

pub struct Analysis<'i> {
    index: &'i Index,
    window: Window,
    options: Options,
    range: Range<usize>,
    churn: Vec<u32>,
    counts: CommitCounts,
}

impl<'i> Analysis<'i> {
    /// Every metric over one Window of an Index.
    pub fn new(index: &'i Index, window: Window, options: Options) -> Self {
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
        Analysis {
            index,
            window,
            options,
            range,
            churn,
            counts,
        }
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

    pub fn person_of(&self, commit: &CommitMeta) -> Option<AuthorId> {
        let author = self.index.author_of(commit)?;
        (!self.index.authors.is_bot(author)).then_some(author)
    }

    pub fn window_commits(&self) -> &'i [CommitMeta] {
        self.index.commits.get(self.range.clone()).unwrap_or(&[])
    }

    pub fn commits(&self) -> CommitCounts {
        self.counts
    }

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

    pub fn largest(&self) -> Vec<LargeFile> {
        let mut out: Vec<LargeFile> = self
            .code()
            .map(|h| LargeFile {
                file: h.file,
                loc: h.loc,
                bytes: h.bytes,
            })
            .collect();
        top(&mut out, |a, b| {
            b.loc.cmp(&a.loc).then_with(|| self.by_path(a.file, b.file))
        });
        out
    }

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

    pub fn totals(&self) -> Totals {
        let index = self.index;
        let mut t = Totals {
            commits: index.span.commits,
            merges: index.span.merges,
            first_commit: index.span.oldest,
            last_commit: index.span.newest,
            people: index
                .authors
                .iter()
                .filter(|(_, a)| !a.traits.is_bot())
                .count(),
            files: 0,
            code_files: 0,
            code_lines: 0,
            prose_lines: 0,
            generated_files: 0,
        };
        for h in &index.head {
            if !h.class.is_rankable() {
                t.generated_files += 1;
            } else if h.class.is_code() {
                t.files += 1;
                t.code_files += 1;
                t.code_lines += u64::from(h.loc);
            } else {
                t.files += 1;
                t.prose_lines += u64::from(h.loc);
            }
        }
        t
    }

    pub fn churn_of(&self, file: FileId) -> u32 {
        self.churn.get(file.idx()).copied().unwrap_or(0)
    }

    pub(crate) fn ranked(&self) -> impl Iterator<Item = &'i HeadFile> {
        self.index.head.iter().filter(|h| h.class.is_rankable())
    }

    pub(crate) fn code(&self) -> impl Iterator<Item = &'i HeadFile> {
        self.index.head.iter().filter(|h| h.class.is_code())
    }

    pub(crate) fn by_path(&self, a: FileId, b: FileId) -> Ordering {
        self.index.paths.path(a).cmp(&self.index.paths.path(b))
    }
}

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

pub(crate) fn counts(commit: &CommitMeta, options: &Options) -> bool {
    exclusion(commit, options).is_none()
}

fn exclusion(commit: &CommitMeta, options: &Options) -> Option<Excluded> {
    if commit.is_merge() {
        Some(Excluded::Merge)
    } else if commit.changes_len > options.max_changeset_size
        || commit.flags.contains(CommitFlags::BULK)
    {
        Some(Excluded::Bulk)
    } else {
        None
    }
}
