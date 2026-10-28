use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::sync_channel;

use commitscape_core::Oid;
use gix::objs::FindExt;
use gix::ObjectId;

use super::tree_diff::{Changed, TreeDiffer};
use super::{GixError, GixRepo};
use crate::hash_index::HashIndex;
use crate::message;
use crate::source::{CommitSink, Indexed, RawChange, RawCommit, WalkStats};

const BATCH: usize = 64;

const CHUNK: usize = 32_768;

const THREAD_OBJECT_CACHE_BYTES: usize = 1024 * 1024;

const THREAD_DELTA_CACHE_BYTES: usize = 3 * 1024 * 1024;

const PROGRESS_EVERY: u64 = 4096;

const AHEAD_PER_THREAD: usize = 4;

struct Walked {
    id: ObjectId,
    time: i64,
    signature: usize,
    author_time: i64,
    author_offset: i32,
    kind: commitscape_core::CommitKind,
    subject: Box<str>,
    tree: ObjectId,
    parents: Vec<ObjectId>,
}

type BatchResult = Result<Vec<Vec<Changed>>, GixError>;

struct Signatures {
    list: Vec<(Vec<u8>, Vec<u8>)>,
    ids: HashIndex,
}

impl Signatures {
    fn of(&mut self, name: &[u8], email: &[u8]) -> usize {
        let hash = signature_hash(name, email);
        let list = &self.list;
        let found = self.ids.get(hash, |i| {
            list.get(i as usize)
                .is_some_and(|(n, e)| n.as_slice() == name && e.as_slice() == email)
        });
        match found {
            Some(i) => i as usize,
            None => {
                self.list.push((name.to_vec(), email.to_vec()));
                self.ids.insert(hash, (self.list.len() - 1) as u32);
                self.list.len() - 1
            }
        }
    }
}

pub(super) fn walk(
    source: &GixRepo,
    indexed: &dyn Indexed,
    sink: &mut dyn CommitSink,
) -> Result<WalkStats, GixError> {
    walk_in(source, indexed, sink, CHUNK)
}

fn walk_in(
    source: &GixRepo,
    indexed: &dyn Indexed,
    sink: &mut dyn CommitSink,
    chunk: usize,
) -> Result<WalkStats, GixError> {
    let repo = &source.repo;
    let tips: Vec<ObjectId> = source.tips_gix()?.into_iter().map(|(_, id)| id).collect();

    let mut stats = WalkStats {
        history_truncated: repo.is_shallow(),
        ..WalkStats::default()
    };

    let mut walk = git_ctx!(
        repo.rev_walk(tips).selected(|id| {
            Oid::from_bytes(id.as_bytes()).is_none_or(|oid| !indexed.contains(&oid))
        }),
        "starting the history walk"
    )?;
    let mut signatures = Signatures {
        list: Vec::new(),
        ids: HashIndex::default(),
    };
    let mut buf = Vec::new();
    let mut read =
        |walked: &mut Vec<Walked>, signatures: &mut Signatures| -> Result<(), GixError> {
            while walked.len() < chunk {
                let Some(info) = walk.next() else {
                    break;
                };
                let info = git_ctx!(info, "walking history")?;
                let commit = git_ctx!(
                    repo.objects.find_commit(&info.id, &mut buf),
                    "reading a commit"
                )?;
                let author = git_ctx!(commit.author(), "reading an author")?;
                let time = git_ctx!(commit.time(), "reading a commit time")?.seconds;
                let written = author.time().unwrap_or(gix::date::Time {
                    seconds: time,
                    offset: 0,
                });
                walked.push(Walked {
                    id: info.id,
                    time,
                    signature: signatures.of(author.name, author.email),
                    author_time: written.seconds,
                    author_offset: written.offset,
                    kind: message::kind_of(commit.message),
                    subject: message::subject_of(commit.message).into_boxed_str(),
                    tree: commit.tree(),
                    parents: commit.parents().collect(),
                });
            }
            Ok(())
        };

    let mut current: Vec<Walked> = Vec::new();
    read(&mut current, &mut signatures)?;
    let mut done = 0u64;
    while !current.is_empty() {
        let mut next: Vec<Walked> = Vec::new();
        read(&mut next, &mut signatures)?;
        let tree_of: gix::hashtable::HashMap<ObjectId, ObjectId> = current
            .iter()
            .chain(&next)
            .map(|w| (w.id, w.tree))
            .collect();
        let total = done + (current.len() + next.len()) as u64;
        let delivered = deliver(
            source,
            &current,
            &tree_of,
            &signatures.list,
            sink,
            &mut stats,
            (&mut done, total),
        )?;
        if !delivered {
            break;
        }
        current = next;
    }
    Ok(stats)
}

