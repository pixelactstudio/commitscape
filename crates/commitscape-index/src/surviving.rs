use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use commitscape_core::{AuthorId, ChangeKind, CommitFlags, FileClass, FileId, Index, Oid};

use crate::blame::{blame_in_threads, spans_at, BlameFile, Gone, Walked, BATCH_BYTES};
use crate::cache::{repo_dir, BlameStore, CacheOptions, Known, Moved};
use crate::commit_at::CommitAt;
use crate::lines::MAX_BYTES;
use crate::ownership::{own_in_threads, Known as Owners, Ownership, Writer};
use crate::similarity::rename_source;
use crate::source::{BlameSource, BlameThreads};

const ENGINE: u64 = 4;

/// Why working out the Ownership stopped: the repository could not be read, or the Ownership could not be kept.
#[derive(Debug, thiserror::Error)]
pub enum OwnError<E: std::error::Error + 'static> {
    #[error(transparent)]
    Source(E),
    #[error("could not keep the ownership of lines")]
    Kept(#[source] std::io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Survived {
    Counted {
        lines: u64,
        files: u32,
        oldest: Option<i64>,
    },
    OverBudget {
        files: u32,
    },
}

pub struct Survival<'i> {
    index: &'i Index,
    head: Oid,
    pass_through: HashSet<Oid>,
    known: Known,
    store: Option<BlameStore>,
    deletions: HashMap<FileId, Vec<usize>>,
    flows: HashMap<usize, Vec<(FileId, FileId)>>,
    paths: Option<HashMap<FileId, Vec<Vec<u8>>>>,
    commit_at: CommitAt,
    files_at: HashMap<Vec<u8>, Vec<FileId>>,
    batch_bytes: usize,
    settings: u64,
    kept: Option<PathBuf>,
}

impl<'i> Survival<'i> {
    /// Prepares to count Surviving Lines at the Index's head, passing Bulk Commits and `ignored` commits through, with each file's blame kept in the cache directory for that head.
    pub fn new(
        index: &'i Index,
        ignored: &[Oid],
        max_changeset_size: u32,
        options: &CacheOptions,
    ) -> Option<Self> {
        let head = index.head_commit?;
        let mut pass_through: HashSet<Oid> = index
            .commits
            .iter()
            .filter(|c| {
                !c.is_merge()
                    && (c.changes_len > max_changeset_size || c.flags.contains(CommitFlags::BULK))
            })
            .map(|c| c.id)
            .collect();
        pass_through.extend(ignored.iter().copied());
        let store = BlameStore::for_head(
            options,
            &index.repo,
            head,
            settings(max_changeset_size, ignored),
        );
        let known = store.as_ref().map(BlameStore::read).unwrap_or_default();
        let mut deletions: HashMap<FileId, Vec<usize>> = HashMap::new();
        for (i, c) in index.commits.iter().enumerate() {
            if c.is_merge() {
                continue;
            }
            for change in index.changes_of(c) {
                if change.kind == ChangeKind::Deleted {
                    deletions.entry(change.file).or_default().push(i);
                }
            }
        }
        Some(Survival {
            index,
            head,
            pass_through,
            known,
            store,
            deletions,
            flows: HashMap::new(),
            paths: None,
            commit_at: CommitAt::of(index),
            files_at: HashMap::new(),
            batch_bytes: BATCH_BYTES,
            settings: settings(max_changeset_size, ignored),
            kept: repo_dir(options, &index.repo).map(|d| d.join("ownership")),
        })
    }

    pub fn head(&self) -> Oid {
        self.head
    }

    /// The Ownership kept in the cache from the last count, when there is one.
    pub fn previous(&self) -> Option<Ownership> {
        self.kept.as_deref().and_then(Ownership::open)
    }

    fn author(&self, commit: &Oid) -> Option<(AuthorId, i64)> {
        let c = self.commit_at.get(self.index, commit)?;
        Some((self.index.author_of(c)?, c.time + i64::from(c.author_delta)))
    }

