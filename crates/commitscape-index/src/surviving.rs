use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use commitscape_core::{AuthorId, ChangeKind, CommitFlags, FileClass, FileId, Index, Oid};

use crate::blame::{blame_in_threads, spans_at, BlameFile, Walked};
use crate::cache::{BlameStore, CacheOptions, Known, Moved};
use crate::lines::MAX_BYTES;
use crate::similarity::rename_source;
use crate::source::{BlameSource, BlameThreads};

const ENGINE: u64 = 4;

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
    authors: HashMap<Oid, (AuthorId, i64)>,
    known: Known,
    store: Option<BlameStore>,
    deletions: HashMap<FileId, Vec<usize>>,
    flows: HashMap<usize, Vec<(FileId, FileId)>>,
    paths: Option<HashMap<FileId, Vec<Vec<u8>>>>,
    commit_at: HashMap<Oid, usize>,
    files_at: HashMap<Vec<u8>, Vec<FileId>>,
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
        let authors = index
            .commits
            .iter()
            .filter_map(|c| {
                Some((
                    c.id,
                    (index.author_of(c)?, c.time + i64::from(c.author_delta)),
                ))
            })
            .collect();
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
            authors,
            known,
            store,
            deletions,
            flows: HashMap::new(),
            paths: None,
            commit_at: index
                .commits
                .iter()
                .enumerate()
                .map(|(i, c)| (c.id, i))
                .collect(),
            files_at: HashMap::new(),
        })
    }

    pub fn head(&self) -> Oid {
        self.head
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
                ..
            } = self;
            let index: &Index = index;
            let may_change = |commit: Oid, path: &[u8]| -> bool {
                let Some(c) = commit_at.get(&commit).and_then(|&i| index.commits.get(i)) else {
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
            .filter_map(|(commit, n)| match self.authors.get(commit) {
                Some((author, time)) if *author == person => Some((u64::from(*n), *time)),
                _ => None,
            })
            .collect();
        Ok(Survived::Counted {
            lines: theirs.iter().map(|t| t.0).sum(),
            files: count,
            oldest: theirs.iter().map(|t| t.1).min(),
        })
    }

    fn files_of<S: BlameSource>(
        &mut self,
        source: &S,
        person: AuthorId,
        deadline: Instant,
    ) -> Result<Option<Vec<BlameFile>>, S::Error> {
        let index = self.index;
        let mut seen: HashSet<FileId> = index
            .commits
            .iter()
            .filter(|c| index.author_of(c) == Some(person))
            .flat_map(|c| index.changes_of(c).iter().map(|ch| ch.file))
            .collect();
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
    let mut texts = vec![None; moves.deleted.len()];
    let mut out = Vec::new();
    for (path, blob) in &moves.added {
        let data = source.blame_blob(*blob)?;
        let found = rename_source((path, *blob, &data), &moves.deleted, &mut |i| {
            spans_at(source, &moves.deleted, &mut texts, i)
        })?;
        if let Some((from, _)) = found.and_then(|j| moves.deleted.get(j)) {
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

    #[test]
    fn a_merge_passes_each_file_to_the_parent_it_came_from() {
        let repo = ScriptedRepo::new()
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
            .head_file(b"side.rs", "s1\n");
        assert_eq!(
            count(
                &repo,
                50,
                &["Alice Example", "Bob Example", "Carol Example"]
            ),
            [2, 1, 1]
        );
    }

    #[test]
    fn a_file_moved_and_edited_keeps_its_lines_and_its_people() {
        let repo = ScriptedRepo::new()
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
            );
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
}
