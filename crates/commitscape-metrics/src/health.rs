//! `health`: whether a project is alive and whether it depends on one
//! person. Who kept it going lately, its Bus Factor over the last year, how
//! often it ships, how fast an issue gets a first answer, and whether it is
//! getting busier or quieter.

use std::collections::HashMap;

use commitscape_core::AuthorId;
use serde::Serialize;

use crate::analysis::Analysis;

const DAY: i64 = 86_400;
/// "Lately": the last this many days, and the same before them for trend.
const RECENT_DAYS: i64 = 90;
const YEAR_DAYS: i64 = 365;
/// The fewest commits lately that make someone a maintainer.
const MAINTAINER_COMMITS: u32 = 3;
/// Bus Factor's line: the fewest people holding more than this share.
const BUS_SHARE: f64 = 0.8;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Health {
    /// Who made at least 3 commits in the last 90 days, most first.
    pub maintainers: Vec<Maintainer>,
    /// The fewest people who made over 80% of the last year's commits;
    /// `None` when there were none.
    pub bus_factor: Option<u32>,
    pub releases: Releases,
    /// `None` when the issues are not known.
    pub answers: Option<Answers>,
    pub trend: Trend,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Maintainer {
    pub author: AuthorId,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Releases {
    /// Releases in the last year.
    pub in_year: u32,
    /// Days between consecutive releases in the last year, the middle one.
    pub typical_gap_days: Option<i64>,
    /// Days since the latest release.
    pub since_last_days: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Answers {
    /// Issues asked about.
    pub asked: u32,
    /// Of them, those someone other than their author answered.
    pub answered: u32,
    /// Hours to the first answer, the middle one.
    pub typical_hours: Option<f64>,
}

/// The last 90 days against the 90 before them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Trend {
    pub commits: u32,
    pub commits_before: u32,
    pub people: u32,
    pub people_before: u32,
}

/// The median of a sorted list: its middle, or halfway between its two.
fn middle(sorted: &[f64]) -> Option<f64> {
    let n = sorted.len();
    match (sorted.get(n / 2), n % 2) {
        (Some(&m), 1) => Some(m),
        (Some(&m), _) => sorted.get(n / 2 - 1).map(|&l| (l + m) / 2.0),
        (None, _) => None,
    }
}

impl Analysis<'_> {
    /// The project's health at the Window's end, from all loaded history,
    /// its releases (name, time) and, when known, its issues (opened,
    /// first answered).
    pub fn health(
        &self,
        releases: &[(String, i64)],
        issues: Option<&[(i64, Option<i64>)]>,
    ) -> Health {
        let end = self.window().to;
        let recent = end - RECENT_DAYS * DAY;
        let before = end - 2 * RECENT_DAYS * DAY;
        let year = end - YEAR_DAYS * DAY;

        let mut lately: HashMap<AuthorId, u32> = HashMap::new();
        let mut earlier: HashMap<AuthorId, u32> = HashMap::new();
        let mut in_year: HashMap<AuthorId, u32> = HashMap::new();
        for c in &self.index().commits {
            if c.is_merge() || c.time > end {
                continue;
            }
            let Some(person) = self.person_of(c) else {
                continue;
            };
            if c.time > year {
                *in_year.entry(person).or_default() += 1;
            }
            if c.time > recent {
                *lately.entry(person).or_default() += 1;
            } else if c.time > before {
                *earlier.entry(person).or_default() += 1;
            }
        }

        let mut maintainers: Vec<Maintainer> = lately
            .iter()
            .filter(|(_, &n)| n >= MAINTAINER_COMMITS)
            .map(|(&author, &commits)| Maintainer { author, commits })
            .collect();
        maintainers.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.author.cmp(&b.author)));

        let mut shares: Vec<u32> = in_year.values().copied().collect();
        shares.sort_unstable_by(|a, b| b.cmp(a));
        let total: u32 = shares.iter().sum();
        let bus_factor = (total > 0).then(|| {
            let mut held = 0;
            let mut people = 0;
            for n in shares {
                held += n;
                people += 1;
                if f64::from(held) > BUS_SHARE * f64::from(total) {
                    break;
                }
            }
            people
        });

        let mut times: Vec<i64> = releases
            .iter()
            .map(|(_, t)| *t)
            .filter(|&t| t <= end)
            .collect();
        times.sort_unstable();
        let last_year: Vec<i64> = times.iter().copied().filter(|&t| t > year).collect();
        let mut gaps: Vec<f64> = last_year
            .windows(2)
            .map(|w| match w {
                [a, b] => ((b - a) / DAY) as f64,
                _ => 0.0,
            })
            .collect();
        gaps.sort_by(f64::total_cmp);
        let releases = Releases {
            in_year: last_year.len() as u32,
            typical_gap_days: middle(&gaps).map(|g| g.round() as i64),
            since_last_days: times.last().map(|t| (end - t) / DAY),
        };

        let answers = issues.map(|issues| {
            let mut hours: Vec<f64> = issues
                .iter()
                .filter_map(|&(opened, answered)| answered.map(|a| (a - opened) as f64 / 3600.0))
                .collect();
            hours.sort_by(f64::total_cmp);
            Answers {
                asked: issues.len() as u32,
                answered: hours.len() as u32,
                typical_hours: middle(&hours).map(|h| (h * 10.0).round() / 10.0),
            }
        });

        Health {
            maintainers,
            bus_factor,
            releases,
            answers,
            trend: Trend {
                commits: lately.values().sum(),
                commits_before: earlier.values().sum(),
                people: lately.len() as u32,
                people_before: earlier.len() as u32,
            },
        }
    }
}