    /// Counts one person's Surviving Lines over the files at the head they ever changed, or says they are over budget.
    pub fn person<T: BlameThreads>(
        &mut self,
        threads: &T,
        person: AuthorId,
        budget: Duration,
    ) -> Result<Survived, <T::Local as BlameSource>::Error> {
        let source = threads.local();
        let source = &source;
        let deadline = Instant::now()
            .checked_add(budget)
            .unwrap_or_else(Instant::now);
        let Some(files) = self.files_of(source, person, deadline)? else {
            return Ok(Survived::OverBudget { files: 0 });
        };
        let count = files.len() as u32;
        let todo: Vec<BlameFile> = files
            .iter()
            .filter(|f| !self.known.files.contains_key(&f.path))
            .cloned()
            .collect();
        if !todo.is_empty() {
            if self.files_at.is_empty() {
                for (file, path) in self.index.paths.iter().chain(self.index.paths.departures()) {
                    self.files_at.entry(path.to_vec()).or_default().push(file);
                }
            }
            let Survival {
                index,
                head,
                pass_through,
                known,
                store,
                commit_at,
                files_at,
                batch_bytes,
                ..
            } = self;
            let index: &Index = index;
            let may_change = |commit: Oid, path: &[u8]| -> bool {
                let Some(c) = commit_at.get(index, &commit) else {
                    return true;
                };
                if c.is_merge() || c.flags.contains(CommitFlags::BULK) {
                    return true;
                }
                let Some(files) = files_at.get(path) else {
                    return true;
                };
                index
                    .changes_of(c)
                    .iter()
                    .any(|change| files.contains(&change.file))
            };
            let walked = blame_in_threads(
                threads,
                *head,
                &todo,
                pass_through,
                &may_change,
                Some(deadline),
                *batch_bytes,
                &mut |i, blamed| {
                    if let Some(file) = todo.get(i) {
                        if let Some(store) = store.as_ref() {
                            let _ = store.append_file(&file.path, &blamed);
                        }
                        known.files.insert(file.path.clone(), blamed);
                    }
                },
            )?;
            if walked == Walked::OutOfTime {
                return Ok(Survived::OverBudget { files: count });
            }
        }
        let theirs: Vec<(u64, i64)> = files
            .iter()
            .filter_map(|f| self.known.files.get(&f.path))
            .flatten()
            .filter(|(_, n)| *n > 0)
            .filter_map(|(commit, n)| match self.author(commit) {
                Some((author, time)) if author == person => Some((u64::from(*n), time)),
                _ => None,
            })
            .collect();
        Ok(Survived::Counted {
            lines: theirs.iter().map(|t| t.0).sum(),
            files: count,
            oldest: theirs.iter().map(|t| t.1).min(),
        })
    }

    fn head_files(&self) -> Vec<BlameFile> {
        let index = self.index;
        index
            .head
            .iter()
            .filter(|h| h.class == FileClass::Source && h.bytes <= MAX_BYTES as u64)
            .filter_map(|h| {
                Some(BlameFile {
                    path: index.paths.path_name(h.path)?.to_vec(),
                    blob: h.blob,
                })
            })
            .collect()
    }

    fn first_parent_line<S: BlameSource>(
        &self,
        source: &S,
        to: Oid,
    ) -> Result<Option<Vec<(Oid, Oid)>>, S::Error> {
        let mut edges = Vec::new();
        let mut at = self.head;
        for _ in 0..=self.index.commits.len() {
            if at == to {
                return Ok(Some(edges));
            }
            let Some(parent) = source
                .blame_commit(at)?
                .and_then(|c| c.parents.first().copied())
            else {
                return Ok(None);
            };
            edges.push((at, parent));
            at = parent;
        }
        Ok(None)
    }

