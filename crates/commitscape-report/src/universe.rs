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

struct Header {
    mainline: bool,
    newest: i64,
    picked: Vec<u32>,
}

fn arrived(pack: &Pack, mainline: bool, at: usize) -> i64 {
    let time = pack.index.commits.get(at).map_or(0, |c| c.time);
    if mainline {
        pack.arrival.get(at).copied().flatten().unwrap_or(time)
    } else {
        time
    }
}

fn header(pack: &Pack) -> Header {
    let index = &pack.index;
    let bits = |at: usize| pack.mainline.get(at).copied().unwrap_or(0);
    let mainline = (0..index.commits.len()).any(|at| bits(at) & REACHABLE != 0);
    let mut picked: Vec<u32> = index
        .commits
        .iter()
        .enumerate()
        .filter(|(at, c)| !c.is_merge() && (!mainline || bits(*at) & REACHABLE != 0))
        .map(|(at, _)| at as u32)
        .collect();
    let key = |&at: &u32| {
        let at = at as usize;
        let c = index.commits.get(at);
        (
            arrived(pack, mainline, at),
            c.map_or(0, |c| c.time),
            c.map_or([0; 20], |c| c.id.0),
            at,
        )
    };
    picked.sort_unstable_by_key(key);
    let newest = picked
        .iter()
        .map(|&at| arrived(pack, mainline, at as usize))
        .max()
        .unwrap_or(0)
        .max(0);
    Header {
        mainline,
        newest,
        picked,
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
    for at in picked {
        let at = at as usize;
        let row = commit_row(pack, arrived(pack, mainline, at), at)
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

const ATLAS_MAGIC: i64 = 0x4153_4331;
const ATLAS_VERSION: i64 = 1;
const ROLE: u8 = 7;
const ALIVE: u8 = 8;
const GENERATED: u8 = 16;
const LOCKFILE: u8 = 32;
const BULK: u8 = 1;
const ON_FIRST_PARENT: u8 = 2;

/// The Universe's Atlas of a pack: its map and its file names, uncompressed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Atlas {
    pub map: Vec<u8>,
    pub names: Vec<u8>,
}

#[derive(Default)]
struct Writer(Vec<u8>);

impl Writer {
    fn byte(&mut self, v: u8) {
        self.0.push(v);
    }

    fn uint(&mut self, v: i64) -> std::io::Result<()> {
        let mut n = u64::try_from(v)
            .map_err(|_| std::io::Error::other(format!("not a whole number: {v}")))?;
        while n >= 0x80 {
            self.0.push((n % 0x80) as u8 | 0x80);
            n /= 0x80;
        }
        self.0.push(n as u8);
        Ok(())
    }

    fn int(&mut self, v: i64) -> std::io::Result<()> {
        self.uint(if v < 0 { -2 * v - 1 } else { 2 * v })
    }

    fn text(&mut self, s: &str) -> std::io::Result<()> {
        self.uint(s.len() as i64)?;
        self.0.extend_from_slice(s.as_bytes());
        Ok(())
    }
}

fn after_slash(path: &str) -> &str {
    path.rfind('/')
        .map_or(path, |cut| path.get(cut + 1..).unwrap_or(""))
}

struct Folders {
    at: HashMap<String, i64>,
    parent: Vec<i64>,
    names: Vec<String>,
}

impl Folders {
    fn new() -> Self {
        Folders {
            at: HashMap::from([(String::new(), 0)]),
            parent: vec![-1],
            names: vec![String::new()],
        }
    }

    fn of(&mut self, path: &str) -> i64 {
        let Some(cut) = path.rfind('/') else {
            return 0;
        };
        let dir = path.get(..cut).unwrap_or("");
        if let Some(&found) = self.at.get(dir) {
            return found;
        }
        let parent = self.of(dir);
        let id = self.names.len() as i64;
        self.parent.push(parent);
        self.names.push(after_slash(dir).to_string());
        self.at.insert(dir.to_string(), id);
        id
    }
}

/// The Universe's Atlas of a pack, byte for byte as the Site's `encodeAtlas(atlasOf(rows))` and `encodeNames` write it from the rows `write_rows` gives: files numbered in the order they first changed, folders from their paths, people by how many commits they made. Each column is a pass over the pack's commits, so nothing but the files, people and the bytes is held.
pub fn atlas(pack: &Pack) -> std::io::Result<Atlas> {
    let index = &pack.index;
    let Header {
        mainline,
        newest,
        picked,
    } = header(pack);
    let files = files(pack);
    let people = people(pack);
    let mut releases = releases(pack);
    let commit = |at: u32| index.commits.get(at as usize);
    let picked: Vec<u32> = picked
        .into_iter()
        .filter(|&at| commit(at).is_some())
        .collect();
    let person_of =
        |c: &commitscape_core::CommitMeta| index.author_of(c).map_or(-1, |p| i64::from(p.0));

    let mut order = vec![u32::MAX; files.len()];
    let mut ordered: Vec<u32> = Vec::new();
    let mut commits_by: HashMap<i64, u64> = HashMap::new();
    for &at in &picked {
        let Some(c) = commit(at) else { continue };
        for ch in index.changes_of(c) {
            let Some(slot) = order.get_mut(ch.file.idx()) else {
                continue;
            };
            if *slot == u32::MAX {
                *slot = ordered.len() as u32;
                ordered.push(ch.file.0);
            }
        }
        let person = person_of(c);
        if person >= 0 {
            *commits_by.entry(person).or_default() += 1;
        }
    }
    for f in &files {
        if let Some(slot) = order.get_mut(f.file as usize) {
            if f.alive && *slot == u32::MAX {
                *slot = ordered.len() as u32;
                ordered.push(f.file);
            }
        }
    }

    let known: HashMap<i64, &PersonRow> = people.iter().map(|p| (i64::from(p.id), p)).collect();
    let mut ranked: Vec<(i64, u64)> = commits_by
        .into_iter()
        .filter(|(id, _)| known.contains_key(id))
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let person_index: HashMap<i64, i64> = ranked
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (*id, i as i64))
        .collect();

    let origin = picked
        .first()
        .map_or(newest, |&at| arrived(pack, mainline, at as usize));
    let mut w = Writer::default();
    w.uint(ATLAS_MAGIC)?;
    w.uint(ATLAS_VERSION)?;
    w.uint(i64::from(mainline))?;
    w.uint(origin)?;
    w.uint((origin.max(newest) - origin).max(0))?;

    w.uint(ranked.len() as i64)?;
    for (id, _) in &ranked {
        w.uint(*id)?;
    }
    let ranked_people: Vec<&PersonRow> = ranked
        .iter()
        .filter_map(|(id, _)| known.get(id).copied())
        .collect();
    for p in &ranked_people {
        w.byte(u8::from(p.bot));
    }
    for p in &ranked_people {
        w.text(&p.name)?;
    }
    for p in &ranked_people {
        w.text(p.login.as_deref().unwrap_or(""))?;
    }

    let mut folders = Folders::new();
    let mut languages: Vec<&str> = Vec::new();
    let mut language_at: HashMap<&str, i64> = HashMap::new();
    let mut folder_of = Vec::with_capacity(ordered.len());
    let mut info = Vec::with_capacity(ordered.len());
    let mut language = Vec::with_capacity(ordered.len());
    let mut lines = Vec::with_capacity(ordered.len());
    for &file in &ordered {
        let Some(f) = files.get(file as usize) else {
            continue;
        };
        folder_of.push(folders.of(&f.path));
        info.push(
            (f.role & ROLE)
                | if f.alive { ALIVE } else { 0 }
                | if f.generated { GENERATED } else { 0 }
                | if f.lockfile { LOCKFILE } else { 0 },
        );
        language.push(match f.language {
            Some(l) => *language_at.entry(l).or_insert_with(|| {
                languages.push(l);
                languages.len() as i64
            }),
            None => 0,
        });
        lines.push(match (f.alive, f.lines) {
            (true, Some(n)) => i64::from(n),
            _ => -1,
        });
    }
    w.uint(folders.parent.len() as i64)?;
    for (i, parent) in folders.parent.iter().enumerate().skip(1) {
        w.uint(i as i64 - parent)?;
    }
    for name in folders.names.iter().skip(1) {
        w.text(name)?;
    }
    w.uint(languages.len() as i64)?;
    for l in &languages {
        w.text(l)?;
    }
    w.uint(ordered.len() as i64)?;
    let mut prev = 0;
    for &v in &folder_of {
        w.int(v - prev)?;
        prev = v;
    }
    for &b in &info {
        w.byte(b);
    }
    for &l in &language {
        w.uint(l)?;
    }
    for &n in &lines {
        w.uint(n + 1)?;
    }

    w.uint(picked.len() as i64)?;
    let mut last = origin;
    for &at in &picked {
        let t = arrived(pack, mainline, at as usize);
        w.uint((t - last).max(0))?;
        last = last.max(t);
    }
    for &at in &picked {
        let person = commit(at).map_or(-1, person_of);
        let i = if person >= 0 {
            person_index.get(&person).copied().unwrap_or(-1)
        } else {
            -1
        };
        w.uint(i + 1)?;
    }
    for &at in &picked {
        let bulk = commit(at).is_some_and(|c| c.flags.contains(CommitFlags::BULK));
        let first = pack.mainline.get(at as usize).copied().unwrap_or(0) & FIRST_PARENT != 0;
        w.byte(if bulk { BULK } else { 0 } | if first { ON_FIRST_PARENT } else { 0 });
    }
    let counted = |at: u32| {
        commit(at).map_or(0, |c| {
            index
                .changes_of(c)
                .iter()
                .filter(|ch| order.get(ch.file.idx()).is_some_and(|&o| o != u32::MAX))
                .count()
        })
    };
    for &at in &picked {
        w.uint(counted(at) as i64)?;
    }
    let mut kinds: Vec<u8> = Vec::new();
    for &at in &picked {
        let Some(c) = commit(at) else { continue };
        let mut before = 0i64;
        for ch in index.changes_of(c) {
            let Some(&id) = order.get(ch.file.idx()).filter(|&&o| o != u32::MAX) else {
                continue;
            };
            w.int(i64::from(id) - before)?;
            before = i64::from(id);
            kinds.push((ch.kind as u8).min(3));
        }
    }
    for four in kinds.chunks(4) {
        let mut b = 0u8;
        for (k, kind) in four.iter().enumerate() {
            b |= (kind & 3) << (k * 2);
        }
        w.byte(b);
    }

    releases.sort_by_key(|r| r.1);
    w.uint(releases.len() as i64)?;
    for (name, _) in &releases {
        w.text(name)?;
    }
    for (_, t) in &releases {
        w.uint((t - origin).max(0))?;
    }

    let mut names = Writer::default();
    names.uint(ordered.len() as i64)?;
    for &file in &ordered {
        names.text(
            files
                .get(file as usize)
                .map_or("", |f| after_slash(&f.path)),
        )?;
    }
    Ok(Atlas {
        map: w.0,
        names: names.0,
    })
}
