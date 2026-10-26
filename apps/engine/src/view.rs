use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use commitscape_core::{AuthorId, CommitKind, CommitMeta, FileId, HeadFile, Index};
use commitscape_metrics::Options;
use commitscape_report::pack::Pack;

pub const DAY: i64 = 86_400;

pub const OTHER: u8 = 10;

const REACHABLE: u8 = 8;

const MAINTAINER_DAYS: i64 = 90;

const MAINTAINER_COMMITS: u32 = 3;

pub struct View {
    paths: Vec<String>,
    pub order: Vec<usize>,
    pub sorted: Vec<String>,
    head_of: HashMap<FileId, usize>,
    by_path: HashMap<String, FileId>,
    pub mainline: bool,
    pub maintainers: HashSet<AuthorId>,
}

/// Compares two strings as JavaScript does, by UTF-16 code unit.
pub fn compare_text(a: &str, b: &str) -> Ordering {
    commitscape_metrics::compare_text(a.as_bytes(), b.as_bytes())
}

/// The first position at or after `prefix`, and one past the last under it, in paths sorted by `compare_text`.
pub fn range_of(paths: &[String], prefix: &str) -> (usize, usize) {
    let first = |key: &str| paths.partition_point(|p| compare_text(p, key) == Ordering::Less);
    let upper = format!("{prefix}\u{ffff}");
    (first(prefix), first(&upper))
}

/// Whether a commit counts: not a Merge Commit and not a Bulk Commit.
pub fn counts(options: &Options, c: &CommitMeta) -> bool {
    !c.is_merge() && !options.is_bulk(c)
}

/// A commit's Commit Kind as the Stored Index numbers it.
pub fn kind_code(c: &CommitMeta) -> u8 {
    CommitKind::EVERY
        .iter()
        .position(|k| *k == c.kind)
        .unwrap_or(0) as u8
}

/// Who made a commit, unless it was a Bot.
pub fn person_of(index: &Index, c: &CommitMeta) -> Option<AuthorId> {
    index.author_of(c).filter(|p| !index.authors.is_bot(*p))
}

/// The lines a change added and removed as the Stored Index reads them: zero when not counted.
pub fn lines_of(index: &Index, c: &CommitMeta, wanted: impl Fn(FileId) -> bool) -> (u64, u64) {
    index
        .changes_of(c)
        .iter()
        .filter(|ch| wanted(ch.file))
        .filter_map(|ch| ch.lines)
        .fold((0, 0), |(a, r), l| {
            (a + u64::from(l.added), r + u64::from(l.removed))
        })
}

impl View {
    /// What the Site's in-memory view of a Stored Index held beside its columns: paths by file, HEAD sorted by path, files by path, whether the Mainline is known and who the Maintainers are.
    pub fn of(pack: &Pack) -> View {
        let index = &pack.index;
        let paths: Vec<String> = (0..index.paths.len())
            .map(|i| index.paths.path_lossy(FileId(i as u32)))
            .collect();
        let named = |f: FileId| paths.get(f.idx()).map_or("", String::as_str);
        let mut order: Vec<usize> = (0..index.head.len()).collect();
        order.sort_by(|&a, &b| {
            let path = |h: usize| index.head.get(h).map_or("", |f| named(f.file));
            compare_text(path(a), path(b))
        });
        let sorted = order
            .iter()
            .map(|&h| {
                index
                    .head
                    .get(h)
                    .map_or(String::new(), |f| named(f.file).to_string())
            })
            .collect();
        let head_of = index
            .head
            .iter()
            .enumerate()
            .map(|(at, h)| (h.file, at))
            .collect();
        let by_path = paths
            .iter()
            .enumerate()
            .map(|(i, p)| (p.clone(), FileId(i as u32)))
            .collect();
        let mainline = pack.mainline.iter().any(|b| b & REACHABLE != 0);
        View {
            maintainers: maintainers(index, pack.anchor),
            paths,
            order,
            sorted,
            head_of,
            by_path,
            mainline,
        }
    }

    /// A file's path now, or the path it had when it was deleted.
    pub fn path(&self, file: FileId) -> &str {
        self.paths.get(file.idx()).map_or("", String::as_str)
    }

    /// The file whose path is `path`, the newest when more than one had it.
    pub fn file_named(&self, path: &str) -> Option<FileId> {
        self.by_path.get(path).copied()
    }

    /// A file as HEAD has it, if HEAD has it.
    pub fn head<'a>(&self, index: &'a Index, file: FileId) -> Option<&'a HeadFile> {
        self.head_of.get(&file).and_then(|&at| index.head.get(at))
    }

    /// The files at HEAD that are a path, or are in a folder and everything in it, by path.
    pub fn files_under(&self, index: &Index, path: &str) -> Vec<FileId> {
        let (lo, hi) = if path.is_empty() || path.ends_with('/') {
            range_of(&self.sorted, path)
        } else {
            match self.sorted.iter().position(|p| p == path) {
                Some(at) => (at, at + 1),
                None => return Vec::new(),
            }
        };
        (lo..hi)
            .filter_map(|i| self.order.get(i).and_then(|&h| index.head.get(h)))
            .map(|h| h.file)
            .collect()
    }

    /// The commits that touched a file at HEAD, or a folder and everything in it, newest first, Merge Commits left out.
    pub fn commits_under(&self, index: &Index, path: &str) -> Vec<u32> {
        let files = self.files_under(index, path);
        if files.is_empty() {
            return Vec::new();
        }
        let mut wanted = vec![false; index.paths.len()];
        for f in files {
            if let Some(w) = wanted.get_mut(f.idx()) {
                *w = true;
            }
        }
        index
            .commits
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, c)| !c.is_merge())
            .filter(|(_, c)| {
                index
                    .changes_of(c)
                    .iter()
                    .any(|ch| wanted.get(ch.file.idx()).copied().unwrap_or(false))
            })
            .map(|(at, _)| at as u32)
            .collect()
    }
}

fn maintainers(index: &Index, anchor: i64) -> HashSet<AuthorId> {
    let since = anchor - MAINTAINER_DAYS * DAY;
    let mut made: HashMap<AuthorId, u32> = HashMap::new();
    for c in index.commits.iter().rev() {
        if c.time <= since {
            break;
        }
        if c.is_merge() || c.time > anchor {
            continue;
        }
        if let Some(p) = person_of(index, c) {
            *made.entry(p).or_insert(0) += 1;
        }
    }
    made.into_iter()
        .filter(|&(_, n)| n >= MAINTAINER_COMMITS)
        .map(|(p, _)| p)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_range_holds_everything_under_a_prefix() {
        let paths: Vec<String> = ["a.txt", "src/a.rs", "src/b/c.rs", "srcs/x", "z"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(range_of(&paths, "src/"), (1, 3));
        assert_eq!(range_of(&paths, ""), (0, 5));
        assert_eq!(range_of(&paths, "nowhere/"), (1, 1));
        assert_eq!(range_of(&paths, "zz/"), (5, 5));
    }
}
