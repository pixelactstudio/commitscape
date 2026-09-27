use std::collections::HashMap;

use commitscape_core::{AuthorId, FileId};
use serde::Serialize;

use crate::analysis::{counts, top, Analysis, Churn};

const BUS_FACTOR_LINE: f64 = 0.8;

const DAY: i64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Owner {
    pub author: AuthorId,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirectoryOwnership {
    pub dir: Vec<u8>,
    pub commits: u32,
    pub owners: Vec<Owner>,
    pub bus_factor: u32,
}

impl DirectoryOwnership {
    pub fn label(&self) -> String {
        if self.dir.is_empty() {
            "(root)".to_string()
        } else {
            String::from_utf8_lossy(&self.dir).into_owned()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ownership {
    pub directory_count: u32,
    pub bus_factor_one: u32,
    pub directories: Vec<DirectoryOwnership>,
}

impl Ownership {
    pub fn held_alone(&self) -> Vec<&DirectoryOwnership> {
        let held: Vec<&DirectoryOwnership> = self
            .directories
            .iter()
            .filter(|d| d.bus_factor == 1)
            .collect();
        let holder = |d: &DirectoryOwnership| d.owners.first().map(|o| o.author);
        held.iter()
            .copied()
            .filter(|d| {
                !held.iter().any(|outer| {
                    outer.dir.len() < d.dir.len()
                        && d.dir.starts_with(&outer.dir)
                        && holder(outer) == holder(d)
                })
            })
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Silo {
    pub directory: DirectoryOwnership,
    pub holder: AuthorId,
    pub successor: Option<(AuthorId, u32)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Contributor {
    pub author: AuthorId,
    pub commits: u32,
    pub active_days: u32,
    pub first: i64,
    pub last: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SuspectedDuplicate {
    pub people: Vec<AuthorId>,
    pub commits: Vec<u32>,
}

impl Analysis<'_> {
    pub fn ownership(&self) -> Ownership {
        let index = self.index();
        let options = self.options();
        let mut written = vec![false; index.paths.len()];
        for h in self.ranked() {
            if let Some(w) = written.get_mut(h.file.idx()) {
                *w = true;
            }
        }

        let mut dirs = DirTable::default();
        let mut file_dirs: Vec<Option<(u32, u32)>> = vec![None; index.paths.len()];
        let mut dir_list: Vec<u32> = Vec::new();
        let mut last_seen: Vec<u32> = Vec::new();
        let mut commits_per_dir: Vec<u32> = Vec::new();
        let mut pairs: Vec<(u32, AuthorId)> = Vec::new();

        for (n, commit) in self.window_commits().iter().enumerate() {
            if !counts(commit, &options) {
                continue;
            }
            let Some(author) = self.person_of(commit) else {
                continue;
            };
            let stamp = n as u32 + 1;
            for change in index.changes_of(commit) {
                let f = change.file.idx();
                if !written.get(f).copied().unwrap_or(false) {
                    continue;
                }
                let range = match file_dirs.get(f).copied().flatten() {
                    Some(r) => r,
                    None => {
                        let start = dir_list.len() as u32;
                        if let Some(path) = index.paths.path(change.file) {
                            dirs.ancestors(path, &mut dir_list);
                        }
                        let r = (start, dir_list.len() as u32 - start);
                        if let Some(slot) = file_dirs.get_mut(f) {
                            *slot = Some(r);
                        }
                        r
                    }
                };
                let (start, len) = (range.0 as usize, range.1 as usize);
                for &d in dir_list.get(start..start + len).unwrap_or(&[]) {
                    let d_idx = d as usize;
                    if last_seen.len() <= d_idx {
                        last_seen.resize(d_idx + 1, 0);
                        commits_per_dir.resize(d_idx + 1, 0);
                    }
                    if last_seen.get(d_idx) == Some(&stamp) {
                        continue;
                    }
                    if let Some(s) = last_seen.get_mut(d_idx) {
                        *s = stamp;
                    }
                    if let Some(c) = commits_per_dir.get_mut(d_idx) {
                        *c += 1;
                    }
                    pairs.push((d, author));
                }
            }
        }

        pairs.sort_unstable();
        let mut out: Vec<DirectoryOwnership> = Vec::new();
        let mut i = 0;
        while let Some(&(dir, _)) = pairs.get(i) {
            let run = pairs
                .get(i..)
                .unwrap_or(&[])
                .iter()
                .take_while(|(d, _)| *d == dir)
                .count();
            let commits = commits_per_dir.get(dir as usize).copied().unwrap_or(0);
            if commits >= options.ownership_min_commits {
                let mut owners: Vec<Owner> = Vec::new();
                for &(_, author) in pairs.get(i..i + run).unwrap_or(&[]) {
                    match owners.last_mut() {
                        Some(o) if o.author == author => o.commits += 1,
                        _ => owners.push(Owner { author, commits: 1 }),
                    }
                }
                owners.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.author.cmp(&b.author)));
                out.push(DirectoryOwnership {
                    dir: dirs.path(dir),
                    commits,
                    bus_factor: bus_factor(&owners, commits),
                    owners,
                });
            }
            i += run.max(1);
        }
        let directory_count = out.len() as u32;
        let bus_factor_one = out.iter().filter(|d| d.bus_factor == 1).count() as u32;
        top(&mut out, |a, b| {
            a.bus_factor
                .cmp(&b.bus_factor)
                .then(b.commits.cmp(&a.commits))
                .then_with(|| a.dir.cmp(&b.dir))
        });
        Ownership {
            directory_count,
            bus_factor_one,
            directories: out,
        }
    }

    pub fn contributors(&self) -> Vec<Contributor> {
        self.committers(false)
    }

    pub fn activity(&self) -> (u32, u32) {
        let index = self.index();
        let mut people = std::collections::HashSet::new();
        let mut commits = 0;
        for c in self.window_commits().iter().filter(|c| !c.is_merge()) {
            if let Some(a) = index.author_of(c).filter(|&a| !index.authors.is_bot(a)) {
                commits += 1;
                people.insert(a);
            }
        }
        (commits, people.len() as u32)
    }

    pub fn bots(&self) -> Vec<Contributor> {
        self.committers(true)
    }

    fn committers(&self, bots: bool) -> Vec<Contributor> {
        let index = self.index();
        let mut made: Vec<(AuthorId, i64)> = self
            .window_commits()
            .iter()
            .filter(|c| !c.is_merge())
            .filter_map(|c| index.author_of(c).map(|a| (a, c.landed_clock())))
            .filter(|&(a, _)| index.authors.is_bot(a) == bots)
            .collect();
        made.sort_unstable();

        let mut out: Vec<Contributor> = Vec::new();
        let mut last_day = None;
        for (author, clock) in made {
            let day = clock.div_euclid(DAY);
            match out.last_mut() {
                Some(c) if c.author == author => {
                    c.commits += 1;
                    c.last = clock;
                    if last_day != Some(day) {
                        c.active_days += 1;
                    }
                }
                _ => out.push(Contributor {
                    author,
                    commits: 1,
                    active_days: 1,
                    first: clock,
                    last: clock,
                }),
            }
            last_day = Some(day);
        }
        top(&mut out, |a, b| {
            b.commits.cmp(&a.commits).then(a.author.cmp(&b.author))
        });
        out
    }

    pub fn silos(&self) -> Vec<Silo> {
        self.silos_in(&self.ownership())
    }

    pub fn silos_in(&self, ownership: &Ownership) -> Vec<Silo> {
        let single = |d: &DirectoryOwnership| d.owners.len() == 1;
        let mut out: Vec<Silo> = ownership
            .held_alone()
            .into_iter()
            .filter(|d| single(d))
            .filter_map(|d| {
                let holder = d.owners.first()?.author;
                let around = ownership
                    .directories
                    .iter()
                    .filter(|o| o.dir.len() < d.dir.len() && d.dir.starts_with(&o.dir))
                    .filter(|o| !single(o))
                    .max_by_key(|o| o.dir.len());
                let successor = around.and_then(|o| {
                    o.owners
                        .iter()
                        .find(|x| x.author != holder)
                        .map(|x| (x.author, x.commits))
                });
                Some(Silo {
                    directory: d.clone(),
                    holder,
                    successor,
                })
            })
            .collect();
        out.sort_by(|a, b| {
            b.directory
                .commits
                .cmp(&a.directory.commits)
                .then_with(|| a.directory.dir.cmp(&b.directory.dir))
        });
        out
    }

    pub fn work_of(&self, author: AuthorId) -> Vec<Churn> {
        let index = self.index();
        let options = self.options();
        let mut written = vec![false; index.paths.len()];
        for h in self.ranked() {
            let manifest = index
                .paths
                .path(h.file)
                .is_some_and(|p| crate::role_of(p) == crate::Role::Dependencies);
            if let Some(w) = written.get_mut(h.file.idx()) {
                *w = !manifest;
            }
        }
        let mut commits = vec![0u32; index.paths.len()];
        for commit in self.window_commits() {
            if !counts(commit, &options) || index.author_of(commit) != Some(author) {
                continue;
            }
            for change in index.changes_of(commit) {
                if written.get(change.file.idx()).copied().unwrap_or(false) {
                    if let Some(n) = commits.get_mut(change.file.idx()) {
                        *n += 1;
                    }
                }
            }
        }
        let mut out: Vec<Churn> = self
            .ranked()
            .filter_map(|h| {
                let n = commits.get(h.file.idx()).copied().unwrap_or(0);
                (n > 0).then_some(Churn {
                    file: h.file,
                    commits: n,
                })
            })
            .collect();
        top(&mut out, |a, b| {
            b.commits
                .cmp(&a.commits)
                .then_with(|| self.by_path(a.file, b.file))
        });
        out
    }

    pub fn owners_of(&self, file: FileId) -> Vec<Owner> {
        let mut authors: Vec<AuthorId> = self
            .commits_touching(&[file])
            .into_iter()
            .filter_map(|c| self.person_of(c))
            .collect();
        authors.sort_unstable();
        let mut owners: Vec<Owner> = Vec::new();
        for author in authors {
            match owners.last_mut() {
                Some(o) if o.author == author => o.commits += 1,
                _ => owners.push(Owner { author, commits: 1 }),
            }
        }
        owners.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.author.cmp(&b.author)));
        owners
    }

    pub fn suspected_duplicates(&self) -> Vec<SuspectedDuplicate> {
        let authors = &self.index().authors;
        let used = authors.used();
        let commits_of = |person: AuthorId| -> u32 {
            authors
                .get(person)
                .map(|a| {
                    a.signatures
                        .iter()
                        .map(|s| used.get(s.idx()).copied().unwrap_or(0))
                        .sum()
                })
                .unwrap_or(0)
        };
        authors
            .suspected_duplicates
            .iter()
            .map(|group| {
                let mut people = group.clone();
                people.sort_by(|a, b| commits_of(*b).cmp(&commits_of(*a)).then(a.cmp(b)));
                let commits = people.iter().map(|p| commits_of(*p)).collect();
                SuspectedDuplicate { people, commits }
            })
            .collect()
    }

    pub fn mailmap_for(&self, group: &SuspectedDuplicate) -> String {
        let authors = &self.index().authors;
        let Some(keep) = group.people.first().and_then(|p| authors.get(*p)) else {
            return String::new();
        };
        let mut lines = String::new();
        for other in group.people.iter().skip(1).filter_map(|p| authors.get(*p)) {
            for sig in other
                .signatures
                .iter()
                .filter_map(|s| authors.signature(*s))
            {
                lines.push_str(&format!("{} <{}> <{}>\n", keep.name, keep.email, sig.email));
            }
        }
        lines
    }
}

#[derive(Default)]
struct DirTable {
    ids: HashMap<(u32, Vec<u8>), u32>,
    entries: Vec<(u32, Vec<u8>)>,
}

impl DirTable {
    fn ancestors(&mut self, path: &[u8], out: &mut Vec<u32>) {
        if self.entries.is_empty() {
            self.entries.push((0, Vec::new()));
        }
        out.push(0);
        let mut parent = 0u32;
        let mut components = path.split(|&b| b == b'/').peekable();
        while let Some(component) = components.next() {
            if components.peek().is_none() {
                break;
            }
            let key = (parent, component.to_vec());
            let next = match self.ids.get(&key) {
                Some(&id) => id,
                None => {
                    let id = self.entries.len() as u32;
                    self.entries.push(key.clone());
                    self.ids.insert(key, id);
                    id
                }
            };
            out.push(next);
            parent = next;
        }
    }

    fn path(&self, id: u32) -> Vec<u8> {
        let mut names: Vec<&[u8]> = Vec::new();
        let mut at = id;
        while at != 0 {
            let Some((parent, name)) = self.entries.get(at as usize) else {
                break;
            };
            names.push(name);
            at = *parent;
        }
        let mut out = Vec::new();
        for name in names.iter().rev() {
            out.extend_from_slice(name);
            out.push(b'/');
        }
        out
    }
}

fn bus_factor(owners: &[Owner], total: u32) -> u32 {
    let mut held = 0u32;
    for (i, owner) in owners.iter().enumerate() {
        held += owner.commits;
        if held as f64 > BUS_FACTOR_LINE * total as f64 {
            return i as u32 + 1;
        }
    }
    owners.len() as u32
}
