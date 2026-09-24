//! Change Coupling, and the changeset sizes the Bulk Commit threshold is
//! chosen from.

use std::collections::HashMap;

use commitscape_core::FileId;
use serde::Serialize;

use crate::analysis::{counts, top, Analysis};

/// Two files that changed in the same commits.
///
/// `first` and `second` are in path order. The Jaccard degree is symmetric;
/// the two conditional probabilities say which way the dependence runs.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct CoupledPair {
    pub first: FileId,
    pub second: FileId,
    /// Commits in the Window that changed both.
    pub both: u32,
    /// Commits in the Window that changed `first`.
    pub first_commits: u32,
    /// Commits in the Window that changed `second`.
    pub second_commits: u32,
    /// `both` over the commits that changed either.
    pub jaccard: f64,
    /// How often `first` changed when `second` did: `both / second_commits`.
    pub first_given_second: f64,
    /// How often `second` changed when `first` did: `both / first_commits`.
    pub second_given_first: f64,
    /// The two live in different directories, which is where coupling is a
    /// surprise rather than an expectation.
    pub cross_directory: bool,
}

/// Change Coupling over the Window.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Coupling {
    /// The fewest commits a file needed in the Window to be considered.
    pub support: u32,
    /// Files that met it.
    pub files: u32,
    /// Distinct pairs that changed together at least once: the size of the
    /// pair map, before any ranking.
    pub pair_count: u64,
    /// Highest Jaccard degree first, then most shared commits.
    pub pairs: Vec<CoupledPair>,
}

/// How many commits fell in one range of changeset sizes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SizeBucket {
    /// Smallest changeset size in the range.
    pub from: u32,
    /// Largest changeset size in the range; `u32::MAX` for the last.
    pub to: u32,
    pub commits: u32,
}

/// The distribution of changeset sizes over the Window's non-merge commits:
/// what the Bulk Commit threshold is chosen from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChangesetSizes {
    pub commits: u32,
    pub buckets: Vec<SizeBucket>,
    pub median: u32,
    pub p90: u32,
    pub p99: u32,
    pub max: u32,
}

/// The upper bound of each histogram range; each range starts one past the
/// previous bound.
const BOUNDS: [u32; 12] = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, u32::MAX];

impl Analysis<'_> {
    /// Files that change together (ADR-0002's pair map).
    ///
    /// Files people wrote, at HEAD, with at least `coupling_support` commits in
    /// the Window, are counted; every pair a counted commit touched is a
    /// candidate. The support prune comes first, so a large repository's
    /// thousands of rarely-changed files never generate pairs.
    pub fn coupling(&self) -> Coupling {
        let index = self.index();
        let options = self.options();
        let support = options.coupling_support.max(1);

        let mut supported = vec![false; index.paths.len()];
        let mut files = 0u32;
        for h in self.ranked() {
            if self.churn_of(h.file) >= support {
                if let Some(s) = supported.get_mut(h.file.idx()) {
                    *s = true;
                    files += 1;
                }
            }
        }

        let mut together: HashMap<(FileId, FileId), u32> = HashMap::new();
        let mut touched: Vec<FileId> = Vec::new();
        for commit in self.window_commits() {
            if !counts(commit, &options) {
                continue;
            }
            touched.clear();
            touched.extend(
                index
                    .changes_of(commit)
                    .iter()
                    .map(|c| c.file)
                    .filter(|f| supported.get(f.idx()).copied().unwrap_or(false)),
            );
            touched.sort_unstable();
            touched.dedup();
            for (i, &a) in touched.iter().enumerate() {
                for &b in touched.iter().skip(i + 1) {
                    *together.entry((a, b)).or_default() += 1;
                }
            }
        }

        let pair_count = together.len() as u64;
        let mut pairs: Vec<CoupledPair> = together
            .into_iter()
            .map(|((a, b), both)| {
                let (first, second) = match self.by_path(a, b) {
                    std::cmp::Ordering::Greater => (b, a),
                    _ => (a, b),
                };
                let first_commits = self.churn_of(first);
                let second_commits = self.churn_of(second);
                let either = first_commits + second_commits - both;
                CoupledPair {
                    first,
                    second,
                    both,
                    first_commits,
                    second_commits,
                    jaccard: ratio(both, either),
                    first_given_second: ratio(both, second_commits),
                    second_given_first: ratio(both, first_commits),
                    cross_directory: directory(index.paths.path(first))
                        != directory(index.paths.path(second)),
                }
            })
            .collect();
        top(&mut pairs, |a, b| {
            b.jaccard
                .partial_cmp(&a.jaccard)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(b.both.cmp(&a.both))
                .then_with(|| self.by_path(a.first, b.first))
                .then_with(|| self.by_path(a.second, b.second))
        });
        Coupling {
            support,
            files,
            pair_count,
            pairs,
        }
    }

    /// How many files the Window's non-merge commits touched, as a histogram
    /// and a few percentiles.
    pub fn changeset_sizes(&self) -> ChangesetSizes {
        let mut sizes: Vec<u32> = self
            .window_commits()
            .iter()
            .filter(|c| !c.is_merge())
            .map(|c| c.changes_len)
            .collect();
        sizes.sort_unstable();

        let mut buckets = Vec::with_capacity(BOUNDS.len());
        let mut from = 0u32;
        for &to in &BOUNDS {
            let commits = sizes.iter().filter(|&&s| s >= from && s <= to).count() as u32;
            buckets.push(SizeBucket { from, to, commits });
            from = to.saturating_add(1);
        }
        let at = |p: f64| -> u32 {
            // Nearest rank: the smallest size at or above a share p of commits.
            let rank = (p * sizes.len() as f64).ceil() as usize;
            sizes.get(rank.saturating_sub(1)).copied().unwrap_or(0)
        };
        ChangesetSizes {
            commits: sizes.len() as u32,
            buckets,
            median: at(0.5),
            p90: at(0.9),
            p99: at(0.99),
            max: sizes.last().copied().unwrap_or(0),
        }
    }
}

