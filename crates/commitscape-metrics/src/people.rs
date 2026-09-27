//! Who changes what: Ownership, Bus Factor, and the people who might be one.

use std::collections::HashMap;

use commitscape_core::{AuthorId, FileId};
use serde::Serialize;

use crate::analysis::{counts, top, Analysis, Churn};

/// The share of a directory's commits that makes a group of people its
/// holders. Bus Factor counts how many people it takes to pass it.
const BUS_FACTOR_LINE: f64 = 0.8;

const DAY: i64 = 86_400;

/// One person's commits to a directory in the Window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Owner {
    pub author: AuthorId,
    pub commits: u32,
}

/// Ownership of one directory in the Window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirectoryOwnership {
    /// The directory as a path prefix ending in `/`; empty for the root.
    pub dir: Vec<u8>,
    /// Commits that touched a file people wrote under it.
    pub commits: u32,
    /// Everyone who made those commits, most commits first.
    pub owners: Vec<Owner>,
    /// The fewest people who together made more than 80% of them.
    pub bus_factor: u32,
}

impl DirectoryOwnership {
    /// The directory for display: its path, or `(root)` for the root, whose
    /// path is empty.
    pub fn label(&self) -> String {
        if self.dir.is_empty() {
            "(root)".to_string()
        } else {
            String::from_utf8_lossy(&self.dir).into_owned()
        }
    }
}

/// Ownership over the Window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Ownership {
    /// Directories with at least `ownership_min_commits` commits in the
    /// Window: every one ranked, not only those kept.
    pub directory_count: u32,
    /// Of those, how many one person holds.
    pub bus_factor_one: u32,
    /// Fewest owners first, then most commits.
    pub directories: Vec<DirectoryOwnership>,
}

impl Ownership {
    /// The folders one person holds (Bus Factor 1), leaving out any inside
    /// a folder the same person holds: `app/marketing/` says what
    /// `app/marketing/src/` would repeat. In ranking order.
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

/// A folder only one person committed to in the Window: what nobody else
/// knows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Silo {
    pub directory: DirectoryOwnership,
    pub holder: AuthorId,
    /// Who else made the most commits in the nearest folder around it that
    /// more than one person works in, and how many: who could take it over.
    pub successor: Option<(AuthorId, u32)>,
}

/// Someone who made commits in the Window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Contributor {
    pub author: AuthorId,
    /// Their commits in the Window that are not merges.
    pub commits: u32,
    /// Days on their calendar on which at least one of those commits landed.
    pub active_days: u32,
    /// When their earliest and latest commit landed, on their own clock
    /// ([`CommitMeta::landed_clock`](commitscape_core::CommitMeta::landed_clock)).
    pub first: i64,
    pub last: i64,
}

/// People who might be one person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SuspectedDuplicate {
    /// Most commits first: the first is who a suggestion keeps.
    pub people: Vec<AuthorId>,
    /// Commits by each, over all history, in the same order.
    pub commits: Vec<u32>,
}

impl Analysis<'_> {
    /// Ownership of every directory with enough commits in the Window.
    ///
    /// A commit counts once for each directory holding a file it touched, at
    /// every depth, as long as a person wrote the file and it exists at HEAD:
    /// knowing a deleted file, or a lockfile, is not knowing the directory.
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
        // Each touched file's directories, resolved once: `file_dirs[f]` is a
        // range of `dir_list`.
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

    /// Everyone who made commits in the Window, most commits first. Bots
    /// are listed by [`bots`](Self::bots) instead.
    pub fn contributors(&self) -> Vec<Contributor> {
        self.committers(false)
    }

    /// Commits that are not merges in the Window, and the people who made
    /// them, bots left out: all of them, where [`contributors`](Self::contributors)
    /// keeps the first [`RANKING_LIMIT`](crate::RANKING_LIMIT).
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

    /// The automation accounts that made commits in the Window, most commits
    /// first.
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

    /// The folders only one person committed to in the Window, a folder
    /// inside another of the same person's left out, most commits first.
    pub fn silos(&self) -> Vec<Silo> {
        self.silos_in(&self.ownership())
    }

    /// [`silos`](Self::silos) from Ownership already computed.
    pub fn silos_in(&self, ownership: &Ownership) -> Vec<Silo> {
        let single = |d: &DirectoryOwnership| d.owners.len() == 1;
        let mut out: Vec<Silo> = ownership
            .held_alone()
            .into_iter()
            .filter(|d| single(d))
            .filter_map(|d| {
                let holder = d.owners.first()?.author;
                // The nearest folder around it with more than one person.
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

    /// The files one person changed most in the Window, counting the same
    /// commits Churn does. Files people wrote at HEAD only, and no
    /// dependency manifests: a version bump is not work on the code.
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

    /// Who made the counted commits that touched one file, most first.
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

    /// People who might be one person (ADR-0006), each group with the most
    /// active person first. Never applied: a wrong merge makes Bus Factor
    /// confidently wrong, so the repository's owners decide, with
    /// [`mailmap_for`](Self::mailmap_for).
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

    /// The `.mailmap` lines that would resolve a group into its first
    /// person: one line for each signature of everyone else.
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

/// Directories met so far, each identified by its parent and last name, so
/// a lookup hashes one short component rather than a whole path.
#[derive(Default)]
struct DirTable {
    /// (parent, name) -> id. The root is id 0 and has no entry.
    ids: HashMap<(u32, Vec<u8>), u32>,
    /// id -> (parent, name).
    entries: Vec<(u32, Vec<u8>)>,
}

impl DirTable {
    /// Appends the ids of every directory above `path`, the root first.
    fn ancestors(&mut self, path: &[u8], out: &mut Vec<u32>) {
        if self.entries.is_empty() {
            self.entries.push((0, Vec::new()));
        }
        out.push(0);
        let mut parent = 0u32;
        let mut components = path.split(|&b| b == b'/').peekable();
        while let Some(component) = components.next() {
            // The last component is the file itself.
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

    /// A directory's path as a prefix ending in `/`; empty for the root.
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

/// The fewest owners, most commits first, who together hold more than 80%.
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