    /// Works out who owns each line of the head's Source files, as blame would, carrying over from `previous` every file whose path no first-parent commit since its head changed, and stopping every other walk where it reaches that head with a file whose owners are known there. Past `deadline` it keeps what it finished, and says it is not complete.
    pub fn own<T: BlameThreads>(
        &mut self,
        threads: &T,
        previous: Option<Ownership>,
        deadline: Option<Instant>,
    ) -> Result<Ownership, OwnError<<T::Local as BlameSource>::Error>> {
        let source = threads.local();
        let files = self.head_files();
        let previous = previous.filter(|p| p.settings == self.settings && p.head.is_some());
        let mut out = Writer::create(
            self.kept.as_deref(),
            previous.as_ref(),
            Some(self.head),
            self.settings,
        )
        .map_err(OwnError::Kept)?;
        let mut carried: HashSet<Vec<u8>> = HashSet::new();
        if let Some(prev) = previous.as_ref() {
            let candidates: Vec<&BlameFile> = files
                .iter()
                .filter(|f| prev.get(&f.path).is_some_and(|o| o.blob == f.blob))
                .collect();
            let line = match prev.head {
                Some(h) => self
                    .first_parent_line(&source, h)
                    .map_err(OwnError::Source)?,
                None => None,
            };
            if let Some(edges) = line {
                let paths: Vec<&[u8]> = candidates.iter().map(|f| f.path.as_slice()).collect();
                let mut changed = vec![false; paths.len()];
                for (commit, parent) in edges {
                    let states = source
                        .blame_compare(commit, parent, &paths)
                        .map_err(OwnError::Source)?;
                    for (c, s) in changed.iter_mut().zip(states) {
                        *c |= s != crate::source::InParent::Same;
                    }
                }
                for (f, changed) in candidates.iter().zip(changed) {
                    if !changed && out.carry(&f.path).map_err(OwnError::Kept)? {
                        carried.insert(f.path.clone());
                    }
                }
            }
        }
        let todo: Vec<BlameFile> = files
            .into_iter()
            .filter(|f| !carried.contains(&f.path))
            .collect();
        drop(carried);
        if self.files_at.is_empty() {
            for (file, path) in self.index.paths.iter().chain(self.index.paths.departures()) {
                self.files_at.entry(path.to_vec()).or_default().push(file);
            }
        }
        let Survival {
            index,
            pass_through,
            commit_at,
            files_at,
            batch_bytes,
            head,
            ..
        } = self;
        let index: &Index = index;
        let may_change = |commit: Oid, path: &[u8]| -> bool {
            let Some(c) = commit_at.get(index, &commit) else {
                return true;
            };
            if c.is_merge() || c.flags.contains(CommitFlags::BULK) {
                return true;
            }
            let Some(files) = files_at.get(path) else {
                return true;
            };
            index
                .changes_of(c)
                .iter()
                .any(|change| files.contains(&change.file))
        };
        let known = previous.as_ref().and_then(|p| {
            Some(Owners {
                head: p.head?,
                ownership: p,
            })
        });
        let mut failed: Option<std::io::Error> = None;
        let walked = own_in_threads(
            threads,
            *head,
            &todo,
            pass_through,
            &may_change,
            known.as_ref(),
            deadline,
            *batch_bytes,
            &mut |i, owners| {
                if let (Some(f), None) = (todo.get(i), failed.as_ref()) {
                    if let Err(e) = out.add(f.path.clone(), f.blob, &owners) {
                        failed = Some(e);
                    }
                }
            },
        )
        .map_err(OwnError::Source)?;
        if let Some(e) = failed {
            return Err(OwnError::Kept(e));
        }
        let moves = previous
            .as_ref()
            .map(|p| p.moves.clone())
            .unwrap_or_default();
        out.finish(walked == Walked::Finished, moves)
            .map_err(OwnError::Kept)
    }

    /// Every person's Surviving Lines from the head's Ownership, as `person` counts them one by one: their lines in the head files they or the files they changed flowed into, with how many such files and when their oldest surviving line was written. None when the Ownership is not complete, or not of this head; the moves found on the way are kept in it.
    pub fn everyone<S: BlameSource>(
        &mut self,
        source: &S,
        ownership: &mut Ownership,
    ) -> Result<Option<Vec<(AuthorId, Survived)>>, S::Error> {
        if !ownership.complete || ownership.head != Some(self.head) {
            return Ok(None);
        }
        self.known
            .moves
            .extend(std::mem::take(&mut ownership.moves));
        let index = self.index;
        let head_files = self.head_files();
        let file_of_path: HashMap<&[u8], FileId> = index
            .head
            .iter()
            .filter_map(|h| Some((index.paths.path_name(h.path)?, h.file)))
            .collect();
        let mut owned: HashMap<AuthorId, Vec<(FileId, u64, i64)>> = HashMap::new();
        for f in &head_files {
            let Some(&file) = file_of_path.get(f.path.as_slice()) else {
                continue;
            };
            let mut by: HashMap<AuthorId, (u64, i64)> = HashMap::new();
            for (commit, n) in ownership.counts(&f.path) {
                if n == 0 {
                    continue;
                }
                if let Some((author, time)) = self.author(&commit) {
                    let e = by.entry(author).or_insert((0, i64::MAX));
                    e.0 += u64::from(n);
                    e.1 = e.1.min(time);
                }
            }
            for (author, (n, oldest)) in by {
                owned.entry(author).or_default().push((file, n, oldest));
            }
        }
        let mut touched: HashMap<AuthorId, HashSet<FileId>> = HashMap::new();
        for c in index.commits.iter() {
            if let Some(author) = index.author_of(c) {
                touched
                    .entry(author)
                    .or_default()
                    .extend(index.changes_of(c).iter().map(|ch| ch.file));
            }
        }
        let head_ids: HashSet<FileId> = head_files
            .iter()
            .filter_map(|f| file_of_path.get(f.path.as_slice()).copied())
            .collect();
        let mut people: Vec<AuthorId> = touched.keys().copied().collect();
        people.sort_unstable();
        let far = Instant::now()
            .checked_add(Duration::from_secs(365 * 24 * 3600))
            .unwrap_or_else(Instant::now);
        let mut out = Vec::with_capacity(people.len());
        for person in people {
            let Some(seen) =
                self.closure(source, touched.remove(&person).unwrap_or_default(), far)?
            else {
                continue;
            };
            let files = seen.iter().filter(|f| head_ids.contains(f)).count() as u32;
            let theirs: Vec<(u64, i64)> = owned
                .get(&person)
                .into_iter()
                .flatten()
                .filter(|(file, _, _)| seen.contains(file))
                .map(|&(_, n, t)| (n, t))
                .collect();
            out.push((
                person,
                Survived::Counted {
                    lines: theirs.iter().map(|t| t.0).sum(),
                    files,
                    oldest: theirs.iter().map(|t| t.1).min(),
                },
            ));
        }
        ownership.moves = std::mem::take(&mut self.known.moves);
        Ok(Some(out))
    }

