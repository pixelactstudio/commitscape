use std::collections::{BTreeMap, HashMap, HashSet};

use commitscape_core::{civil_from_unix, AuthorId, CommitMeta, FileClass, FileId};
use commitscape_report::api::PersonRef;
use serde::Serialize;

use crate::git::{FILE_BIG, FILE_BINARY, FILE_BYTES_MAX, FILE_LINK, FILE_STORED};
use crate::languages::{is_binary_path, language_of};
use crate::loaded::LoadedPack;
use crate::pulls::pull_of;
use crate::view::{compare_text, counts, kind_code, lines_of, person_of, OTHER};

pub const CODE_LOG_PAGE: usize = 50;

const FIXES: u8 = 1;
const HOLDERS: usize = 5;
const YEAR_OWNERS: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CodeFile {
    pub sha: String,
    pub bytes: u64,
    pub lines: u32,
    pub class: &'static str,
    pub lang: &'static str,
    pub flags: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CodeMoment {
    pub at: i64,
    pub sha: String,
    pub subject: String,
    pub person: Option<PersonRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CodeHolder {
    pub person: PersonRef,
    pub commits: u32,
    pub share: f64,
    pub maintainer: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct YearOwner {
    pub person: PersonRef,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CodeYear {
    pub year: i64,
    pub commits: u32,
    pub added: Option<u64>,
    pub removed: Option<u64>,
    pub owners: Vec<YearOwner>,
    pub others: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeStory {
    pub path: String,
    pub kind: &'static str,
    pub anchor: i64,
    pub file: Option<CodeFile>,
    pub files: usize,
    pub bytes: u64,
    pub lines: u64,
    pub commits: usize,
    pub counted: u32,
    pub people: usize,
    pub born: Option<CodeMoment>,
    pub last: Option<CodeMoment>,
    pub holders: Vec<CodeHolder>,
    pub bus_factor: Option<usize>,
    pub fixes: u32,
    pub classified: u32,
    pub years: Vec<CodeYear>,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CodePull {
    pub number: u32,
    pub title: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CodeCommit {
    pub sha: String,
    pub at: i64,
    pub offset: i16,
    pub subject: String,
    pub person: Option<PersonRef>,
    pub added: Option<u64>,
    pub removed: Option<u64>,
    pub kind: u8,
    pub bulk: bool,
    pub pull: Option<CodePull>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CodeLog {
    pub path: String,
    pub total: usize,
    pub page: u32,
    pub pages: usize,
    pub commits: Vec<CodeCommit>,
}

struct Wanted {
    kind: &'static str,
    files: Vec<FileId>,
    mask: Vec<bool>,
}

impl Wanted {
    fn has(&self, file: FileId) -> bool {
        self.mask.get(file.idx()).copied().unwrap_or(false)
    }
}

fn wanted(held: &LoadedPack, path: &str) -> Wanted {
    let index = &held.pack.index;
    let view = held.view();
    let (kind, files) = if path.is_empty() || path.ends_with('/') {
        let files = view.files_under(index, path);
        (
            if files.is_empty() {
                "missing"
            } else {
                "folder"
            },
            files,
        )
    } else {
        match view.file_named(path) {
            Some(f) if view.head(index, f).is_some() => ("file", vec![f]),
            _ => ("missing", Vec::new()),
        }
    };
    let mut mask = vec![false; index.paths.len()];
    for f in &files {
        if let Some(m) = mask.get_mut(f.idx()) {
            *m = true;
        }
    }
    Wanted { kind, files, mask }
}

fn class_label(class: FileClass) -> &'static str {
    match class {
        FileClass::Source => "source",
        FileClass::Prose => "prose",
        FileClass::Generated => "generated",
        FileClass::Vendored => "vendored",
        FileClass::Binary => "binary",
        FileClass::Symlink => "symlink",
    }
}

fn moment(held: &LoadedPack, c: &CommitMeta) -> CodeMoment {
    CodeMoment {
        at: c.time,
        sha: c.id.to_hex(),
        subject: String::new(),
        person: held.pack.index.author_of(c).map(|p| held.person(p)),
    }
}

fn bus_factor(owners: &[u32], total: u32) -> Option<usize> {
    if total == 0 {
        return None;
    }
    let mut held = 0u64;
    let mut n = 0;
    for &commits in owners {
        held += u64::from(commits);
        n += 1;
        if held as f64 > 0.8 * f64::from(total) {
            break;
        }
    }
    Some(n)
}

fn ranked(counted: &HashMap<AuthorId, u32>) -> Vec<(AuthorId, u32)> {
    let mut rows: Vec<(AuthorId, u32)> = counted.iter().map(|(&k, &v)| (k, v)).collect();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    rows
}

#[derive(Default)]
struct Year {
    commits: u32,
    added: u64,
    removed: u64,
    owners: HashMap<AuthorId, u32>,
    counted: u32,
}

/// A file's or folder's story, as `storyOf` told it and `codeStory` read the other paths a file had: what it is at HEAD, its commits and people, when it was born and last changed, who holds it and whether they are still a Maintainer, its share of fixes and its years.
pub fn story(held: &LoadedPack, path: &str) -> CodeStory {
    let pack = &held.pack;
    let index = &pack.index;
    let view = held.view();
    let want = wanted(held, path);
    let commits = if want.kind == "missing" {
        Default::default()
    } else {
        held.under(path)
    };
    let mut bytes = 0u64;
    let mut lines = 0u64;
    for &f in &want.files {
        let h = view.head(index, f);
        bytes += h.map_or(0, |h| h.bytes);
        lines += h
            .filter(|h| h.class != FileClass::Binary)
            .map_or(0, |h| u64::from(h.loc));
    }
    let head = if want.kind == "file" {
        want.files.first().and_then(|&f| view.head(index, f))
    } else {
        None
    };
    let file = head.map(|h| {
        let binary = h.class == FileClass::Binary || is_binary_path(path);
        let link = if h.class == FileClass::Symlink {
            FILE_LINK
        } else {
            0
        };
        let kind = if binary {
            FILE_BINARY
        } else if h.bytes > FILE_BYTES_MAX {
            FILE_BIG
        } else {
            FILE_STORED
        };
        CodeFile {
            sha: h.blob.to_hex(),
            bytes: h.bytes,
            lines: if binary { 0 } else { h.loc },
            class: class_label(h.class),
            lang: language_of(path),
            flags: link | kind,
        }
    });
    let mut people: HashSet<AuthorId> = HashSet::new();
    let mut owners: HashMap<AuthorId, u32> = HashMap::new();
    let mut years: BTreeMap<i64, Year> = BTreeMap::new();
    let (mut counted, mut fixes, mut classified) = (0u32, 0u32, 0u32);
    for c in commits
        .iter()
        .filter_map(|&c| index.commits.get(c as usize))
    {
        let p = person_of(index, c);
        if let Some(p) = p {
            people.insert(p);
        }
        let y = years.entry(civil_from_unix(c.time).0).or_default();
        y.commits += 1;
        let (added, removed) = lines_of(index, c, |f| want.has(f));
        y.added += added;
        y.removed += removed;
        if !counts(&pack.options, c) {
            continue;
        }
        counted += 1;
        y.counted += 1;
        let kind = kind_code(c);
        if kind != OTHER {
            classified += 1;
        }
        if kind == FIXES {
            fixes += 1;
        }
        let Some(who) = p else {
            continue;
        };
        *owners.entry(who).or_insert(0) += 1;
        *y.owners.entry(who).or_insert(0) += 1;
    }
    let ranked_owners = ranked(&owners);
    let holders = ranked_owners
        .iter()
        .take(HOLDERS)
        .map(|&(who, n)| CodeHolder {
            person: held.person(who),
            commits: n,
            share: if counted > 0 {
                f64::from(n) / f64::from(counted)
            } else {
                0.0
            },
            maintainer: view.maintainers.contains(&who),
        })
        .collect();
    let lines_shown = pack.lines_mainline;
    let years = years
        .into_iter()
        .map(|(year, y)| {
            let mut top = ranked(&y.owners);
            top.truncate(YEAR_OWNERS);
            let shown: u32 = top.iter().map(|&(_, k)| k).sum();
            CodeYear {
                year,
                commits: y.commits,
                added: lines_shown.then_some(y.added),
                removed: lines_shown.then_some(y.removed),
                owners: top
                    .into_iter()
                    .map(|(who, k)| YearOwner {
                        person: held.person(who),
                        commits: k,
                    })
                    .collect(),
                others: y.counted.saturating_sub(shown),
            }
        })
        .collect();
    let at = |c: Option<&u32>| c.and_then(|&c| index.commits.get(c as usize));
    let paths = if want.kind == "file" {
        other_paths(held, want.files.first().copied(), path)
    } else {
        Vec::new()
    };
    CodeStory {
        path: path.to_string(),
        kind: want.kind,
        anchor: pack.anchor,
        file,
        files: want.files.len(),
        bytes,
        lines,
        commits: commits.len(),
        counted,
        people: people.len(),
        born: at(commits.last()).map(|c| moment(held, c)),
        last: at(commits.first()).map(|c| moment(held, c)),
        holders,
        bus_factor: if want.kind == "folder" {
            bus_factor(
                &ranked_owners.iter().map(|&(_, n)| n).collect::<Vec<_>>(),
                counted,
            )
        } else {
            None
        },
        fixes,
        classified,
        years,
        paths,
    }
}

fn other_paths(held: &LoadedPack, file: Option<FileId>, path: &str) -> Vec<String> {
    let Some(file) = file else {
        return Vec::new();
    };
    let mut paths: Vec<String> = held
        .pack
        .index
        .paths
        .departures()
        .filter(|&(f, _)| f == file)
        .map(|(_, p)| String::from_utf8_lossy(p).into_owned())
        .filter(|p| p != path)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    paths.sort_by(|a, b| compare_text(a, b));
    paths
}

/// One page of every commit that touched a file or folder at HEAD, newest first, merges left out, as `codeLog` answered before it looked up pull requests: each commit's lines there, its kind, and the pull request its subject names, with no title or state.
pub fn code_log(held: &LoadedPack, path: &str, page: u32) -> CodeLog {
    let pack = &held.pack;
    let index = &pack.index;
    let want = wanted(held, path);
    let all = if want.kind == "missing" {
        Default::default()
    } else {
        held.under(path)
    };
    let pages = all.len().div_ceil(CODE_LOG_PAGE).max(1);
    let from = (page as usize).saturating_sub(1) * CODE_LOG_PAGE;
    let commits = all
        .iter()
        .skip(from)
        .take(CODE_LOG_PAGE)
        .filter_map(|&c| index.commits.get(c as usize))
        .map(|c| {
            let (added, removed) = lines_of(index, c, |f| want.has(f));
            let subject = index.subject_of(c);
            CodeCommit {
                sha: c.id.to_hex(),
                at: c.time,
                offset: c.offset_minutes,
                subject: subject.to_string(),
                person: index.author_of(c).map(|p| held.person(p)),
                added: pack.lines_mainline.then_some(added),
                removed: pack.lines_mainline.then_some(removed),
                kind: kind_code(c),
                bulk: !counts(&pack.options, c),
                pull: pull_of(subject).map(|number| CodePull {
                    number,
                    title: None,
                    state: None,
                }),
            }
        })
        .collect();
    CodeLog {
        path: path.to_string(),
        total: all.len(),
        page,
        pages,
        commits,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bus_factor_is_the_fewest_who_hold_more_than_four_fifths() {
        assert_eq!(bus_factor(&[8, 2], 10), Some(2));
        assert_eq!(bus_factor(&[9, 1], 10), Some(1));
        assert_eq!(bus_factor(&[81, 19], 100), Some(1));
        assert_eq!(bus_factor(&[6, 3, 1], 10), Some(2));
        assert_eq!(bus_factor(&[], 0), None);
    }
}
