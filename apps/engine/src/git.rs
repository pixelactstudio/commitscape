use std::collections::{BTreeMap, HashMap, HashSet};

use commitscape_core::{AuthorId, FileClass, FileId, Index};
use commitscape_report::api::PersonRef;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::languages::{is_binary_path, language_of};
use crate::loaded::LoadedPack;
use crate::view::{compare_text, counts};

pub const GIT_FORMAT: u8 = 1;

pub const FILE_BINARY: u8 = 1;
pub const FILE_STORED: u8 = 2;
pub const FILE_BIG: u8 = 4;
pub const FILE_LINK: u8 = 8;
pub const FILE_BYTES_MAX: u64 = 256 * 1024;

const OWNERS_KEPT: usize = 3;
const COUPLED_KEPT: usize = 6;
const COUPLED_MIN: u32 = 3;
const COUPLED_FILES: usize = 30;
const PAIRS_MAX: usize = 1_500_000;
const PATH_RECENT: usize = 12;
const FOLDER_MAX: usize = 1000;

pub const MONTH: i64 = 2_630_016;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct BlobFacts {
    #[serde(default)]
    pub binary: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TreeOf {
    #[serde(rename = "builtAt")]
    pub built_at: Value,
    pub head: String,
    pub branch: String,
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(rename = "fileBytes", default)]
    pub file_bytes: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GitPerson {
    pub name: String,
    pub login: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GitDir {
    pub path: String,
    pub files: u32,
    pub size: u64,
    pub commits: u32,
    pub last: i64,
    pub owners: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTree {
    pub v: u8,
    pub built_at: Value,
    pub head: String,
    pub branch: String,
    pub logged: u32,
    pub complete: bool,
    pub people: Vec<GitPerson>,
    pub langs: Vec<&'static str>,
    pub paths: Vec<String>,
    pub size: Vec<u64>,
    pub sha: Vec<String>,
    pub lang: Vec<u32>,
    pub flags: Vec<u8>,
    pub lines: Vec<Option<u32>>,
    pub churn: Vec<u32>,
    pub first: Vec<i64>,
    pub last: Vec<i64>,
    pub owners: Vec<Vec<u64>>,
    pub dirs: Vec<GitDir>,
    pub stored: usize,
    pub skipped: u32,
    pub raw: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GitCoupling {
    pub v: u8,
    pub of: BTreeMap<usize, Vec<u64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GitLogPerson {
    pub id: u32,
    pub name: String,
    pub login: Option<String>,
    pub colour: Option<u8>,
    pub bot: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GitLog {
    pub v: u8,
    pub anchor: i64,
    pub people: Vec<GitLogPerson>,
    pub folders: Vec<String>,
    pub folder: Vec<u32>,
    pub names: Vec<String>,
    pub lines: Vec<u32>,
    pub alive: Vec<u8>,
    pub gaps: Vec<i64>,
    pub who: Vec<i64>,
    pub kept: Vec<u8>,
    pub sizes: Vec<u32>,
    pub files: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PathCommit {
    pub sha: String,
    pub at: i64,
    pub offset: i16,
    pub subject: String,
    pub merge: bool,
    pub person: Option<PersonRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Months {
    pub from: i64,
    pub step: i64,
    pub counts: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PathHistory {
    pub path: String,
    pub total: usize,
    pub commits: Vec<PathCommit>,
    pub logged: u32,
    pub complete: bool,
    pub months: Option<Months>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FolderEntryLast {
    pub name: String,
    pub dir: bool,
    pub sha: String,
    pub subject: String,
    pub at: i64,
    pub person: Option<PersonRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FolderLast {
    pub path: String,
    pub entries: Vec<FolderEntryLast>,
}

#[derive(Default)]
struct DirStat {
    commits: u32,
    last: i64,
    owners: HashMap<i64, u32>,
}

struct People<'a> {
    held: &'a LoadedPack,
    list: Vec<GitPerson>,
    at: HashMap<i64, usize>,
}

impl People<'_> {
    fn top(&mut self, counted: &HashMap<i64, u32>) -> Vec<u64> {
        let mut rows: Vec<(i64, u32)> = counted.iter().map(|(&k, &v)| (k, v)).collect();
        rows.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        rows.truncate(OWNERS_KEPT);
        let mut out = Vec::with_capacity(rows.len() * 2);
        for (who, count) in rows {
            let next = self.list.len();
            let at = *self.at.entry(who).or_insert(next);
            if at == next {
                self.list.push(git_person(self.held, who));
            }
            out.push(at as u64);
            out.push(u64::from(count));
        }
        out
    }
}

fn git_person(held: &LoadedPack, who: i64) -> GitPerson {
    let known = u32::try_from(who)
        .ok()
        .map(AuthorId)
        .filter(|&id| held.pack.index.authors.get(id).is_some());
    match known {
        Some(id) => {
            let p = held.person(id);
            GitPerson {
                name: p.name,
                login: p.login,
            }
        }
        None => GitPerson {
            name: "someone unknown".to_string(),
            login: None,
        },
    }
}

fn ancestors(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/')
        .filter_map(move |(at, _)| path.get(..at + 1))
}

fn bump(counted: &mut HashMap<i64, u32>, who: i64) {
    *counted.entry(who).or_insert(0) += 1;
}

fn who_of(index: &Index, c: &commitscape_core::CommitMeta) -> i64 {
    index.author_of(c).map_or(-1, |p| i64::from(p.0))
}

/// The Code window's tree as `gitTree` built it from a Stored Index: every file at HEAD with its size, language and Churn, and the same for every folder.
pub fn tree(held: &LoadedPack, blobs: &BTreeMap<String, BlobFacts>, of: &TreeOf) -> GitTree {
    let pack = &held.pack;
    let index = &pack.index;
    let view = held.view();
    let paths = &view.sorted;
    let n = view.order.len();
    let mut at: HashMap<FileId, usize> = HashMap::with_capacity(n);
    for (i, &h) in view.order.iter().enumerate() {
        if let Some(f) = index.head.get(h) {
            at.insert(f.file, i);
        }
    }
    let mut churn = vec![0u32; n];
    let mut owners: Vec<HashMap<i64, u32>> = vec![HashMap::new(); n];
    let mut dir_stats: HashMap<&str, DirStat> = HashMap::new();
    let mut logged = 0u32;
    let mut seen: HashSet<&str> = HashSet::new();
    for c in index.commits.iter() {
        if c.is_merge() {
            continue;
        }
        logged += 1;
        if !counts(&pack.options, c) {
            continue;
        }
        let who = who_of(index, c);
        seen.clear();
        for ch in index.changes_of(c) {
            let Some(&k) = at.get(&ch.file) else {
                continue;
            };
            if let Some(n) = churn.get_mut(k) {
                *n += 1;
            }
            if let Some(o) = owners.get_mut(k) {
                bump(o, who);
            }
            let path = paths.get(k).map_or("", String::as_str);
            seen.insert("");
            seen.extend(ancestors(path));
        }
        for &d in &seen {
            let e = dir_stats.entry(d).or_default();
            e.commits += 1;
            e.last = e.last.max(c.time);
            bump(&mut e.owners, who);
        }
    }
    let mut people = People {
        held,
        list: Vec::new(),
        at: HashMap::new(),
    };
    let owners: Vec<Vec<u64>> = owners.iter().map(|o| people.top(o)).collect();
    let file_bytes = of.file_bytes.unwrap_or(FILE_BYTES_MAX as f64);
    let mut langs: Vec<&'static str> = Vec::new();
    let mut lang_at: HashMap<&'static str, u32> = HashMap::new();
    let mut folders: HashMap<String, GitDir> = HashMap::new();
    let mut stored: HashSet<commitscape_core::Oid> = HashSet::new();
    let mut skipped = 0u32;
    let mut size = Vec::with_capacity(n);
    let mut sha = Vec::with_capacity(n);
    let mut lang = Vec::with_capacity(n);
    let mut flags_of = Vec::with_capacity(n);
    let mut lines_of = Vec::with_capacity(n);
    let mut first = Vec::with_capacity(n);
    let mut last = Vec::with_capacity(n);
    for (i, &h) in view.order.iter().enumerate() {
        let Some(head) = index.head.get(h) else {
            continue;
        };
        let path = paths.get(i).map_or("", String::as_str);
        let language = language_of(path);
        let li = *lang_at.entry(language).or_insert_with(|| {
            langs.push(language);
            (langs.len() - 1) as u32
        });
        let blob = head.blob.to_hex();
        let mut flags = if head.class == FileClass::Symlink {
            FILE_LINK
        } else {
            0
        };
        let mut lines = None;
        if head.class == FileClass::Binary
            || is_binary_path(path)
            || blobs.get(&blob).is_some_and(|b| b.binary)
        {
            flags |= FILE_BINARY;
        } else {
            lines = Some(head.loc);
            if head.bytes as f64 > file_bytes {
                flags |= FILE_BIG;
            } else {
                flags |= FILE_STORED;
                stored.insert(head.blob);
            }
        }
        if flags & FILE_BIG != 0 {
            skipped += 1;
        }
        size.push(head.bytes);
        sha.push(blob);
        lang.push(li);
        flags_of.push(flags);
        lines_of.push(lines);
        let history = index.history_of(head.file);
        first.push(history.map_or(0, |h| h.first_seen));
        last.push(history.map_or(0, |h| h.last_touched));
        for dir in std::iter::once("").chain(ancestors(path)) {
            let d = folders.entry(dir.to_string()).or_insert_with(|| {
                let s = dir_stats.get(dir);
                GitDir {
                    path: dir.to_string(),
                    files: 0,
                    size: 0,
                    commits: s.map_or(0, |s| s.commits),
                    last: s.map_or(0, |s| s.last),
                    owners: s.map_or(Vec::new(), |s| people.top(&s.owners)),
                }
            });
            d.files += 1;
            d.size += head.bytes;
        }
    }
    let mut dirs: Vec<GitDir> = folders.into_values().collect();
    dirs.sort_by(|a, b| compare_text(&a.path, &b.path));
    GitTree {
        v: GIT_FORMAT,
        built_at: of.built_at.clone(),
        head: of.head.clone(),
        branch: of.branch.clone(),
        logged,
        complete: true,
        people: people.list,
        langs,
        paths: paths.clone(),
        size,
        sha,
        lang,
        flags: flags_of,
        lines: lines_of,
        churn,
        first,
        last,
        owners,
        dirs,
        stored: stored.len(),
        skipped,
        raw: of.raw.clone(),
    }
}

fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// The files each file at HEAD changes with, as `gitCoupling` found them: its tree position, how often together and a Jaccard degree in thousandths, from commits of a few files that count.
pub fn coupling(held: &LoadedPack) -> GitCoupling {
    let pack = &held.pack;
    let index = &pack.index;
    let view = held.view();
    let n = view.order.len();
    let mut at: HashMap<FileId, usize> = HashMap::with_capacity(n);
    for (i, &h) in view.order.iter().enumerate() {
        if let Some(f) = index.head.get(h) {
            at.insert(f.file, i);
        }
    }
    let mut churn = vec![0u64; n];
    let mut pairs: HashMap<u64, u32> = HashMap::new();
    let mut touched: Vec<usize> = Vec::new();
    for c in index.commits.iter() {
        if !counts(&pack.options, c) {
            continue;
        }
        touched.clear();
        touched.extend(
            index
                .changes_of(c)
                .iter()
                .filter_map(|ch| at.get(&ch.file).copied()),
        );
        touched.sort_unstable();
        touched.dedup();
        for &k in &touched {
            if let Some(x) = churn.get_mut(k) {
                *x += 1;
            }
        }
        if touched.len() < 2 || touched.len() > COUPLED_FILES {
            continue;
        }
        for (i, &a) in touched.iter().enumerate() {
            for &b in touched.iter().skip(i + 1) {
                let key = a as u64 * n as u64 + b as u64;
                let room = pairs.len() < PAIRS_MAX;
                match pairs.get_mut(&key) {
                    Some(had) => *had += 1,
                    None if room => {
                        pairs.insert(key, 1);
                    }
                    None => {}
                }
            }
        }
    }
    let mut near: HashMap<usize, Vec<[u64; 3]>> = HashMap::new();
    for (&key, &together) in &pairs {
        if together < COUPLED_MIN {
            continue;
        }
        let a = (key / n as u64) as usize;
        let b = (key % n as u64) as usize;
        let union = (churn.get(a).copied().unwrap_or(0) + churn.get(b).copied().unwrap_or(0))
            .saturating_sub(u64::from(together));
        if union == 0 {
            continue;
        }
        let degree = js_round(f64::from(together) * 1000.0 / union as f64) as u64;
        near.entry(a)
            .or_default()
            .push([b as u64, u64::from(together), degree]);
        near.entry(b)
            .or_default()
            .push([a as u64, u64::from(together), degree]);
    }
    let of = near
        .into_iter()
        .map(|(i, mut rows)| {
            rows.sort_by(|x, y| y[2].cmp(&x[2]).then(y[1].cmp(&x[1])).then(x[0].cmp(&y[0])));
            rows.truncate(COUPLED_KEPT);
            (i, rows.into_iter().flatten().collect())
        })
        .collect();
    GitCoupling { v: GIT_FORMAT, of }
}

/// The whole history as columns for the Universe to replay, as `gitLog` wrote it: Merge Commits left out, every path the history had, and whether each commit counts.
pub fn log(held: &LoadedPack) -> GitLog {
    let pack = &held.pack;
    let index = &pack.index;
    let view = held.view();
    let used = index.authors.used();
    let mut persons: Vec<(u32, AuthorId)> = index
        .authors
        .iter()
        .map(|(id, a)| {
            let commits = a
                .signatures
                .iter()
                .map(|s| used.get(s.idx()).copied().unwrap_or(0))
                .sum();
            (commits, id)
        })
        .collect();
    persons.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let person_at: HashMap<AuthorId, i64> = persons
        .iter()
        .enumerate()
        .map(|(i, &(_, id))| (id, i as i64))
        .collect();
    let mut out = GitLog {
        v: GIT_FORMAT,
        anchor: pack.anchor,
        people: persons
            .iter()
            .map(|&(_, id)| {
                let p = held.person(id);
                GitLogPerson {
                    id: id.0,
                    name: p.name,
                    login: p.login,
                    colour: p.colour,
                    bot: index.authors.is_bot(id),
                }
            })
            .collect(),
        folders: Vec::new(),
        folder: Vec::new(),
        names: Vec::new(),
        lines: Vec::new(),
        alive: Vec::new(),
        gaps: Vec::new(),
        who: Vec::new(),
        kept: Vec::new(),
        sizes: Vec::new(),
        files: Vec::with_capacity(index.changes.len()),
    };
    let mut used_at: HashMap<FileId, u32> = HashMap::new();
    let mut folder_at: HashMap<String, u32> = HashMap::new();
    let mut file_at = |out: &mut GitLog, f: FileId| -> u32 {
        if let Some(&i) = used_at.get(&f) {
            return i;
        }
        let i = out.names.len() as u32;
        used_at.insert(f, i);
        let path = view.path(f);
        let (dir, name) = match path.rfind('/') {
            Some(cut) => (
                path.get(..cut + 1).unwrap_or(""),
                path.get(cut + 1..).unwrap_or(""),
            ),
            None => ("", path),
        };
        let d = match folder_at.get(dir) {
            Some(&d) => d,
            None => {
                let d = out.folders.len() as u32;
                out.folders.push(dir.to_string());
                folder_at.insert(dir.to_string(), d);
                d
            }
        };
        out.folder.push(d);
        out.names.push(name.to_string());
        let head = view.head(index, f);
        out.lines.push(head.map_or(0, |h| h.loc));
        out.alive.push(u8::from(head.is_some()));
        i
    };
    for h in &index.head {
        file_at(&mut out, h.file);
    }
    let mut before = 0i64;
    for c in index.commits.iter() {
        if c.is_merge() {
            continue;
        }
        out.gaps.push(c.time - before);
        before = c.time;
        out.who.push(
            index
                .author_of(c)
                .and_then(|a| person_at.get(&a).copied())
                .unwrap_or(-1),
        );
        out.kept.push(u8::from(counts(&pack.options, c)));
        out.sizes.push(c.changes_len);
        for ch in index.changes_of(c) {
            let i = file_at(&mut out, ch.file);
            out.files.push(i);
        }
    }
    out
}

/// How many of some commits fell in each month, from the first of them up to `until`, oldest month first.
pub fn months_of(index: &Index, commits: &[u32], until: i64) -> Option<Months> {
    let time = |c: u32| index.commits.get(c as usize).map(|m| m.time);
    let first = commits.iter().filter_map(|&c| time(c)).min()?;
    let span = until.max(first) - first;
    let months = ((span + MONTH - 1) / MONTH).max(1);
    let mut counts = vec![0u32; months as usize];
    for &c in commits {
        let t = time(c).unwrap_or(first);
        let m = ((t - first).div_euclid(MONTH)).clamp(0, months - 1);
        if let Some(n) = counts.get_mut(m as usize) {
            *n += 1;
        }
    }
    Some(Months {
        from: first,
        step: MONTH,
        counts,
    })
}

/// How often and how recently a file or folder changed, as `pathHistory` answered: its commits by month, and its newest commits with their subjects and who made them.
pub fn path_history(held: &LoadedPack, path: &str) -> PathHistory {
    let pack = &held.pack;
    let index = &pack.index;
    let commits = held.under(path);
    let list = commits
        .iter()
        .take(PATH_RECENT)
        .filter_map(|&c| index.commits.get(c as usize))
        .map(|c| PathCommit {
            sha: c.id.to_hex(),
            at: c.time,
            offset: c.offset_minutes,
            subject: index.subject_of(c).to_string(),
            merge: false,
            person: index.author_of(c).map(|p| held.person(p)),
        })
        .collect();
    let logged = index.commits.iter().filter(|c| !c.is_merge()).count() as u32;
    let until = pack.anchor.max(index.commits.last().map_or(0, |c| c.time));
    PathHistory {
        path: path.to_string(),
        total: commits.len(),
        commits: list,
        logged,
        complete: true,
        months: months_of(index, &commits, until),
    }
}

/// For each file and folder right inside a folder at HEAD, the newest commit that touched it, Merge Commits left out, newest found first.
pub fn last_in_folder(held: &LoadedPack, path: &str) -> Vec<(String, usize)> {
    let index = &held.pack.index;
    let view = held.view();
    let mut inside: HashMap<FileId, String> = HashMap::new();
    for h in &index.head {
        let Some(rest) = view.path(h.file).strip_prefix(path) else {
            continue;
        };
        let name = match rest.find('/') {
            Some(cut) => rest.get(..cut + 1).unwrap_or(rest),
            None => rest,
        };
        inside.insert(h.file, name.to_string());
    }
    let names: HashSet<&str> = inside.values().map(String::as_str).collect();
    let mut found: Vec<(String, usize)> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for (at, c) in index.commits.iter().enumerate().rev() {
        if seen.len() >= names.len() {
            break;
        }
        if c.is_merge() {
            continue;
        }
        for ch in index.changes_of(c) {
            if let Some(name) = inside.get(&ch.file) {
                if seen.insert(name.as_str()) {
                    found.push((name.clone(), at));
                }
            }
        }
    }
    found
}

/// For each file and folder right inside a folder, the newest commit that touched it with its subject and who made it, as `folderLast` answered.
pub fn folder_last(held: &LoadedPack, path: &str) -> FolderLast {
    let index = &held.pack.index;
    let entries = last_in_folder(held, path)
        .into_iter()
        .take(FOLDER_MAX)
        .filter_map(|(entry, at)| {
            let c = index.commits.get(at)?;
            let dir = entry.ends_with('/');
            let name = entry.strip_suffix('/').unwrap_or(&entry).to_string();
            Some(FolderEntryLast {
                name,
                dir,
                sha: c.id.to_hex(),
                subject: index.subject_of(c).to_string(),
                at: c.time,
                person: index.author_of(c).map(|p| held.person(p)),
            })
        })
        .collect();
    FolderLast {
        path: path.to_string(),
        entries,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_is_javascripts() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(2.4999), 2.0);
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(333.3333), 333.0);
    }

    #[test]
    fn ancestors_are_every_folder_a_path_is_in() {
        assert_eq!(
            ancestors("a/b/c.rs").collect::<Vec<_>>(),
            vec!["a/", "a/b/"]
        );
        assert_eq!(ancestors("c.rs").count(), 0);
    }
}
