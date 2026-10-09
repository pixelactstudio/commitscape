use std::collections::HashMap;

use commitscape_core::FileId;
use serde::Serialize;

use crate::analysis::{counts, top, Analysis};

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct CoupledPair {
    pub first: FileId,
    pub second: FileId,
    pub both: u32,
    pub first_commits: u32,
    pub second_commits: u32,
    pub jaccard: f64,
    pub first_given_second: f64,
    pub second_given_first: f64,
    pub cross_directory: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Coupling {
    pub support: u32,
    pub files: u32,
    pub pair_count: u64,
    pub pairs: Vec<CoupledPair>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SizeBucket {
    pub from: u32,
    pub to: u32,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChangesetSizes {
    pub commits: u32,
    pub buckets: Vec<SizeBucket>,
    pub median: u32,
    pub p90: u32,
    pub p99: u32,
    pub max: u32,
}

const BOUNDS: [u32; 12] = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, u32::MAX];

impl Analysis<'_> {
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

fn directory(path: Option<&[u8]>) -> &[u8] {
    let path = path.unwrap_or_default();
    match path.iter().rposition(|&b| b == b'/') {
        Some(i) => path.get(..=i).unwrap_or_default(),
        None => &[],
    }
}