fn ratio(part: u32, whole: u32) -> f64 {
    if whole == 0 {
        0.0
    } else {
        part as f64 / whole as f64
    }
}

/// The directory part of a path, including its final `/`.
fn directory(path: Option<&[u8]>) -> &[u8] {
    let path = path.unwrap_or_default();
    match path.iter().rposition(|&b| b == b'/') {
        Some(i) => path.get(..=i).unwrap_or_default(),
        None => &[],
    }
}

/// The least Jaccard degree for two files to count as moving together in a
/// Change Group.
const GROUP_DEGREE: f64 = 0.5;
/// The most files a Change Group holds.
const GROUP_MOST: usize = 8;

/// Files that change together: every two of them strongly coupled.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChangeGroup {
    /// Most strongly coupled first.
    pub files: Vec<FileId>,
    /// Counted commits in the Window that changed every one of them.
    pub together: u32,
    /// They live in more than one directory.
    pub cross_directory: bool,
}

impl Analysis<'_> {
    /// Sets of files that move together, largest and most often first. A
    /// file joins a group only when it is strongly coupled (a Jaccard degree
    /// of at least a half) with every file already in it, so a chain of
    /// pairs does not become one group.
    pub fn change_groups(&self) -> Vec<ChangeGroup> {
        self.change_groups_in(&self.coupling())
    }

    /// [`change_groups`](Self::change_groups) from Coupling already
    /// computed.
    pub fn change_groups_in(&self, coupling: &Coupling) -> Vec<ChangeGroup> {
        let mut strong: Vec<&CoupledPair> = coupling
            .pairs
            .iter()
            .filter(|p| p.jaccard >= GROUP_DEGREE)
            .collect();
        strong.sort_by(|a, b| b.jaccard.total_cmp(&a.jaccard).then(b.both.cmp(&a.both)));
        let key = |a: FileId, b: FileId| if a < b { (a, b) } else { (b, a) };
        let edges: std::collections::HashSet<(FileId, FileId)> =
            strong.iter().map(|p| key(p.first, p.second)).collect();

        let mut groups: Vec<Vec<FileId>> = Vec::new();
        let mut group_of: std::collections::HashMap<FileId, usize> = Default::default();
        for p in &strong {
            match (
                group_of.get(&p.first).copied(),
                group_of.get(&p.second).copied(),
            ) {
                (None, None) => {
                    group_of.insert(p.first, groups.len());
                    group_of.insert(p.second, groups.len());
                    groups.push(vec![p.first, p.second]);
                }
                (Some(g), None) | (None, Some(g)) => {
                    let new = if group_of.contains_key(&p.first) {
                        p.second
                    } else {
                        p.first
                    };
                    let Some(members) = groups.get_mut(g) else {
                        continue;
                    };
                    if members.len() < GROUP_MOST
                        && members.iter().all(|&m| edges.contains(&key(m, new)))
                    {
                        members.push(new);
                        group_of.insert(new, g);
                    }
                }
                (Some(_), Some(_)) => {}
            }
        }

        let index = self.index();
        let dir = |f: FileId| {
            let path = index.paths.path(f).unwrap_or_default();
            path.iter()
                .rposition(|&b| b == b'/')
                .map_or(&[][..], |i| path.get(..i).unwrap_or_default())
        };
        // Every group's commits in one pass: a commit counts for a group
        // when it touched all of the group's files.
        let options = self.options();
        let mut together = vec![0u32; groups.len()];
        let mut touched: std::collections::HashMap<usize, usize> = Default::default();
        for commit in self.window_commits() {
            if !crate::analysis::counts(commit, &options) {
                continue;
            }
            touched.clear();
            for change in index.changes_of(commit) {
                if let Some(&g) = group_of.get(&change.file) {
                    *touched.entry(g).or_default() += 1;
                }
            }
            for (&g, &n) in &touched {
                if groups.get(g).is_some_and(|files| files.len() == n) {
                    if let Some(t) = together.get_mut(g) {
                        *t += 1;
                    }
                }
            }
        }
        let mut out: Vec<ChangeGroup> = groups
            .into_iter()
            .zip(together)
            .map(|(files, together)| {
                let first = files.first().map(|&f| dir(f));
                let cross_directory = files.iter().any(|&f| Some(dir(f)) != first);
                ChangeGroup {
                    files,
                    together,
                    cross_directory,
                }
            })
            .filter(|g| g.together > 0)
            .collect();
        out.sort_by(|a, b| {
            (b.files.len() as u32 * b.together)
                .cmp(&(a.files.len() as u32 * a.together))
                .then(b.together.cmp(&a.together))
        });
        out
    }
}
