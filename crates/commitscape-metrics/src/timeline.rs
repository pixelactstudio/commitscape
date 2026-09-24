//! The project's life as moments on a line: its first commit, its
//! releases, people joining and leaving, its busiest day and biggest
//! clean-up, its quiet stretches, and a change of main language.

use std::collections::HashMap;

use commitscape_core::{AuthorId, CommitMeta, FileClass};
use serde::Serialize;

use crate::analysis::Analysis;
use crate::languages::language_of;
use crate::roles::{is_lockfile, looks_generated};

const DAY: i64 = 86_400;

/// Who counts for joining and leaving: at least this share of the Window's
/// commits.
const MATTERS: f64 = 0.05;
/// A stretch this long without a commit is worth telling.
const QUIET_DAYS: i64 = 30;
/// How many of the longest quiet stretches are told.
const QUIET_SHOWN: usize = 3;
/// Someone whose last commit is this long before the Window's end has left.
const GONE_DAYS: i64 = 90;
/// The fewest lines, net, a commit must remove to be a clean-up.
const CLEANUP_LINES: u64 = 500;
/// The fewest lines added in a quarter for its main language to count.
const LANGUAGE_LINES: u64 = 500;

/// One moment in the project's life.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Moment {
    /// The project's first commit, when the Window holds it.
    FirstCommit {
        time: i64,
        author: Option<AuthorId>,
    },
    Release {
        time: i64,
        name: String,
    },
    /// Someone who made at least a twentieth of the Window's commits, at
    /// their first commit ever, when the Window holds it.
    Joined {
        time: i64,
        author: AuthorId,
    },
    /// The same, at their last commit up to the Window's end, when that
    /// was over 90 days before it.
    Left {
        time: i64,
        author: AuthorId,
    },
    /// The day with the most commits, at its start.
    BusiestDay {
        time: i64,
        commits: u32,
    },
    /// The commit that removed the most lines net, 500 or more, leaving out
    /// lockfiles and generated files.
    Cleanup {
        time: i64,
        author: Option<AuthorId>,
        removed: u64,
    },
    /// A month or more with no commit, from the last before it to the next.
    Quiet {
        time: i64,
        until: i64,
    },
    /// The language most lines were added in changed from one quarter to
    /// the next, at the start of the quarter it changed in.
    LanguageShift {
        time: i64,
        from: &'static str,
        to: &'static str,
    },
}

impl Moment {
    pub fn time(&self) -> i64 {
        match self {
            Moment::FirstCommit { time, .. }
            | Moment::Release { time, .. }
            | Moment::Joined { time, .. }
            | Moment::Left { time, .. }
            | Moment::BusiestDay { time, .. }
            | Moment::Cleanup { time, .. }
            | Moment::Quiet { time, .. }
            | Moment::LanguageShift { time, .. } => *time,
        }
    }

    /// Which comes first when two share a time.
    fn rank(&self) -> u8 {
        match self {
            Moment::FirstCommit { .. } => 0,
            Moment::Joined { .. } => 1,
            Moment::BusiestDay { .. } => 2,
            Moment::Cleanup { .. } => 3,
            Moment::Release { .. } => 4,
            Moment::LanguageShift { .. } => 5,
            Moment::Left { .. } => 6,
            Moment::Quiet { .. } => 7,
        }
    }
}