    fn closure<S: BlameSource>(
        &mut self,
        source: &S,
        mut seen: HashSet<FileId>,
        deadline: Instant,
    ) -> Result<Option<HashSet<FileId>>, S::Error> {
        let mut queue: Vec<FileId> = seen.iter().copied().collect();
        while let Some(file) = queue.pop() {
            let commits = self.deletions.get(&file).cloned().unwrap_or_default();
            for commit in commits {
                let Some(flows) = self.flows_at(source, commit, deadline)? else {
                    return Ok(None);
                };
                for (from, to) in flows {
                    if from == file && seen.insert(to) {
                        queue.push(to);
                    }
                }
            }
        }
        Ok(Some(seen))
    }

    fn files_of<S: BlameSource>(
        &mut self,
        source: &S,
        person: AuthorId,
        deadline: Instant,
    ) -> Result<Option<Vec<BlameFile>>, S::Error> {
        let index = self.index;
        let touched: HashSet<FileId> = index
            .commits
            .iter()
            .filter(|c| index.author_of(c) == Some(person))
            .flat_map(|c| index.changes_of(c).iter().map(|ch| ch.file))
            .collect();
        let Some(seen) = self.closure(source, touched, deadline)? else {
            return Ok(None);
        };
        Ok(Some(
            index
                .head
                .iter()
                .filter(|h| {
                    h.class == FileClass::Source
                        && h.bytes <= MAX_BYTES as u64
                        && seen.contains(&h.file)
                })
                .filter_map(|h| {
                    Some(BlameFile {
                        path: index.paths.path_name(h.path)?.to_vec(),
                        blob: h.blob,
                    })
                })
                .collect(),
        ))
    }

    fn flows_at<S: BlameSource>(
        &mut self,
        source: &S,
        at: usize,
        deadline: Instant,
    ) -> Result<Option<Vec<(FileId, FileId)>>, S::Error> {
        if let Some(found) = self.flows.get(&at) {
            return Ok(Some(found.clone()));
        }
        let index = self.index;
        let Some(commit) = index.commits.get(at) else {
            return Ok(Some(Vec::new()));
        };
        let of_kind = |kind: ChangeKind| -> Vec<FileId> {
            index
                .changes_of(commit)
                .iter()
                .filter(|c| c.kind == kind)
                .map(|c| c.file)
                .collect()
        };
        let (gone, born) = (of_kind(ChangeKind::Deleted), of_kind(ChangeKind::Added));
        let moved = if gone.is_empty() || born.is_empty() {
            Vec::new()
        } else if let Some(moved) = self.known.moves.get(&commit.id) {
            moved.clone()
        } else {
            if Instant::now() >= deadline {
                return Ok(None);
            }
            let moved = moves_in(source, commit.id)?;
            if let Some(store) = &self.store {
                let _ = store.append_moves(commit.id, &moved);
            }
            self.known.moves.insert(commit.id, moved.clone());
            moved
        };
        let paths = self.paths.get_or_insert_with(|| {
            let mut paths: HashMap<FileId, Vec<Vec<u8>>> = HashMap::new();
            for (file, path) in index.paths.iter().chain(index.paths.departures()) {
                paths.entry(file).or_default().push(path.to_vec());
            }
            paths
        });
        let file_at = |files: &[FileId], path: &[u8]| {
            files
                .iter()
                .copied()
                .find(|f| paths.get(f).is_some_and(|ps| ps.iter().any(|p| p == path)))
        };
        let found: Vec<(FileId, FileId)> = moved
            .iter()
            .filter_map(|(from, to)| Some((file_at(&gone, from)?, file_at(&born, to)?)))
            .collect();
        self.flows.insert(at, found.clone());
        Ok(Some(found))
    }
}

