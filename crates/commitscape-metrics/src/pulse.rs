//! The Pulse: when and how a Window's commits were made, each on its
//! author's Local Time. A commit counts on the day it landed, as the
//! Window holds it, and at the hour it was written.

use commitscape_core::{AuthorId, CommitKind, CommitMeta};
use serde::Serialize;

use crate::analysis::Analysis;
use crate::roles::{role_of, Role};

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

/// What a commit's work was: judged first from the files it touched, and
/// only when they do not settle it from what its message says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Work {
    Feature,
    Fix,
    Refactor,
    Performance,
    Style,
    /// Only test files.
    Tests,
    /// Only documentation and prose.
    Docs,
    /// Only dependency manifests and lockfiles.
    Dependencies,
    /// Only CI configuration.
    Ci,
    Build,
    Chore,
    Revert,
    /// Neither its files nor its message say.
    Unclassified,
}

impl Work {
    pub const EVERY: [Work; 13] = [
        Work::Feature,
        Work::Fix,
        Work::Refactor,
        Work::Performance,
        Work::Style,
        Work::Tests,
        Work::Docs,
        Work::Dependencies,
        Work::Ci,
        Work::Build,
        Work::Chore,
        Work::Revert,
        Work::Unclassified,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Work::Feature => "features",
            Work::Fix => "fixes",
            Work::Refactor => "refactors",
            Work::Performance => "performance",
            Work::Style => "style",
            Work::Tests => "tests",
            Work::Docs => "docs",
            Work::Dependencies => "dependencies",
            Work::Ci => "CI",
            Work::Build => "build",
            Work::Chore => "chores",
            Work::Revert => "reverts",
            Work::Unclassified => "unclassified",
        }
    }

    /// A commit's work, from the roles of the files it touched and its
    /// Commit Kind.
    pub fn of(mut roles: impl Iterator<Item = Role>, kind: CommitKind) -> Work {
        if let Some(first) = roles.next() {
            if roles.all(|r| r == first) {
                match first {
                    Role::Test => return Work::Tests,
                    Role::Docs => return Work::Docs,
                    Role::Dependencies => return Work::Dependencies,
                    Role::Ci => return Work::Ci,
                    Role::Code => {}
                }
            }
        }
        match kind {
            CommitKind::Feature => Work::Feature,
            CommitKind::Fix => Work::Fix,
            CommitKind::Docs => Work::Docs,
            CommitKind::Refactor => Work::Refactor,
            CommitKind::Test => Work::Tests,
            CommitKind::Performance => Work::Performance,
            CommitKind::Style => Work::Style,
            CommitKind::Build => Work::Build,
            CommitKind::Chore => Work::Chore,
            CommitKind::Revert => Work::Revert,
            CommitKind::Other => Work::Unclassified,
        }
    }
}

/// How many of a Pulse's commits did one kind of work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct WorkCount {
    pub work: Work,
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
    /// Commits per day, by the day each landed on its author's calendar,
    /// from `first_day` through the Window's last day.
    pub days: Vec<u32>,
    /// Commits by weekday, Monday first, and by hour of Local Time: when the
    /// work was done, which for a rebased commit is before it landed.
    pub week: [[u32; 24]; 7],
    /// Every Commit Kind, in [`CommitKind::EVERY`] order: what the messages
    /// say.
    pub kinds: Vec<KindCount>,
    /// Every kind of work, in [`Work::EVERY`] order: what the files say
    /// first, then the messages.
    pub work: Vec<WorkCount>,
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

/// The day, since the epoch, a commit landed on its author's calendar.
fn landed_day(commit: &CommitMeta) -> i64 {
    commit.landed_clock().div_euclid(DAY)
}