/// Diffs a chunk of walked commits on several threads and hands them to the sink in walk order; false when the sink asked to stop.
fn deliver(
    source: &GixRepo,
    walked: &[Walked],
    tree_of: &gix::hashtable::HashMap<ObjectId, ObjectId>,
    signatures: &[(Vec<u8>, Vec<u8>)],
    sink: &mut dyn CommitSink,
    stats: &mut WalkStats,
    (done, total): (&mut u64, u64),
) -> Result<bool, GixError> {
    let threads = crate::threads::threads(walked.len().div_ceil(BATCH));
    let next_batch = AtomicUsize::new(0);
    let delivered = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let ahead = threads * AHEAD_PER_THREAD;
    let (tx, rx) = sync_channel::<(usize, BatchResult)>(ahead);
    let mut broke = false;

    std::thread::scope(|scope| -> Result<(), GixError> {
        for _ in 0..threads {
            let tx = tx.clone();
            let (next_batch, delivered, stop) = (&next_batch, &delivered, &stop);
            let sync = &source.sync;
            scope.spawn(move || {
                let mut repo = sync.to_thread_local();
                repo.object_cache_size_if_unset(THREAD_OBJECT_CACHE_BYTES);
                repo.objects.set_pack_cache(|| {
                    Box::new(gix::odb::pack::cache::lru::MemoryCappedHashmap::new(
                        THREAD_DELTA_CACHE_BYTES,
                    ))
                });
                let mut differ = TreeDiffer::new(repo.object_hash());
                loop {
                    let batch = next_batch.fetch_add(1, Ordering::Relaxed);
                    while batch >= delivered.load(Ordering::Acquire) + ahead {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_micros(200));
                    }
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let start = batch * BATCH;
                    let Some(chunk) = walked.get(start..(start + BATCH).min(walked.len())) else {
                        break;
                    };
                    if chunk.is_empty() {
                        break;
                    }
                    let result = chunk
                        .iter()
                        .map(|w| diff_one(&repo, &mut differ, tree_of, w))
                        .collect::<Result<Vec<_>, _>>();
                    if tx.send((batch, result)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);

        let mut waiting: BTreeMap<usize, BatchResult> = BTreeMap::new();
        let mut want = 0usize;
        let mut outcome = Ok(());
        'receive: for (batch, result) in &rx {
            waiting.insert(batch, result);
            while let Some(result) = waiting.remove(&want) {
                let changes = match result {
                    Ok(c) => c,
                    Err(e) => {
                        outcome = Err(e);
                        break 'receive;
                    }
                };
                let chunk = walked.get(want * BATCH..).unwrap_or(&[]);
                for (w, changed) in chunk.iter().zip(changes) {
                    let raw_changes: Vec<RawChange<'_>> = changed
                        .iter()
                        .filter_map(|c| {
                            Some(RawChange {
                                path: &c.path,
                                kind: c.kind,
                                blob: Oid::from_bytes(c.blob.as_bytes())?,
                            })
                        })
                        .collect();
                    let (name, email) = signatures
                        .get(w.signature)
                        .map(|(n, e)| (n.as_slice(), e.as_slice()))
                        .unwrap_or((&[], &[]));
                    let id = match GixRepo::to_oid(w.id.as_ref()) {
                        Ok(id) => id,
                        Err(e) => {
                            outcome = Err(e);
                            break 'receive;
                        }
                    };
                    let raw = RawCommit {
                        id,
                        time: w.time,
                        author_name: name,
                        author_email: email,
                        author_time: w.author_time,
                        author_offset: w.author_offset,
                        kind: w.kind,
                        subject: &w.subject,
                        parent_count: w.parents.len(),
                    };
                    stats.commits_visited += 1;
                    *done += 1;
                    if done.is_multiple_of(PROGRESS_EVERY) || *done == total {
                        sink.on_progress(*done, total);
                    }
                    if sink.on_commit(&raw, &raw_changes).is_break() {
                        broke = true;
                        break 'receive;
                    }
                }
                want += 1;
                delivered.store(want, Ordering::Release);
            }
        }
        if broke || outcome.is_err() {
            stop.store(true, Ordering::Relaxed);
        }
        drop(rx);
        outcome
    })?;
    Ok(!broke)
}

fn diff_one(
    repo: &gix::Repository,
    differ: &mut TreeDiffer,
    tree_of: &gix::hashtable::HashMap<ObjectId, ObjectId>,
    w: &Walked,
) -> Result<Vec<Changed>, GixError> {
    let mut parent_trees = Vec::with_capacity(w.parents.len());
    for parent in &w.parents {
        let tree = match tree_of.get(parent) {
            Some(t) => Some(*t),
            None => tree_of_commit(repo, *parent)?,
        };
        parent_trees.push(tree);
    }
    let mut out = Vec::new();
    differ
        .diff(&repo.objects, w.tree, &parent_trees, &mut out)
        .map_err(|source| GixError::Git {
            context: "diffing a commit against its parents",
            source,
        })?;
    Ok(out)
}

fn signature_hash(name: &[u8], email: &[u8]) -> u64 {
    let mut h = xxhash_rust::xxh3::Xxh3::new();
    h.update(&(name.len() as u64).to_le_bytes());
    h.update(name);
    h.update(email);
    h.digest()
}

pub(super) fn tree_of_commit(
    repo: &gix::Repository,
    id: ObjectId,
) -> Result<Option<ObjectId>, GixError> {
    let mut buf = Vec::new();
    let found = gix::objs::Find::try_find(&repo.objects, &id, &mut buf).map_err(|source| {
        GixError::Git {
            context: "reading a parent commit",
            source,
        }
    })?;
    let Some(data) = found else {
        return Ok(None);
    };
    let commit = git_ctx!(data.decode(), "decoding a parent commit")?;
    Ok(commit.as_commit().map(|c| c.tree()))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use std::collections::HashSet;
    use std::ops::ControlFlow;
    use std::path::Path;

    use super::*;

    type Changes = Vec<(Vec<u8>, Oid)>;

    #[derive(Default)]
    struct Seen(Vec<(Oid, String, Changes)>);

    impl CommitSink for Seen {
        fn on_commit(
            &mut self,
            commit: &RawCommit<'_>,
            changes: &[RawChange<'_>],
        ) -> ControlFlow<()> {
            self.0.push((
                commit.id,
                commit.subject.to_string(),
                changes.iter().map(|c| (c.path.to_vec(), c.blob)).collect(),
            ));
            ControlFlow::Continue(())
        }
    }

    #[test]
    fn a_history_walked_a_few_commits_at_a_time_is_the_history_walked_at_once() {
        let repo =
            GixRepo::open(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/merges"))
                .expect("the merges fixture");
        let (mut whole, mut chunked) = (Seen::default(), Seen::default());
        walk_in(&repo, &HashSet::new(), &mut whole, CHUNK).expect("walked");
        walk_in(&repo, &HashSet::new(), &mut chunked, 3).expect("walked");
        assert!(whole.0.len() > 6);
        assert!(whole.0.iter().any(|c| !c.2.is_empty()));
        assert_eq!(whole.0, chunked.0);
    }
}
