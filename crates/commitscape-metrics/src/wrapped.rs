//! `wrapped`: one person's year across every repository they work in. Each
//! repository gives its part ([`Analysis::year_in`]) and [`wrapped`] puts
//! them together, so a streak or a busy day can run across repositories.

use std::collections::{BTreeMap, HashMap};

use std::ops::RangeInclusive;

use commitscape_core::{AuthorId, CommitMeta};
use serde::Serialize;

use crate::analysis::Analysis;
use crate::languages::language_of;
use crate::roles::{is_lockfile, looks_generated};

const DAY: i64 = 86_400;

/// One repository's part of a person's year.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct YearIn {
    pub commits: u32,
    /// Lines added and removed, lockfiles and generated files left out;
    /// `None` when none of the commits' lines were counted.
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    /// Commits by day since the epoch, on the author's clock when written.
    pub days: BTreeMap<i64, u32>,
    /// Commits by hour, on the author's clock.
    pub hours: [u32; 24],
    /// Lines added by language.
    pub languages: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoYear {
    pub name: String,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LanguageYear {
    pub name: String,
    pub lines: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DayCount {
    /// Days since the epoch.
    pub day: i64,
    pub commits: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct StreakYear {
    pub first_day: i64,
    pub days: u32,
}

/// A person's year, across repositories.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Wrapped {
    pub commits: u32,
    pub active_days: u32,
    /// Most commits first.
    pub repositories: Vec<RepoYear>,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    /// By lines added, most first.
    pub languages: Vec<LanguageYear>,
    pub busiest_day: Option<DayCount>,
    /// The most days in a row with a commit, the earliest on a tie.
    pub streak: Option<StreakYear>,
    /// Commits between 22:00 and 05:00 on the author's clock.
    pub night: u32,
    pub hours: [u32; 24],
    pub days: BTreeMap<i64, u32>,
}

impl Analysis<'_> {
    /// The commits by `people` (one person's identities) written on
    /// `days` (days since the epoch, on their own clock) that `keep`
    /// keeps, merges left out. The Window must hold them all: a day on
    /// someone's clock can start up to 14 hours either side of UTC's.
    pub fn year_in(
        &self,
        people: &[AuthorId],
        days: RangeInclusive<i64>,
        keep: &dyn Fn(&CommitMeta) -> bool,
    ) -> YearIn {
        let index = self.index();
        let mut year = YearIn::default();
        let (mut added, mut removed, mut counted) = (0u64, 0u64, false);
        for c in self.window_commits() {
            if c.is_merge() || !index.author_of(c).is_some_and(|a| people.contains(&a)) {
                continue;
            }
            // When it was written, on its author's clock: its day and hour.
            let clock = c.author_clock();
            if !days.contains(&clock.div_euclid(DAY)) || !keep(c) {
                continue;
            }
            year.commits += 1;
            *year.days.entry(clock.div_euclid(DAY)).or_default() += 1;
            let hour = clock.rem_euclid(DAY) / 3600;
            if let Some(h) = year.hours.get_mut(hour as usize) {
                *h += 1;
            }
            for ch in index.changes_of(c) {
                let Some(d) = ch.lines else {
                    continue;
                };
                let Some(path) = index.paths.path(ch.file) else {
                    continue;
                };
                if is_lockfile(path) || looks_generated(path) {
                    continue;
                }
                counted = true;
                added += u64::from(d.added);
                removed += u64::from(d.removed);
                if let Some(language) = language_of(path) {
                    *year.languages.entry(language.to_string()).or_default() += u64::from(d.added);
                }
            }
        }
        if counted {
            year.lines_added = Some(added);
            year.lines_removed = Some(removed);
        }
        year
    }
}

/// The year across repositories, each named.
pub fn wrapped(repos: &[(String, YearIn)]) -> Wrapped {
    let mut days: BTreeMap<i64, u32> = BTreeMap::new();
    let mut hours = [0u32; 24];
    let mut languages: HashMap<&str, u64> = HashMap::new();
    let (mut added, mut removed) = (None::<u64>, None::<u64>);
    let mut repositories = Vec::new();
    for (name, y) in repos {
        if y.commits == 0 {
            continue;
        }
        repositories.push(RepoYear {
            name: name.clone(),
            commits: y.commits,
        });
        for (&d, &n) in &y.days {
            *days.entry(d).or_default() += n;
        }
        for (all, h) in hours.iter_mut().zip(y.hours) {
            *all += h;
        }
        for (l, &n) in &y.languages {
            *languages.entry(l).or_default() += n;
        }
        if let Some(a) = y.lines_added {
            added = Some(added.unwrap_or(0) + a);
        }
        if let Some(r) = y.lines_removed {
            removed = Some(removed.unwrap_or(0) + r);
        }
    }
    repositories.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.name.cmp(&b.name)));
    let mut languages: Vec<LanguageYear> = languages
        .into_iter()
        .filter(|(_, n)| *n > 0)
        .map(|(name, lines)| LanguageYear {
            name: name.to_string(),
            lines,
        })
        .collect();
    languages.sort_by(|a, b| b.lines.cmp(&a.lines).then(a.name.cmp(&b.name)));

    let busiest_day = days
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
        .map(|(&day, &commits)| DayCount { day, commits });
    let mut streak: Option<StreakYear> = None;
    let mut run: Option<StreakYear> = None;
    for &d in days.keys() {
        run = match run {
            Some(r) if r.first_day + i64::from(r.days) == d => Some(StreakYear {
                days: r.days + 1,
                ..r
            }),
            _ => Some(StreakYear {
                first_day: d,
                days: 1,
            }),
        };
        if let Some(r) = run {
            if streak.is_none_or(|s| r.days > s.days) {
                streak = Some(r);
            }
        }
    }
    let night = hours
        .iter()
        .enumerate()
        .filter(|(h, _)| *h >= 22 || *h < 5)
        .map(|(_, n)| n)
        .sum();
    Wrapped {
        commits: repositories.iter().map(|r| r.commits).sum(),
        active_days: days.len() as u32,
        repositories,
        lines_added: added,
        lines_removed: removed,
        languages,
        busiest_day,
        streak,
        night,
        hours,
        days,
    }
}