impl Analysis<'_> {
    /// When the Window's commits were made, on each author's Local Time.
    /// `who` narrows it to one person's commits.
    pub fn pulse(&self, who: Option<AuthorId>) -> Pulse {
        let mut p = self.pulse_in_time(who);
        p.work = self.work(who);
        p
    }

    /// The kinds of work of the Window's commits that are not merges,
    /// `who` narrowing them to one person's, in [`Work::EVERY`] order.
    pub fn work(&self, who: Option<AuthorId>) -> Vec<WorkCount> {
        let index = self.index();
        let mut work: Vec<WorkCount> = Work::EVERY
            .iter()
            .map(|&work| WorkCount { work, commits: 0 })
            .collect();
        // Each file's role, judged once: a Window's changes touch the same
        // files again and again.
        let mut roles: Vec<Option<Role>> = vec![None; index.paths.len()];
        let mut role = |file: commitscape_core::FileId| -> Role {
            match roles.get(file.idx()).copied().flatten() {
                Some(r) => r,
                None => {
                    let r = index.paths.path(file).map_or(Role::Code, role_of);
                    if let Some(slot) = roles.get_mut(file.idx()) {
                        *slot = Some(r);
                    }
                    r
                }
            }
        };
        for c in self
            .window_commits()
            .iter()
            .filter(|c| !c.is_merge())
            .filter(|c| who.is_none_or(|w| index.author_of(c) == Some(w)))
        {
            let mut here = index.changes_of(c).iter().map(|ch| role(ch.file));
            let w = Work::of(&mut here, c.kind);
            if let Some(n) = work.iter_mut().find(|x| x.work == w) {
                n.commits += 1;
            }
        }
        work
    }

    /// The Pulse without its kinds of work, which [`work`](Self::work)
    /// gives on its own: judging each file's role is most of the Pulse's
    /// cost on a large repository.
    pub fn pulse_in_time(&self, who: Option<AuthorId>) -> Pulse {
        let index = self.index();
        let window = self.window();
        let commits: Vec<&CommitMeta> = self
            .window_commits()
            .iter()
            .filter(|c| !c.is_merge())
            .filter(|c| who.is_none_or(|w| index.author_of(c) == Some(w)))
            .collect();

        // The Window's days, widened to hold any commit whose date on its
        // author's calendar falls just outside it.
        let last_day = commits
            .iter()
            .map(|c| landed_day(c))
            .chain([window.to.div_euclid(DAY)])
            .max()
            .unwrap_or_default();
        let first_day = commits
            .iter()
            .map(|c| landed_day(c))
            .chain(window.from.map(|f| f.div_euclid(DAY)))
            .min()
            .unwrap_or(last_day);

        let mut days = vec![0u32; (last_day - first_day + 1).max(0) as usize];
        let mut week = [[0u32; 24]; 7];
        let mut kinds: Vec<KindCount> = CommitKind::EVERY
            .iter()
            .map(|&kind| KindCount { kind, commits: 0 })
            .collect();
        for c in &commits {
            if let Some(n) = days.get_mut((landed_day(c) - first_day) as usize) {
                *n += 1;
            }
            let clock = c.author_clock();
            // 1 January 1970 was a Thursday.
            let weekday = (clock.div_euclid(DAY) + 3).rem_euclid(7) as usize;
            let hour = (clock.rem_euclid(DAY) / 3600) as usize;
            if let Some(n) = week.get_mut(weekday).and_then(|h| h.get_mut(hour)) {
                *n += 1;
            }
            if let Some(k) = kinds.iter_mut().find(|k| k.kind == c.kind) {
                k.commits += 1;
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
            work: Vec::new(),
            longest_streak,
        }
    }
}

/// Commits per day split among the people who made the most and everyone
/// else, bots included, for a chart of commits over time by person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitsByPerson {
    /// The date `days` starts on: the Pulse's first day.
    pub first_day: i64,
    /// Most commits first.
    pub people: Vec<AuthorId>,
    /// For each day, each person's commits in `people` order, then
    /// everyone else's.
    pub days: Vec<Vec<u32>>,
}

impl Analysis<'_> {
    /// The Window's commits per day, split among the `top` people with the
    /// most commits and everyone else. Days line up with
    /// [`pulse`](Self::pulse)'s.
    pub fn commits_by_person(&self, top: usize) -> CommitsByPerson {
        self.commits_by_person_in(&self.pulse(None), &self.contributors(), top)
    }

    /// [`commits_by_person`](Self::commits_by_person) from the Pulse and
    /// the contributors already computed.
    pub fn commits_by_person_in(
        &self,
        pulse: &Pulse,
        contributors: &[crate::Contributor],
        top: usize,
    ) -> CommitsByPerson {
        let people: Vec<AuthorId> = contributors.iter().take(top).map(|c| c.author).collect();
        let index = self.index();
        let mut days = vec![vec![0u32; people.len() + 1]; pulse.days.len()];
        for c in self.window_commits().iter().filter(|c| !c.is_merge()) {
            let column = index
                .author_of(c)
                .and_then(|a| people.iter().position(|&p| p == a))
                .unwrap_or(people.len());
            let Some(day) = days.get_mut((landed_day(c) - pulse.first_day) as usize) else {
                continue;
            };
            if let Some(n) = day.get_mut(column) {
                *n += 1;
            }
        }
        CommitsByPerson {
            first_day: pulse.first_day,
            people,
            days,
        }
    }
}