fn moves_in<S: BlameSource>(source: &S, commit: Oid) -> Result<Moved, S::Error> {
    let parents = source
        .blame_commit(commit)?
        .map(|c| c.parents)
        .unwrap_or_default();
    let [parent] = parents.as_slice() else {
        return Ok(Vec::new());
    };
    let moves = source.blame_moves(commit, *parent)?;
    let Gone {
        deleted,
        mut spans,
        mut sizes,
    } = Gone::new(moves.deleted);
    let mut out = Vec::new();
    for (path, blob) in &moves.added {
        let data = source.blame_blob(*blob)?;
        let target = data.len() as u64;
        let found = rename_source((path, *blob, &data), &deleted, &mut |i| {
            spans_at(source, &deleted, (&mut spans, &mut sizes), i, target)
        })?;
        if let Some((from, _)) = found.and_then(|j| deleted.get(j)) {
            out.push((from.clone(), path.clone()));
        }
    }
    Ok(out)
}

fn settings(max_changeset_size: u32, ignored: &[Oid]) -> u64 {
    let mut ids = ignored.to_vec();
    ids.sort_unstable();
    ids.dedup();
    let mut h = xxhash_rust::xxh3::Xxh3::new();
    h.update(&ENGINE.to_le_bytes());
    h.update(&max_changeset_size.to_le_bytes());
    for id in ids {
        h.update(&id.0);
    }
    h.digest()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index_from_scratch;
    use crate::scripted::{synthetic_oid, ScriptedRepo};
    use crate::source::RawChangeKind::{Added, Deleted, Modified};

    const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
    const BOB: (&str, &str) = ("Bob Example", "bob@example.com");
    const CAROL: (&str, &str) = ("Carol Example", "carol@example.com");
    const MINUTE: Duration = Duration::from_secs(60);

    fn blob(n: u8) -> Oid {
        Oid([
            0xb0, n, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ])
    }

    fn person(index: &Index, name: &str) -> AuthorId {
        index
            .authors
            .iter()
            .find(|(_, a)| a.name == name)
            .map(|(id, _)| id)
            .unwrap()
    }

    fn count(repo: &ScriptedRepo, max: u32, names: &[&str]) -> Vec<u64> {
        let index = index_from_scratch(repo).unwrap();
        let ignored = repo.blame_ignore_revs().unwrap();
        let mut survival = Survival::new(&index, &ignored, max, &CacheOptions::default()).unwrap();
        names
            .iter()
            .map(
                |name| match survival.person(repo, person(&index, name), MINUTE).unwrap() {
                    Survived::Counted { lines, .. } => lines,
                    Survived::OverBudget { .. } => unreachable!(),
                },
            )
            .collect()
    }

    use crate::source::RepoSource;

    fn overwritten_and_renamed() -> ScriptedRepo {
        ScriptedRepo::new()
            .blob(blob(1), "a1\na2\na3\na4\n")
            .blob(blob(2), "a1\nb2\nb3\na4\nb5\n")
            .blob(blob(3), "a1\nb2\nc3\na4\nb5\n")
            .commit(1, ALICE, &[(b"src/a.rs", Added, blob(1))])
            .commit(2, BOB, &[(b"src/a.rs", Modified, blob(2))])
            .commit(
                3,
                CAROL,
                &[
                    (b"src/a.rs", Deleted, blob(2)),
                    (b"lib/a.rs", Added, blob(2)),
                ],
            )
            .commit(4, CAROL, &[(b"lib/a.rs", Modified, blob(3))])
            .head_file(b"lib/a.rs", "a1\nb2\nc3\na4\nb5\n")
    }

    #[test]
    fn blaming_one_file_per_walk_counts_the_same_as_one_walk_for_all() {
        let repo = ScriptedRepo::new()
            .blob(blob(1), "a1\na2\n")
            .blob(blob(2), "x1\nx2\nx3\n")
            .blob(blob(3), "a1\nb2\nb3\n")
            .blob(blob(4), "x1\nc2\nx3\n")
            .commit(
                1,
                ALICE,
                &[(b"src/a.rs", Added, blob(1)), (b"src/x.rs", Added, blob(2))],
            )
            .commit(2, BOB, &[(b"src/a.rs", Modified, blob(3))])
            .commit(3, CAROL, &[(b"src/x.rs", Modified, blob(4))])
            .head_file(b"src/a.rs", "a1\nb2\nb3\n")
            .head_file(b"src/x.rs", "x1\nc2\nx3\n");
        let index = index_from_scratch(&repo).unwrap();
        let ignored = repo.blame_ignore_revs().unwrap();
        let counted = |batch_bytes: usize| -> Vec<u64> {
            let mut survival =
                Survival::new(&index, &ignored, 50, &CacheOptions::default()).unwrap();
            survival.batch_bytes = batch_bytes;
            ["Alice Example", "Bob Example", "Carol Example"]
                .iter()
                .map(|name| {
                    match survival
                        .person(&repo, person(&index, name), MINUTE)
                        .unwrap()
                    {
                        Survived::Counted { lines, .. } => lines,
                        Survived::OverBudget { .. } => unreachable!(),
                    }
                })
                .collect()
        };
        assert_eq!(counted(1), [3, 2, 1]);
        assert_eq!(counted(1), counted(BATCH_BYTES));
    }

    #[test]
    fn lines_belong_to_who_wrote_them_through_overwrites_and_a_rename() {
        let repo = overwritten_and_renamed();
        assert_eq!(
            count(
                &repo,
                50,
                &["Alice Example", "Bob Example", "Carol Example"]
            ),
            [2, 2, 1]
        );
    }

    fn reformatted() -> ScriptedRepo {
        ScriptedRepo::new()
            .blob(blob(1), "x1\nx2\nx3\n")
            .blob(blob(2), "  x1\n  x2\n  x3\n  y4\n")
            .blob(blob(3), "\tx1\n\tz1b\n  x2\n  x3\n  y4\n")
            .blob(blob(4), "b\n")
            .blob(blob(5), "c\n")
            .commit(1, ALICE, &[(b"a.rs", Added, blob(1))])
            .commit(
                2,
                BOB,
                &[
                    (b"a.rs", Modified, blob(2)),
                    (b"b.rs", Added, blob(4)),
                    (b"c.rs", Added, blob(5)),
                ],
            )
            .commit(3, CAROL, &[(b"a.rs", Modified, blob(3))])
            .head_file(b"a.rs", "\tx1\n\tz1b\n  x2\n  x3\n  y4\n")
            .head_file(b"b.rs", "b\n")
            .head_file(b"c.rs", "c\n")
    }

    #[test]
    fn a_bulk_commit_passes_reindented_lines_back_and_keeps_the_lines_it_added() {
        let repo = reformatted();
        assert_eq!(
            count(&repo, 2, &["Alice Example", "Bob Example", "Carol Example"]),
            [2, 3, 2]
        );
        assert_eq!(
            count(
                &repo,
                50,
                &["Alice Example", "Bob Example", "Carol Example"]
            ),
            [0, 5, 2]
        );
    }

    #[test]
    fn an_ignored_commit_passes_back_what_only_changed_in_whitespace_and_keeps_the_rest() {
        let ignored = format!("# tabs\n{}\n\n", &synthetic_oid(3).to_hex()[..8]);
        let repo = reformatted().head_file(b".git-blame-ignore-revs", &ignored);
        assert_eq!(
            count(&repo, 2, &["Alice Example", "Bob Example", "Carol Example"]),
            [3, 3, 1]
        );
    }

    fn merged() -> ScriptedRepo {
        ScriptedRepo::new()
            .blob(blob(1), "m1\nm2\n")
            .blob(blob(2), "m1\nm2\nb3\n")
            .blob(blob(3), "s1\n")
            .commit(1, ALICE, &[(b"m.rs", Added, blob(1))])
            .commit(2, BOB, &[(b"m.rs", Modified, blob(2))])
            .at(1)
            .commit(3, CAROL, &[(b"side.rs", Added, blob(3))])
            .at(2)
            .merge(4, ALICE, 3, &[(b"side.rs", Added, blob(3))])
            .head_file(b"m.rs", "m1\nm2\nb3\n")
            .head_file(b"side.rs", "s1\n")
    }

    #[test]
    fn a_merge_passes_each_file_to_the_parent_it_came_from() {
        let repo = merged();
        assert_eq!(
            count(
                &repo,
                50,
                &["Alice Example", "Bob Example", "Carol Example"]
            ),
            [2, 1, 1]
        );
    }

    fn moved_and_edited() -> ScriptedRepo {
        ScriptedRepo::new()
            .blob(
                blob(1),
                "first line\nsecond line\nthird line\nfourth line\n",
            )
            .blob(
                blob(2),
                "first line\nsecond line\nthird line\nfourth line\nfifth line\n",
            )
            .blob(
                blob(3),
                "first line\nsecond line\nthird line\nchanged line\nfifth line\n",
            )
            .commit(1, ALICE, &[(b"src/old.rs", Added, blob(1))])
            .commit(2, BOB, &[(b"src/old.rs", Modified, blob(2))])
            .commit(
                3,
                CAROL,
                &[
                    (b"src/old.rs", Deleted, blob(2)),
                    (b"lib/new.rs", Added, blob(3)),
                ],
            )
            .head_file(
                b"lib/new.rs",
                "first line\nsecond line\nthird line\nchanged line\nfifth line\n",
            )
    }

    #[test]
    fn a_file_moved_and_edited_keeps_its_lines_and_its_people() {
        let repo = moved_and_edited();
        assert_eq!(
            count(
                &repo,
                50,
                &["Alice Example", "Bob Example", "Carol Example"]
            ),
            [3, 1, 1]
        );
    }

    #[test]
    fn over_budget_is_not_counted_and_files_blamed_once_are_kept_for_the_head() {
        let repo = overwritten_and_renamed();
        let index = index_from_scratch(&repo).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let options = CacheOptions {
            root: Some(dir.path().to_path_buf()),
            key: None,
        };
        let alice = person(&index, "Alice Example");
        let carol = person(&index, "Carol Example");

        let mut cold = Survival::new(&index, &[], 50, &options).unwrap();
        assert_eq!(
            cold.person(&repo, alice, Duration::ZERO).unwrap(),
            Survived::OverBudget { files: 1 }
        );
        assert_eq!(
            cold.person(&repo, alice, MINUTE).unwrap(),
            Survived::Counted {
                lines: 2,
                files: 1,
                oldest: Some(1)
            }
        );

        let mut warm = Survival::new(&index, &[], 50, &options).unwrap();
        assert_eq!(
            warm.person(&repo, carol, Duration::ZERO).unwrap(),
            Survived::Counted {
                lines: 1,
                files: 1,
                oldest: Some(4)
            }
        );

        let mut other = Survival::new(&index, &[], 3, &options).unwrap();
        assert_eq!(
            other.person(&repo, carol, Duration::ZERO).unwrap(),
            Survived::OverBudget { files: 1 }
        );
    }

    #[test]
    fn someone_who_changed_no_file_at_the_head_has_nothing_to_blame() {
        let repo = ScriptedRepo::new()
            .blob(blob(1), "a\n")
            .commit(1, ALICE, &[(b"a.rs", Added, blob(1))])
            .commit(2, BOB, &[(b"notes.md", Added, blob(1))])
            .head_file(b"a.rs", "a\n")
            .head_file(b"notes.md", "a\n");
        let index = index_from_scratch(&repo).unwrap();
        let mut survival = Survival::new(&index, &[], 50, &CacheOptions::default()).unwrap();
        assert_eq!(
            survival
                .person(&repo, person(&index, "Bob Example"), Duration::ZERO)
                .unwrap(),
            Survived::Counted {
                lines: 0,
                files: 0,
                oldest: None
            }
        );
    }

    fn lines_of(o: &Ownership, path: &[u8]) -> Vec<Oid> {
        o.get(path)
            .and_then(|f| o.lines(path, f.blob))
            .unwrap_or_default()
    }

    fn same_as_blame(repo: &ScriptedRepo, max: u32) -> Ownership {
        let index = index_from_scratch(repo).unwrap();
        let ignored = repo.blame_ignore_revs().unwrap();
        let mut survival = Survival::new(&index, &ignored, max, &CacheOptions::default()).unwrap();
        let mut ownership = survival.own(repo, None, None).unwrap();
        assert!(ownership.complete);
        let kept = ownership.clone();
        let everyone = survival.everyone(repo, &mut ownership).unwrap().unwrap();
        let mut oracle = Survival::new(&index, &ignored, max, &CacheOptions::default()).unwrap();
        assert!(!everyone.is_empty());
        for (person, found) in everyone {
            assert_eq!(
                oracle.person(repo, person, MINUTE).unwrap(),
                found,
                "{person:?}"
            );
        }
        kept
    }

    #[test]
    fn everyones_lines_from_the_ownership_are_each_persons_lines_from_blame() {
        let ignored = format!("# tabs\n{}\n\n", &synthetic_oid(3).to_hex()[..8]);
        for (repo, max) in [
            (overwritten_and_renamed(), 50),
            (reformatted(), 2),
            (reformatted(), 50),
            (
                reformatted().head_file(b".git-blame-ignore-revs", &ignored),
                2,
            ),
            (merged(), 50),
            (moved_and_edited(), 50),
        ] {
            same_as_blame(&repo, max);
        }
    }

    fn grown(steps: usize) -> ScriptedRepo {
        let texts = [
            "a1\na2\na3\n",
            "a1\nb2\na3\nb4\n",
            "s1\n",
            "a1\nb2\nc3\na3\nb4\n",
            "x1\nx2\n",
            "a1\nb2\nc3\na3\nb4\nd6\n",
            "s1\ns2\n",
            "x1\ny2\n",
        ];
        let mut repo = ScriptedRepo::new();
        for (i, t) in texts.iter().enumerate() {
            repo = repo.blob(blob(i as u8 + 1), t);
        }
        let all: Vec<Box<dyn Fn(ScriptedRepo) -> ScriptedRepo>> = vec![
            Box::new(|r| {
                r.commit(
                    1,
                    ALICE,
                    &[(b"src/a.rs", Added, blob(1)), (b"src/x.rs", Added, blob(5))],
                )
                .head_file(b"src/a.rs", "a1\na2\na3\n")
                .head_file(b"src/x.rs", "x1\nx2\n")
            }),
            Box::new(|r| {
                r.commit(2, BOB, &[(b"src/a.rs", Modified, blob(2))])
                    .head_file(b"src/a.rs", "a1\nb2\na3\nb4\n")
            }),
            Box::new(|r| {
                r.at(1)
                    .commit(3, CAROL, &[(b"src/s.rs", Added, blob(3))])
                    .at(2)
            }),
            Box::new(|r| {
                r.merge(4, ALICE, 3, &[(b"src/s.rs", Added, blob(3))])
                    .head_file(b"src/s.rs", "s1\n")
            }),
            Box::new(|r| {
                r.commit(5, CAROL, &[(b"src/a.rs", Modified, blob(4))])
                    .head_file(b"src/a.rs", "a1\nb2\nc3\na3\nb4\n")
            }),
            Box::new(|r| {
                r.at(5)
                    .commit(6, BOB, &[(b"src/s.rs", Modified, blob(7))])
                    .at(5)
                    .commit(7, ALICE, &[(b"src/a.rs", Modified, blob(6))])
                    .merge(8, CAROL, 6, &[(b"src/s.rs", Modified, blob(7))])
                    .head_file(b"src/a.rs", "a1\nb2\nc3\na3\nb4\nd6\n")
                    .head_file(b"src/s.rs", "s1\ns2\n")
            }),
            Box::new(|r| {
                r.commit(9, CAROL, &[(b"src/x.rs", Modified, blob(8))])
                    .commit(10, BOB, &[(b"src/x.rs", Modified, blob(5))])
            }),
        ];
        all.iter().take(steps).fold(repo, |r, step| step(r))
    }

    #[test]
    fn a_later_head_carries_over_what_did_not_change_and_works_out_the_rest_as_blame_does() {
        let dir = tempfile::tempdir().unwrap();
        let options = CacheOptions {
            root: Some(dir.path().to_path_buf()),
            key: Some("acme/grown".to_string()),
        };
        for steps in [1, 2, 4, 5, 6, 7] {
            let repo = grown(steps);
            let index = index_from_scratch(&repo).unwrap();
            let mut survival = Survival::new(&index, &[], 50, &options).unwrap();
            let fresh = same_as_blame(&repo, 50);
            let previous = survival.previous();
            assert_eq!(previous.is_some(), steps > 1, "step {steps}");
            let mut carried = survival.own(&repo, previous, None).unwrap();
            assert!(carried.complete);
            assert!(survival.everyone(&repo, &mut carried).unwrap().is_some());
            carried.keep_moves().unwrap();
            assert_eq!(
                carried.paths().collect::<Vec<_>>(),
                fresh.paths().collect::<Vec<_>>()
            );
            for path in fresh.paths() {
                assert_eq!(
                    lines_of(&carried, path),
                    lines_of(&fresh, path),
                    "step {steps}: {}",
                    String::from_utf8_lossy(path)
                );
            }
        }
    }

    #[test]
    fn ownership_cut_short_keeps_what_it_finished_and_the_next_run_finishes_it() {
        let repo = grown(6);
        let index = index_from_scratch(&repo).unwrap();
        let mut survival = Survival::new(&index, &[], 50, &CacheOptions::default()).unwrap();
        let cut = survival.own(&repo, None, Some(Instant::now())).unwrap();
        assert!(!cut.complete);
        let mut ownership = survival.own(&repo, Some(cut), None).unwrap();
        assert!(ownership.complete);
        assert!(survival.everyone(&repo, &mut ownership).unwrap().is_some());
        let fresh = same_as_blame(&repo, 50);
        for path in fresh.paths() {
            assert_eq!(lines_of(&ownership, path), lines_of(&fresh, path));
        }
    }
}