impl Analysis<'_> {
    /// The Window's moments, in time order, with `releases` (name, time)
    /// among them.
    pub fn timeline(&self, releases: &[(String, i64)]) -> Vec<Moment> {
        let index = self.index();
        let window = self.window();
        let commits: Vec<&CommitMeta> = self
            .window_commits()
            .iter()
            .filter(|c| !c.is_merge())
            .collect();
        let mut out = Vec::new();
        if commits.is_empty() {
            return out;
        }
        // Everyone's first commit ever and last up to the Window's end.
        // Firsts are known only once all of history is loaded.
        let complete = index.loaded_from.is_none();
        let mut ever: HashMap<AuthorId, (i64, i64)> = HashMap::new();
        let mut project_first: Option<&CommitMeta> = None;
        for c in index
            .commits
            .iter()
            .filter(|c| !c.is_merge() && c.time <= window.to)
        {
            project_first = project_first.or(Some(c));
            if let Some(a) = self.person_of(c) {
                let e = ever.entry(a).or_insert((c.time, c.time));
                e.0 = e.0.min(c.time);
                e.1 = e.1.max(c.time);
            }
        }
        let in_window = |t: i64| window.from.is_none_or(|f| t >= f);
        if let Some(first) = project_first.filter(|c| complete && in_window(c.time)) {
            out.push(Moment::FirstCommit {
                time: first.time,
                author: self.person_of(first),
            });
        }
        for (name, time) in releases {
            if window.from.is_none_or(|f| *time >= f) && *time <= window.to {
                out.push(Moment::Release {
                    time: *time,
                    name: name.clone(),
                });
            }
        }

        // Joining and leaving, by those who made a real share.
        let mut made: HashMap<AuthorId, u32> = HashMap::new();
        for c in &commits {
            if let Some(a) = self.person_of(c) {
                *made.entry(a).or_default() += 1;
            }
        }
        let total = commits.len() as f64;
        let first_author = project_first.and_then(|c| self.person_of(c));
        for (&author, &n) in &made {
            let Some(&(joined, last)) = ever.get(&author) else {
                continue;
            };
            if f64::from(n) < total * MATTERS {
                continue;
            }
            if complete && in_window(joined) && Some(author) != first_author {
                out.push(Moment::Joined {
                    time: joined,
                    author,
                });
            }
            if window.to - last >= GONE_DAYS * DAY {
                out.push(Moment::Left { time: last, author });
            }
        }

        // The busiest day, the earliest on a tie.
        let mut per_day: HashMap<i64, u32> = HashMap::new();
        for c in &commits {
            *per_day.entry(c.landed_clock().div_euclid(DAY)).or_default() += 1;
        }
        if let Some((&day, &n)) = per_day
            .iter()
            .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
        {
            if n >= 2 {
                out.push(Moment::BusiestDay {
                    time: day * DAY,
                    commits: n,
                });
            }
        }

        // The biggest clean-up, and lines added by language and quarter.
        let mut class: Vec<Option<FileClass>> = vec![None; index.paths.len()];
        for h in &index.head {
            if let Some(slot) = class.get_mut(h.file.idx()) {
                *slot = Some(h.class);
            }
        }
        let written = |file: commitscape_core::FileId| {
            let path = index.paths.path(file).unwrap_or_default();
            let generated = match class.get(file.idx()).copied().flatten() {
                Some(c) => matches!(c, FileClass::Generated | FileClass::Vendored),
                None => looks_generated(path),
            };
            !generated && !is_lockfile(path)
        };
        let mut cleanup: Option<(u64, &CommitMeta)> = None;
        let mut added: HashMap<(i64, &'static str), u64> = HashMap::new();
        for c in &commits {
            let (mut plus, mut minus) = (0u64, 0u64);
            for change in index.changes_of(c) {
                let Some(d) = change.lines else {
                    continue;
                };
                if !written(change.file) {
                    continue;
                }
                plus += u64::from(d.added);
                minus += u64::from(d.removed);
                if let Some(language) = index.paths.path(change.file).and_then(language_of) {
                    *added.entry((quarter_of(c.time), language)).or_default() += u64::from(d.added);
                }
            }
            let net = minus.saturating_sub(plus);
            if net >= CLEANUP_LINES && cleanup.is_none_or(|(best, _)| net > best) {
                cleanup = Some((net, c));
            }
        }
        if let Some((removed, c)) = cleanup {
            out.push(Moment::Cleanup {
                time: c.time,
                author: self.person_of(c),
                removed,
            });
        }
        let mut quarters: Vec<i64> = added.keys().map(|(q, _)| *q).collect();
        quarters.sort_unstable();
        quarters.dedup();
        let mut main: Option<&'static str> = None;
        for q in quarters {
            let top = added
                .iter()
                .filter(|((quarter, _), &lines)| *quarter == q && lines >= LANGUAGE_LINES)
                .max_by(|a, b| a.1.cmp(b.1).then(b.0 .1.cmp(a.0 .1)))
                .map(|((_, language), _)| *language);
            let Some(top) = top else {
                continue;
            };
            if let Some(before) = main.filter(|&m| m != top) {
                out.push(Moment::LanguageShift {
                    time: quarter_start(q),
                    from: before,
                    to: top,
                });
            }
            main = Some(top);
        }

        // Quiet stretches: the longest gaps between commits.
        let mut gaps: Vec<(i64, i64)> = commits
            .windows(2)
            .filter_map(|w| match w {
                [a, b] if b.time - a.time >= QUIET_DAYS * DAY => Some((a.time, b.time)),
                _ => None,
            })
            .collect();
        gaps.sort_by_key(|&(a, b)| std::cmp::Reverse(b - a));
        for &(time, until) in gaps.iter().take(QUIET_SHOWN) {
            out.push(Moment::Quiet { time, until });
        }

        out.sort_by_key(|m| (m.time(), m.rank()));
        out
    }
}

/// A quarter as a count since the epoch's first.
fn quarter_of(time: i64) -> i64 {
    let (y, m, _) = commitscape_core::civil_from_unix(time);
    y * 4 + i64::from((m - 1) / 3)
}

fn quarter_start(quarter: i64) -> i64 {
    let year = quarter.div_euclid(4);
    let month = quarter.rem_euclid(4) * 3 + 1;
    commitscape_core::parse_iso8601(&format!("{year:04}-{month:02}-01T00:00:00Z")).unwrap_or(0)
}
