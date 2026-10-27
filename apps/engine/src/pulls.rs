use std::collections::{HashMap, HashSet};

use commitscape_core::{AuthorId, FileId, Oid};
use commitscape_metrics::{is_lockfile, looks_generated};
use commitscape_report::api::PersonRef;
use serde::{Deserialize, Serialize};

use crate::loaded::LoadedPack;
use crate::params::is_js_space;
use crate::view::{compare_text, counts, lines_of, person_of};

const HOLDERS_KEPT: usize = 6;
const PARTNERS_KEPT: usize = 8;
const PARTNER_TOGETHER: u32 = 3;
const PARTNER_SHARE: f64 = 0.3;
const LANDED_KEPT: usize = 8;
const FILES_KEPT: usize = 300;
const MAINLINE: u8 = 8;
const PULL_DIGITS: usize = 7;

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Named {
    pub sha: String,
    pub at: i64,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PullHolder {
    pub person: PersonRef,
    pub files: u32,
    pub commits: u32,
    pub last: i64,
    pub maintainer: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PullPartner {
    pub path: String,
    pub together: u32,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PullLanded {
    pub sha: String,
    pub at: i64,
    pub subject: String,
    pub person: Option<PersonRef>,
    pub added: Option<u64>,
    pub removed: Option<u64>,
    pub files: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PullFileChange {
    pub path: String,
    pub added: Option<u64>,
    pub removed: Option<u64>,
    pub head: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullInsight {
    pub number: u64,
    pub source: &'static str,
    pub touched: usize,
    pub known: usize,
    pub together: u32,
    pub holders: Vec<PullHolder>,
    pub partners: Vec<PullPartner>,
    pub landed: Vec<PullLanded>,
    pub files: Vec<PullFileChange>,
    pub files_total: usize,
}

struct Found {
    known: usize,
    together: u32,
    holders: Vec<PullHolder>,
    partners: Vec<PullPartner>,
}

fn digit_run(bytes: &[u8]) -> usize {
    bytes.iter().take_while(|b| b.is_ascii_digit()).count()
}

fn number(digits: &[u8]) -> Option<u32> {
    std::str::from_utf8(digits).ok()?.parse().ok()
}

fn merged(subject: &str) -> Option<u32> {
    let rest = subject.strip_prefix("Merge pull request #")?.as_bytes();
    let run = digit_run(rest);
    let bounded = rest
        .get(run)
        .is_none_or(|&b| !(b.is_ascii_alphanumeric() || b == b'_'));
    if (1..=PULL_DIGITS).contains(&run) && bounded {
        number(rest.get(..run)?)
    } else {
        None
    }
}

fn squashed(subject: &str) -> Option<u32> {
    let bytes = subject.trim_end_matches(is_js_space).as_bytes();
    let inner = bytes.strip_suffix(b")")?;
    let run = inner
        .iter()
        .rev()
        .take_while(|b| b.is_ascii_digit())
        .count();
    let digits = inner.get(inner.len() - run..)?;
    let before = inner.get(..inner.len() - run)?;
    if (1..=PULL_DIGITS).contains(&run) && before.ends_with(b"(#") {
        number(digits)
    } else {
        None
    }
}

fn last_named(subject: &str) -> Option<u32> {
    let bytes = subject.as_bytes();
    let mut found = None;
    for (at, _) in subject.match_indices("(#") {
        let rest = bytes.get(at + 2..).unwrap_or(&[]);
        let run = digit_run(rest);
        if (1..=PULL_DIGITS).contains(&run) && rest.get(run) == Some(&b')') {
            found = rest.get(..run).and_then(number);
        }
    }
    found
}

/// The pull request a commit's subject names: "Merge pull request #123", "(#123)" at its end, else the last "(#123)" in it.
pub fn pull_of(subject: &str) -> Option<u32> {
    merged(subject)
        .or_else(|| squashed(subject))
        .or_else(|| last_named(subject))
}

fn oid_of(sha: &str) -> Option<Oid> {
    let hex = sha.len() == 40 && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if hex {
        Oid::from_hex(sha)
    } else {
        None
    }
}

struct Landed {
    landed: Vec<PullLanded>,
    files: Vec<String>,
    changes: Vec<PullFileChange>,
}

fn landed_of(held: &LoadedPack, named: &[Named]) -> Landed {
    let pack = &held.pack;
    let index = &pack.index;
    let view = held.view();
    let lines = pack.lines_mainline;
    let distinct: HashSet<&str> = named.iter().map(|n| n.sha.as_str()).collect();
    let wanted: HashSet<Oid> = distinct.iter().filter_map(|s| oid_of(s)).collect();
    let mut at: HashMap<Oid, usize> = HashMap::new();
    if !wanted.is_empty() {
        for (i, c) in index.commits.iter().enumerate() {
            if at.len() >= wanted.len() {
                break;
            }
            if wanted.contains(&c.id) {
                at.insert(c.id, i);
            }
        }
    }
    let mut newest: Vec<&Named> = named.iter().collect();
    newest.sort_by_key(|n| std::cmp::Reverse(n.at));
    newest.truncate(LANDED_KEPT);
    let mut out = Landed {
        landed: Vec::new(),
        files: Vec::new(),
        changes: Vec::new(),
    };
    let mut change_at: HashMap<String, usize> = HashMap::new();
    for n in newest {
        let c = oid_of(&n.sha)
            .and_then(|o| at.get(&o))
            .and_then(|&i| index.commits.get(i));
        let mut touched = 0;
        if let Some(c) = c {
            for ch in index.changes_of(c) {
                let (a, r) = ch
                    .lines()
                    .map_or((0, 0), |l| (u64::from(l.added), u64::from(l.removed)));
                touched += 1;
                let path = view.path(ch.file);
                if path.is_empty() {
                    continue;
                }
                out.files.push(path.to_string());
                match change_at.get(path).and_then(|&i| out.changes.get_mut(i)) {
                    Some(held) => {
                        held.added = lines.then(|| held.added.unwrap_or(0) + a);
                        held.removed = lines.then(|| held.removed.unwrap_or(0) + r);
                    }
                    None => {
                        change_at.insert(path.to_string(), out.changes.len());
                        out.changes.push(PullFileChange {
                            path: path.to_string(),
                            added: lines.then_some(a),
                            removed: lines.then_some(r),
                            head: view.head(index, ch.file).is_some(),
                        });
                    }
                }
            }
        }
        let sums = c.map(|c| lines_of(index, c, |_| true));
        out.landed.push(PullLanded {
            sha: n.sha.clone(),
            at: n.at,
            subject: n.subject.clone(),
            person: c.and_then(|c| index.author_of(c)).map(|p| held.person(p)),
            added: sums.filter(|_| lines).map(|s| s.0),
            removed: sums.filter(|_| lines).map(|s| s.1),
            files: touched,
        });
    }
    out
}

fn insight_of(held: &LoadedPack, paths: &[String], author: Option<&str>) -> Found {
    let pack = &held.pack;
    let index = &pack.index;
    let view = held.view();
    let ids: HashSet<FileId> = paths.iter().filter_map(|p| view.file_named(p)).collect();
    if ids.is_empty() {
        return Found {
            known: 0,
            together: 0,
            holders: Vec::new(),
            partners: Vec::new(),
        };
    }
    let mut per = vec![0u32; index.paths.len()];
    let mut with_them: HashMap<FileId, u32> = HashMap::new();
    let mut people: HashMap<AuthorId, (u32, i64)> = HashMap::new();
    let mut per_file: HashMap<FileId, Vec<(AuthorId, u32)>> = HashMap::new();
    let mut together = 0u32;
    for (at, c) in index.commits.iter().enumerate() {
        let on_mainline = pack.mainline.get(at).copied().unwrap_or(0) & MAINLINE != 0;
        if !counts(&pack.options, c) || (view.mainline && !on_mainline) {
            continue;
        }
        let changes = index.changes_of(c);
        let mut hit = false;
        for ch in changes {
            if let Some(n) = per.get_mut(ch.file.idx()) {
                *n += 1;
            }
            hit |= ids.contains(&ch.file);
        }
        if !hit {
            continue;
        }
        together += 1;
        let who = person_of(index, c);
        if let Some(who) = who {
            let p = people.entry(who).or_insert((0, 0));
            p.0 += 1;
            p.1 = p.1.max(c.time);
        }
        for ch in changes {
            if ids.contains(&ch.file) {
                let Some(who) = who else {
                    continue;
                };
                let by = per_file.entry(ch.file).or_default();
                match by.iter_mut().find(|(p, _)| *p == who) {
                    Some((_, n)) => *n += 1,
                    None => by.push((who, 1)),
                }
            } else {
                *with_them.entry(ch.file).or_insert(0) += 1;
            }
        }
    }
    let mine = author.map(str::to_lowercase);
    let is_author = |p: AuthorId| {
        mine.as_deref()
            .is_some_and(|m| held.person(p).login.unwrap_or_default().to_lowercase() == m)
    };
    let mut held_files: HashMap<AuthorId, u32> = HashMap::new();
    for by in per_file.values() {
        let mut top: Option<(AuthorId, u32)> = None;
        for &(p, n) in by {
            if !is_author(p) && top.is_none_or(|(_, best)| n > best) {
                top = Some((p, n));
            }
        }
        if let Some((p, _)) = top {
            *held_files.entry(p).or_insert(0) += 1;
        }
    }
    let mut holders: Vec<PullHolder> = people
        .iter()
        .filter(|&(&p, _)| !is_author(p))
        .map(|(&p, &(commits, last))| PullHolder {
            person: held.person(p),
            files: held_files.get(&p).copied().unwrap_or(0),
            commits,
            last,
            maintainer: view.maintainers.contains(&p),
        })
        .collect();
    holders.sort_by(|a, b| {
        b.files
            .cmp(&a.files)
            .then(b.commits.cmp(&a.commits))
            .then(b.last.cmp(&a.last))
            .then(a.person.id.cmp(&b.person.id))
    });
    holders.truncate(HOLDERS_KEPT);
    let mut partners: Vec<PullPartner> = with_them
        .iter()
        .filter_map(|(&f, &n)| {
            let total = per.get(f.idx()).copied().unwrap_or(0);
            let path = view.path(f);
            let raw = index.paths.path(f).unwrap_or(&[]);
            let kept = !path.is_empty()
                && view.head(index, f).is_some()
                && !is_lockfile(raw)
                && !looks_generated(raw)
                && n >= PARTNER_TOGETHER
                && total != 0
                && f64::from(n) / f64::from(total) >= PARTNER_SHARE;
            kept.then(|| PullPartner {
                path: path.to_string(),
                together: n,
                commits: total,
            })
        })
        .collect();
    partners.sort_by(|a, b| {
        let share = |p: &PullPartner| f64::from(p.together) / f64::from(p.commits);
        let d = share(b) - share(a);
        d.partial_cmp(&0.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.together.cmp(&a.together))
            .then_with(|| compare_text(&a.path, &b.path))
    });
    partners.truncate(PARTNERS_KEPT);
    Found {
        known: ids.len(),
        together,
        holders,
        partners,
    }
}

/// A pull request set against the Stored Index, as `pullInsight` worked it out from its files (`own`, empty when none were kept), its author and the commits that name it: who holds its files, the files that usually change with them, and what those commits changed.
pub fn insight(
    held: &LoadedPack,
    number: u64,
    own: &[String],
    author: Option<&str>,
    named: &[Named],
) -> PullInsight {
    let landed = landed_of(held, named);
    let paths: Vec<String> = if own.is_empty() {
        let mut seen = HashSet::new();
        landed
            .files
            .iter()
            .filter(|p| seen.insert(p.as_str()))
            .cloned()
            .collect()
    } else {
        own.to_vec()
    };
    let source = if !own.is_empty() {
        "kept"
    } else if !paths.is_empty() {
        "commit"
    } else {
        "none"
    };
    let told = insight_of(held, &paths, author);
    let mut ranked = landed.changes;
    let size = |c: &PullFileChange| c.added.unwrap_or(0) + c.removed.unwrap_or(0);
    ranked.sort_by(|a, b| {
        size(b)
            .cmp(&size(a))
            .then_with(|| compare_text(&a.path, &b.path))
    });
    let files_total = ranked.len();
    ranked.truncate(FILES_KEPT);
    PullInsight {
        number,
        source,
        touched: paths.len(),
        known: told.known,
        together: told.together,
        holders: told.holders,
        partners: told.partners,
        landed: landed.landed,
        files: ranked,
        files_total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_subject_names_a_pull_request_as_the_site_reads_it() {
        assert_eq!(pull_of("Merge pull request #12 from a/b"), Some(12));
        assert_eq!(pull_of("Merge pull request #12a"), None);
        assert_eq!(pull_of("Merge pull request #12345678"), None);
        assert_eq!(pull_of("feat: thing (#345)"), Some(345));
        assert_eq!(pull_of("feat: thing (#345) \u{a0}"), Some(345));
        assert_eq!(pull_of("fix (#7) and (#8) then more"), Some(8));
        assert_eq!(pull_of("fix (#12345678)"), None);
        assert_eq!(pull_of("(#1)(#2) x"), Some(2));
        assert_eq!(pull_of("nothing #4"), None);
        assert_eq!(pull_of("Merge pull request #9_x (#3)"), Some(3));
    }
}
