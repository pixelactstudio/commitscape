//! The history walk, with tree diffs spread across threads.
//!
//! Two passes. The first walks the commit graph on one thread and records each
//! commit's tree, parents, time and author: cheap, because it decodes small
//! commit objects and nothing else. The second diffs every commit against its
//! parents. Each diff is independent of every other, and they are nearly all
//! of the cost, so they run on every core. Results reach the sink in walk
//! order regardless of which thread finished first.
//!
//! Memory stays bounded: the second pass hands out small batches and a bounded
//! channel stops workers from running far ahead of the sink.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::sync_channel;

use commitscape_core::Oid;
use gix::objs::FindExt;
use gix::ObjectId;

use super::tree_diff::{Changed, TreeDiffer};
use super::{GixError, GixRepo};
use crate::source::{CommitSink, Indexed, MessageFacts, RawChange, RawCommit, WalkStats};

/// Commits per unit of work handed to a diff thread. Consecutive commits
/// share most of their trees, so a batch keeps one thread's object cache warm.
const BATCH: usize = 64;

/// Upper bound on diff threads. Past this the object store, not the CPU, is
/// the limit.
const MAX_THREADS: usize = 16;

/// Decompressed objects each diff thread keeps. Tree diffing revisits parent
/// trees constantly, so this is the difference between re-inflating the same
/// objects and not.
const THREAD_OBJECT_CACHE_BYTES: usize = 16 * 1024 * 1024;

/// Delta bases each diff thread keeps. Trees in a large pack are nearly all
/// stored as deltas; without room for their bases, reading one tree means
/// re-inflating a chain of them.
const THREAD_DELTA_CACHE_BYTES: usize = 48 * 1024 * 1024;

/// How often, in commits, the sink hears about progress.
const PROGRESS_EVERY: u64 = 4096;

/// How many batches, per thread, may be finished but not yet delivered. The
/// sink consumes in walk order, so without a limit one slow batch would let
/// every other result pile up behind it.
const AHEAD_PER_THREAD: usize = 4;

/// What the first pass records about one commit.
struct Walked {
    id: ObjectId,
    time: i64,
    /// Index into the walk's signature list.
    signature: usize,
    author_time: i64,
    author_offset: i32,
    /// Read now: the message itself is not kept past this pass.
    message: MessageFacts,
    tree: ObjectId,
    parents: Vec<ObjectId>,
}

type BatchResult = Result<Vec<Vec<Changed>>, GixError>;

pub(super) fn walk(
    source: &GixRepo,
    indexed: &dyn Indexed,
    sink: &mut dyn CommitSink,
) -> Result<WalkStats, GixError> {
    let repo = &source.repo;
    let tips: Vec<ObjectId> = source.tips_gix()?.into_iter().map(|(_, id)| id).collect();

    let mut stats = WalkStats {
        history_truncated: repo.is_shallow(),
        ..WalkStats::default()
    };

    // Pass one: the graph, stopping at the first indexed commit on each path.
    // gix applies the predicate to the tips as well, so an unchanged branch
    // costs one lookup.
    let walk = git_ctx!(
        repo.rev_walk(tips).selected(|id| {
            Oid::from_bytes(id.as_bytes()).is_none_or(|oid| !indexed.contains(&oid))
        }),
        "starting the history walk"
    )?;
    let mut signatures: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    let mut signature_ids: HashMap<(Vec<u8>, Vec<u8>), usize> = HashMap::new();
    let mut walked: Vec<Walked> = Vec::new();
    let mut buf = Vec::new();
    for info in walk {
        let info = git_ctx!(info, "walking history")?;
        let commit = git_ctx!(
            repo.objects.find_commit(&info.id, &mut buf),
            "reading a commit"
        )?;
        let author = git_ctx!(commit.author(), "reading an author")?;
        let time = git_ctx!(commit.time(), "reading a commit time")?.seconds;
        // A malformed author date falls back to the committer's time.
        let written = author.time().unwrap_or(gix::date::Time {
            seconds: time,
            offset: 0,
        });
        let message = MessageFacts::read(commit.message, author.name, author.email);
        let key = (author.name.to_vec(), author.email.to_vec());
        let signature = match signature_ids.get(&key) {
            Some(&i) => i,
            None => {
                signatures.push(key.clone());
                signature_ids.insert(key, signatures.len() - 1);
                signatures.len() - 1
            }
        };
        walked.push(Walked {
            id: info.id,
            time,
            signature,
            author_time: written.seconds,
            author_offset: written.offset,
            message,
            tree: commit.tree(),
            parents: commit.parents().collect(),
        });
    }

    // Pass two: the diffs.
    let tree_of: HashMap<ObjectId, ObjectId> = walked.iter().map(|w| (w.id, w.tree)).collect();
    let total = walked.len() as u64;
    let batches = walked.len().div_ceil(BATCH);
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, MAX_THREADS)
        .min(batches.max(1));

    let next_batch = AtomicUsize::new(0);
    let delivered = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let ahead = threads * AHEAD_PER_THREAD;
    let (tx, rx) = sync_channel::<(usize, BatchResult)>(ahead);

    std::thread::scope(|scope| -> Result<(), GixError> {
        for _ in 0..threads {
            let tx = tx.clone();
            let (next_batch, delivered, stop) = (&next_batch, &delivered, &stop);
            let (walked, tree_of) = (&walked, &tree_of);
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
        let mut done = 0u64;
        let mut broke = false;
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
                        message: w.message,
                        parent_count: w.parents.len(),
                    };
                    stats.commits_visited += 1;
                    done += 1;
                    if done.is_multiple_of(PROGRESS_EVERY) || done == total {
                        sink.on_progress(done, total);
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
        // Dropping the receiver unblocks any worker waiting to send.
        drop(rx);
        outcome
    })?;

    Ok(stats)
}

/// Diffs one commit against all of its parents.
fn diff_one(
    repo: &gix::Repository,
    differ: &mut TreeDiffer,
    tree_of: &HashMap<ObjectId, ObjectId>,
    w: &Walked,
) -> Result<Vec<Changed>, GixError> {
    let mut parent_trees = Vec::with_capacity(w.parents.len());
    for parent in &w.parents {
        let tree = match tree_of.get(parent) {
            Some(t) => Some(*t),
            // Outside this walk: a frontier commit on a resume, or a parent a
            // shallow clone does not have. Absent reads as an empty tree, so
            // a shallow boundary's whole tree becomes additions, which is the
            // honest answer given the history we were handed.
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

/// The tree of a commit the walk did not visit, or `None` if it is absent.
fn tree_of_commit(repo: &gix::Repository, id: ObjectId) -> Result<Option<ObjectId>, GixError> {
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
