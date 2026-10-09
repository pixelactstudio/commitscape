use std::collections::BTreeMap;

use commitscape_core::{FileId, HeadFile, Month};
use serde::Serialize;

use crate::analysis::{top, Analysis};

const DAY: i64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Age {
    Week,
    Month,
    Quarter,
    Year,
    Older,
}

impl Age {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AgeCount {
    pub age: Age,
    pub files: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct StaleFile {
    pub file: FileId,
    pub last_touched: i64,
    pub days: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Staleness {
    pub buckets: Vec<AgeCount>,
    pub files: Vec<StaleFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct QuarterAge {
    pub year: i64,
    pub quarter: u32,
    pub lines: u64,
    pub files: u32,
}

impl Analysis<'_> {
    pub fn staleness(&self) -> Staleness {
        let mut files: Vec<StaleFile> = self.stale().collect();
        let mut buckets: Vec<AgeCount> = Age::EVERY
            .iter()
            .map(|&age| AgeCount { age, files: 0 })
            .collect();
        for f in &files {
            if let Some(b) = buckets.iter_mut().find(|b| b.age == Age::of_days(f.days)) {
                b.files += 1;
            }
        }
        top(&mut files, |a, b| self.stalest_first(a, b));
        Staleness { buckets, files }
    }

    fn stale(&self) -> impl Iterator<Item = StaleFile> + '_ {
        let index = self.index();
        let anchor = self.window().to;
        self.ranked().filter_map(move |h| {
            let history = index.history_of(h.file)?;
            Some(StaleFile {
                file: h.file,
                last_touched: history.last_touched,
                days: ((anchor - history.last_touched) / DAY).max(0),
            })
        })
    }

    fn stalest_first(&self, a: &StaleFile, b: &StaleFile) -> std::cmp::Ordering {
        b.days
            .cmp(&a.days)
            .then_with(|| self.by_path(a.file, b.file))
    }

    pub fn code_age(&self) -> Vec<QuarterAge> {
        let mut quarters: BTreeMap<(i64, u32), (u64, u32)> = BTreeMap::new();
        for (h, key) in self.created() {
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

    fn created(&self) -> impl Iterator<Item = (&HeadFile, (i64, u32))> + '_ {
        let index = self.index();
        self.code().filter_map(move |h| {
            let month = Month::of(index.history_of(h.file)?.first_seen);
            Some((h, (month.year(), (month.number() - 1) / 3 + 1)))
        })
    }
}
