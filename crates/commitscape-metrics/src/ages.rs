//! How old things are: Staleness per file, and Code Age by quarter.

use std::collections::BTreeMap;

use commitscape_core::{FileId, Month};
use serde::Serialize;

use crate::analysis::{top, Analysis};

const DAY: i64 = 86_400;

/// How long since a file was last touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Age {
    /// Under a week.
    Week,
    /// Under 30 days.
    Month,
    /// Under 90 days.
    Quarter,
    /// Under a year.
    Year,
    /// A year or more.
    Older,
}

impl Age {
    /// Every bucket, youngest first.
    pub const EVERY: [Age; 5] = [Age::Week, Age::Month, Age::Quarter, Age::Year, Age::Older];

    pub fn of_days(days: i64) -> Age {
        match days {
            ..7 => Age::Week,
            7..30 => Age::Month,
            30..90 => Age::Quarter,
            90..365 => Age::Year,
            _ => Age::Older,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Age::Week => "under a week",
            Age::Month => "under a month",
            Age::Quarter => "under 3 months",
            Age::Year => "under a year",
            Age::Older => "a year or more",
        }
    }
}

/// How many files fall in one Staleness bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AgeCount {
    pub age: Age,
    pub files: u32,
}

/// When one file was last touched, and how long before the anchor that was.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct StaleFile {
    pub file: FileId,
    pub last_touched: i64,
    /// Whole days from `last_touched` to the Window's anchor.
    pub days: i64,
}

/// Staleness of every file people wrote at HEAD.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Staleness {
    /// Every bucket, youngest first, including empty ones.
    pub buckets: Vec<AgeCount>,
    /// Stalest first.
    pub files: Vec<StaleFile>,
}

/// Lines of code that first appeared in one quarter and survive at HEAD.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct QuarterAge {
    pub year: i64,
    /// 1 to 4.
    pub quarter: u32,
    /// Lines at HEAD in files that first appeared this quarter.
    pub lines: u64,
    pub files: u32,
}

impl Analysis<'_> {
    /// How long since each file people wrote was last touched, counted back
    /// from the Window's anchor. Unlike Churn it counts Bulk Commits and a
    /// merge's own resolutions: a file that was touched was touched.
    pub fn staleness(&self) -> Staleness {
        let index = self.index();
        let anchor = self.window().to;
        let mut files: Vec<StaleFile> = self
            .ranked()
            .filter_map(|h| {
                let history = index.history_of(h.file)?;
                Some(StaleFile {
                    file: h.file,
                    last_touched: history.last_touched,
                    days: ((anchor - history.last_touched) / DAY).max(0),
                })
            })
            .collect();
        let mut buckets: Vec<AgeCount> = Age::EVERY
            .iter()
            .map(|&age| AgeCount { age, files: 0 })
            .collect();
        for f in &files {
            if let Some(b) = buckets.iter_mut().find(|b| b.age == Age::of_days(f.days)) {
                b.files += 1;
            }
        }
        top(&mut files, |a, b| {
            b.days
                .cmp(&a.days)
                .then_with(|| self.by_path(a.file, b.file))
        });
        Staleness { buckets, files }
    }

    /// Code surviving at HEAD, by the quarter each file first appeared,
    /// oldest first. Measured per file until line-level history exists: a
    /// file's lines all count toward the quarter it was created in.
    pub fn code_age(&self) -> Vec<QuarterAge> {
        let index = self.index();
        let mut quarters: BTreeMap<(i64, u32), (u64, u32)> = BTreeMap::new();
        for h in self.code() {
            let Some(history) = index.history_of(h.file) else {
                continue;
            };
            let month = Month::of(history.first_seen);
            let key = (month.year(), (month.number() - 1) / 3 + 1);
            let entry = quarters.entry(key).or_default();
            entry.0 += h.loc as u64;
            entry.1 += 1;
        }
        quarters
            .into_iter()
            .map(|((year, quarter), (lines, files))| QuarterAge {
                year,
                quarter,
                lines,
                files,
            })
            .collect()
    }
}
