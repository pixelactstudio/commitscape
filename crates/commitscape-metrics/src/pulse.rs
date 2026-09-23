//! The Pulse: when and how a Window's commits were made, each on its
//! author's Local Time.

use commitscape_core::{AuthorId, CommitFlags, CommitKind, CommitMeta};
use serde::Serialize;

use crate::analysis::Analysis;

const DAY: i64 = 86_400;

/// A run of consecutive days, each with at least one commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Streak {
    /// The run's first day, in days since the epoch.
    pub first_day: i64,
    pub days: u32,
}

/// How many of a Pulse's commits were of one Commit Kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct KindCount {
    pub kind: CommitKind,
    pub commits: u32,
}

/// When the Window's commits were made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pulse {
    /// The Window's commits that are not merges. Bulk Commits count: the
    /// Pulse is about when work happened, not about what it changed.
    pub commits: u32,
    /// The day `days` starts on, in days since the epoch.
    pub first_day: i64,
    /// Commits per day of Local Time, from `first_day` through the Window's
    /// last day.
    pub days: Vec<u32>,
    /// Commits by weekday, Monday first, and by hour of Local Time.
    pub week: [[u32; 24]; 7],
    /// Every Commit Kind, in [`CommitKind::EVERY`] order.
    pub kinds: Vec<KindCount>,
    /// Agent Commits.
    pub agent: u32,
    /// Days with at least one commit.
    pub active_days: u32,
    /// The longest run of active days: the earliest, on a tie.
    pub longest_streak: Option<Streak>,
    /// The day with the most commits, and how many: the earliest, on a tie.
    pub busiest_day: Option<(i64, u32)>,
}

impl Pulse {
    /// The hour of the day with the most commits: the earliest, on a tie.
    pub fn busiest_hour(&self) -> Option<usize> {
        busiest((0..24).map(|hour| self.week.iter().map(|day| at(day, hour)).sum()))
    }

    /// The weekday with the most commits, Monday being 0: the earliest, on a
    /// tie.
    pub fn busiest_weekday(&self) -> Option<usize> {
        busiest(self.week.iter().map(|hours| hours.iter().sum()))
    }

    /// Commits made on a Saturday or a Sunday.
    pub fn weekend(&self) -> u32 {
        self.week.iter().skip(5).flatten().sum()
    }

    /// Commits made between 22:00 and 04:59.
    pub fn night(&self) -> u32 {
        self.week
            .iter()
            .map(|hours| {
                (0..5)
                    .chain(22..24)
                    .map(|hour| at(hours, hour))
                    .sum::<u32>()
            })
            .sum()
    }
}

fn at(hours: &[u32; 24], hour: usize) -> u32 {
    hours.get(hour).copied().unwrap_or(0)
}

/// The position of the largest count, the earliest on a tie; `None` when
/// every count is zero.
fn busiest(counts: impl Iterator<Item = u32>) -> Option<usize> {
    let mut best: Option<(usize, u32)> = None;
    for (i, n) in counts.enumerate() {
        if n > best.map_or(0, |(_, most)| most) {
            best = Some((i, n));
        }
    }
    best.map(|(i, _)| i)
}

/// Days since the epoch on a commit author's Local Time.
fn local_day(commit: &CommitMeta) -> i64 {
    commit.author_clock().div_euclid(DAY)
}

impl Analysis<'_> {
    /// When the Window's commits were made, on each author's Local Time.
    /// `who` narrows it to one person's commits.
    pub fn pulse(&self, who: Option<AuthorId>) -> Pulse {
        let index = self.index();
        let window = self.window();
        let commits: Vec<&CommitMeta> = self
            .window_commits()
            .iter()
            .filter(|c| !c.is_merge())
            .filter(|c| who.is_none_or(|w| index.author_of(c) == Some(w)))
            .collect();

        // The Window's days, widened to hold any commit whose author's date
        // falls just outside it.
        let last_day = commits
            .iter()
            .map(|c| local_day(c))
            .chain([window.to.div_euclid(DAY)])
            .max()
            .unwrap_or_default();
        let first_day = commits
            .iter()
            .map(|c| local_day(c))
            .chain(window.from.map(|f| f.div_euclid(DAY)))
            .min()
            .unwrap_or(last_day);

        let mut days = vec![0u32; (last_day - first_day + 1).max(0) as usize];
        let mut week = [[0u32; 24]; 7];
        let mut kinds: Vec<KindCount> = CommitKind::EVERY
            .iter()
            .map(|&kind| KindCount { kind, commits: 0 })
            .collect();
        let mut agent = 0;
        for c in &commits {
            let clock = c.author_clock();
            let day = clock.div_euclid(DAY);
            if let Some(n) = days.get_mut((day - first_day) as usize) {
                *n += 1;
            }
            // 1 January 1970 was a Thursday.
            let weekday = (day + 3).rem_euclid(7) as usize;
            let hour = (clock.rem_euclid(DAY) / 3600) as usize;
            if let Some(n) = week.get_mut(weekday).and_then(|h| h.get_mut(hour)) {
                *n += 1;
            }
            if let Some(k) = kinds.iter_mut().find(|k| k.kind == c.kind) {
                k.commits += 1;
            }
            if c.flags.contains(CommitFlags::AGENT) {
                agent += 1;
            }
        }

        let mut longest_streak: Option<Streak> = None;
        let mut run = 0u32;
        for (i, &n) in days.iter().enumerate() {
            run = if n > 0 { run + 1 } else { 0 };
            if run > longest_streak.map_or(0, |s| s.days) {
                longest_streak = Some(Streak {
                    first_day: first_day + i as i64 + 1 - i64::from(run),
                    days: run,
                });
            }
        }

        Pulse {
            commits: commits.len() as u32,
            first_day,
            active_days: days.iter().filter(|&&n| n > 0).count() as u32,
            busiest_day: busiest(days.iter().copied())
                .and_then(|i| days.get(i).map(|&n| (first_day + i as i64, n))),
            days,
            week,
            kinds,
            agent,
            longest_streak,
        }
    }
}
