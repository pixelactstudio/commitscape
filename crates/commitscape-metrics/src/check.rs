use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::analysis::{counts, Analysis};
use crate::roles::{is_lockfile, looks_generated};

const LAST: usize = 10;
const ENOUGH: usize = 5;
const NEARLY_ALWAYS: f64 = 0.8;
const FOCUSED: u32 = 20;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Forgotten {
    pub missing: String,
    pub folder: bool,
    pub because: String,
    pub together: u32,
    pub of: u32,
}

fn strength(f: &Forgotten) -> (u32, std::cmp::Reverse<u32>) {
    (f.together, std::cmp::Reverse(f.of))
}

fn folder_of(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..=i])
}

impl Analysis<'_> {
    pub fn forgotten(&self, changed: &[&str]) -> Vec<Forgotten> {
        let index = self.index();
        let at_head: HashSet<_> = index.head.iter().map(|h| h.file).collect();
        let is_changed = |p: &str| changed.contains(&p);
        let under_changed = |dir: &str| changed.iter().any(|c| c.starts_with(dir));
        let noise = |p: &[u8]| is_lockfile(p) || looks_generated(p);
        let folder_at_head = |dir: &str| {
            index.head.iter().any(|h| {
                index
                    .paths
                    .path(h.file)
                    .is_some_and(|p| p.starts_with(dir.as_bytes()))
            })
        };

        let mut best: HashMap<(String, bool), Forgotten> = HashMap::new();
        for &path in changed {
            if noise(path.as_bytes()) {
                continue;
            }
            let Some(file) = index.paths.get(path.as_bytes()) else {
                continue;
            };
            let commits: Vec<_> = self
                .window_commits()
                .iter()
                .rev()
                .filter(|c| counts(c, &self.options()) && c.changes_len <= FOCUSED)
                .filter(|c| index.changes_of(c).iter().any(|ch| ch.file == file))
                .take(LAST)
                .collect();
            let of = commits.len();
            if of < ENOUGH {
                continue;
            }
            let mut files: HashMap<commitscape_core::FileId, u32> = HashMap::new();
            let mut folders: HashMap<String, u32> = HashMap::new();
            for c in &commits {
                let mut seen_folders = HashSet::new();
                for ch in index.changes_of(c) {
                    if ch.file == file {
                        continue;
                    }
                    let Some(other) = index.paths.path(ch.file) else {
                        continue;
                    };
                    if noise(other) {
                        continue;
                    }
                    *files.entry(ch.file).or_default() += 1;
                    let other = String::from_utf8_lossy(other);
                    let dir = folder_of(&other);
                    if seen_folders.insert(dir.to_string()) {
                        *folders.entry(dir.to_string()).or_default() += 1;
                    }
                }
            }
            let strong = |n: u32| f64::from(n) >= NEARLY_ALWAYS * of as f64;
            let mut found: Vec<Forgotten> = Vec::new();
            for (other, n) in files {
                let Some(p) = index.paths.path(other) else {
                    continue;
                };
                let p = String::from_utf8_lossy(p).into_owned();
                if strong(n) && at_head.contains(&other) && !is_changed(&p) {
                    found.push(Forgotten {
                        missing: p,
                        folder: false,
                        because: path.to_string(),
                        together: n,
                        of: of as u32,
                    });
                }
            }
            for (dir, n) in folders {
                if !strong(n)
                    || dir.is_empty()
                    || path.starts_with(&dir)
                    || under_changed(&dir)
                    || !folder_at_head(&dir)
                {
                    continue;
                }
                if found
                    .iter()
                    .any(|f| !f.folder && f.missing.starts_with(&dir))
                {
                    continue;
                }
                found.push(Forgotten {
                    missing: dir,
                    folder: true,
                    because: path.to_string(),
                    together: n,
                    of: of as u32,
                });
            }
            for f in found {
                let key = (f.missing.clone(), f.folder);
                let better = best.get(&key).is_none_or(|b| strength(&f) > strength(b));
                if better {
                    best.insert(key, f);
                }
            }
        }
        let mut out: Vec<Forgotten> = best.into_values().collect();
        out.sort_by(|a, b| {
            strength(b)
                .cmp(&strength(a))
                .then(a.missing.cmp(&b.missing))
        });
        out
    }
}
