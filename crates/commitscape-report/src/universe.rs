use std::collections::{HashMap, HashSet};
use std::io::Write;

use commitscape_core::{CommitFlags, FileId, Oid, SignatureId};
use serde::Serialize;

use crate::export::Files;
use crate::pack::Pack;

const REACHABLE: u8 = 8;

const FIRST_PARENT: u8 = 16;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommitRow {
    pub time: i64,
    pub person: i64,
    pub bulk: bool,
    #[serde(rename = "firstParent")]
    pub first_parent: bool,
    pub files: Vec<u32>,
    pub changes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileRow {
    pub file: u32,
    pub path: String,
    pub alive: bool,
    pub role: u8,
    pub language: Option<&'static str>,
    pub generated: bool,
    pub lockfile: bool,
    pub lines: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PersonRow {
    pub id: u32,
    pub name: String,
    pub login: Option<String>,
    pub bot: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Rows {
    pub mainline: bool,
    pub newest: i64,
    pub commits: Vec<CommitRow>,
    pub files: Vec<FileRow>,
    pub people: Vec<PersonRow>,
    pub releases: Vec<(String, i64)>,
}

struct Header {
    mainline: bool,
    newest: i64,
    picked: Vec<(i64, usize)>,
}

fn header(pack: &Pack) -> Header {
    let index = &pack.index;
    let bits = |at: usize| pack.mainline.get(at).copied().unwrap_or(0);
    let arrival = |at: usize| pack.arrival.get(at).copied().flatten();
    let mainline = (0..index.commits.len()).any(|at| bits(at) & REACHABLE != 0);
    let mut picked: Vec<(i64, i64, Oid, usize)> = index
        .commits
        .iter()
        .enumerate()
        .filter(|(at, c)| !c.is_merge() && (!mainline || bits(*at) & REACHABLE != 0))
        .map(|(at, c)| {
            let t = if mainline {
                arrival(at).unwrap_or(c.time)
            } else {
                c.time
            };
            (t, c.time, c.id, at)
        })
        .collect();
    picked.sort_unstable();
    let newest = picked.iter().map(|p| p.0).max().unwrap_or(0).max(0);
    Header {
        mainline,
        newest,
        picked: picked.into_iter().map(|(t, _, _, at)| (t, at)).collect(),
    }
}

fn commit_row(pack: &Pack, t: i64, at: usize) -> Option<CommitRow> {
    let index = &pack.index;
    let c = index.commits.get(at)?;
    let changes = index.changes_of(c);
    Some(CommitRow {
        time: t,
        person: index.author_of(c).map_or(-1, |p| i64::from(p.0)),
        bulk: c.flags.contains(CommitFlags::BULK),
        first_parent: pack.mainline.get(at).copied().unwrap_or(0) & FIRST_PARENT != 0,
        files: changes.iter().map(|ch| ch.file.0).collect(),
        changes: changes.iter().map(|ch| ch.kind as u8).collect(),
    })
}

/// What the Atlas is made from, as the Site's `atlasRows` read it from the Stored Index before: the commits that reached the default branch by when they did (every commit when no Mainline is known), Merge Commits left out, files by id, people in the order of their first Signature, and each release at its commit's Main Arrival.
pub fn rows(pack: &Pack) -> Rows {
    let Header {
        mainline,
        newest,
        picked,
    } = header(pack);
    Rows {
        mainline,
        newest,
        commits: picked
            .into_iter()
            .filter_map(|(t, at)| commit_row(pack, t, at))
            .collect(),
        files: files(pack),
        people: people(pack),
        releases: releases(pack),
    }
}

#[derive(Serialize)]
struct Counts<'a> {
    mainline: bool,
    newest: i64,
    releases: &'a [(String, i64)],
    commits: usize,
    files: usize,
    people: usize,
}

/// Writes the rows `rows` gives as JSON lines, one commit, file or person at a time: a first line with the Mainline flag, the newest time, the releases and how many of each follow, then the commits, the files and the people.
pub fn write_rows(pack: &Pack, out: &mut impl Write) -> std::io::Result<()> {
    let Header {
        mainline,
        newest,
        picked,
    } = header(pack);
    let files = files(pack);
    let people = people(pack);
    let releases = releases(pack);
    let line = |out: &mut dyn Write, value: &dyn erased::Line| -> std::io::Result<()> {
        value.write_to(out)?;
        out.write_all(b"\n")
    };
    line(
        out,
        &Counts {
            mainline,
            newest,
            releases: &releases,
            commits: picked.len(),
            files: files.len(),
            people: people.len(),
        },
    )?;
    for (t, at) in picked {
        let row = commit_row(pack, t, at)
            .ok_or_else(|| std::io::Error::other("a commit the pack does not hold"))?;
        line(out, &row)?;
    }
    for f in &files {
        line(out, f)?;
    }
    for p in &people {
        line(out, p)?;
    }
    Ok(())
}

mod erased {
    pub(super) trait Line {
        fn write_to(&self, out: &mut dyn std::io::Write) -> std::io::Result<()>;
    }

    impl<T: serde::Serialize> Line for T {
        fn write_to(&self, out: &mut dyn std::io::Write) -> std::io::Result<()> {
            serde_json::to_writer(out, self).map_err(std::io::Error::other)
        }
    }
}

fn files(pack: &Pack) -> Vec<FileRow> {
    let index = &pack.index;
    let facts = Files::of(index);
    let loc: HashMap<FileId, u32> = index.head.iter().map(|h| (h.file, h.loc)).collect();
    (0..index.paths.len())
        .map(|i| {
            let file = FileId(i as u32);
            let f = facts.facts(file);
            FileRow {
                file: file.0,
                path: f.path,
                alive: f.alive,
                role: f.role,
                language: f.language,
                generated: f.generated,
                lockfile: f.lockfile,
                lines: loc.get(&file).copied(),
            }
        })
        .collect()
}

fn people(pack: &Pack) -> Vec<PersonRow> {
    let index = &pack.index;
    let logins: HashMap<u32, &str> = pack
        .logins
        .iter()
        .map(|(id, login)| (*id, login.as_str()))
        .collect();
    let mut seen = HashSet::new();
    (0..index.authors.signature_count())
        .filter_map(|i| {
            let sig = SignatureId(i as u32);
            let person = index.authors.person_of(sig)?;
            if !seen.insert(person) {
                return None;
            }
            let name = index
                .authors
                .get(person)
                .map(|a| a.name)
                .or_else(|| index.authors.signature(sig).map(|s| s.name))
                .unwrap_or_default();
            Some(PersonRow {
                id: person.0,
                name: name.to_string(),
                login: logins.get(&person.0).map(|l| l.to_string()),
                bot: index.authors.is_bot(person),
            })
        })
        .collect()
}

fn releases(pack: &Pack) -> Vec<(String, i64)> {
    let index = &pack.index;
    let arrival = |at: usize| pack.arrival.get(at).copied().flatten();
    let commit_of: HashMap<&str, Oid> = pack
        .release_commits
        .iter()
        .filter_map(|(name, hex)| Some((name.as_str(), Oid::from_hex(hex)?)))
        .collect();
    let wanted: HashSet<Oid> = commit_of.values().copied().collect();
    let mut arrived: HashMap<Oid, i64> = HashMap::new();
    if !wanted.is_empty() {
        for (at, c) in index.commits.iter().enumerate() {
            if wanted.contains(&c.id) {
                arrived.insert(c.id, arrival(at).unwrap_or(c.time));
            }
        }
    }
    pack.releases
        .iter()
        .map(|(name, t)| {
            let at = commit_of
                .get(name.as_str())
                .and_then(|c| arrived.get(c))
                .copied()
                .filter(|&a| a != 0);
            (name.clone(), at.unwrap_or(*t))
        })
        .collect()
}
