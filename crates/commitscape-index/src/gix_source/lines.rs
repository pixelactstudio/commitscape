use std::hash::{Hash, Hasher};
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::time::Instant;

use commitscape_core::{LineDelta, Oid};
use gix::objs::{Find, FindExt, FindHeader};
use gix::odb::pack::cache::lru::MemoryCappedHashmap;
use gix::ObjectId;

use super::tree_diff::{Changed, TreeDiffer};
use super::walk::tree_of_commit;
use super::{GixError, GixRepo};
use crate::build::{pair_exact_renames, Resolved};
use crate::lines::{is_binary, line_delta, MAX_BYTES};
use crate::source::{LineSink, LineWork, RawChange, RawChangeKind};

const COMMIT_BATCH: usize = 16;
const PAIR_BATCH: usize = 32;
const FIRST_SEGMENT: usize = 1_024;
const LARGEST_SEGMENT: usize = 16_384;
const TREE_OBJECT_CACHE_BYTES: usize = 1024 * 1024;
const TREE_DELTA_CACHE_BYTES: usize = 2 * 1024 * 1024;
const BLOB_DELTA_CACHE_BYTES: usize = 3 * 1024 * 1024;
const RECENT_BLOBS: usize = 4;

pub(super) fn count(
    source: &GixRepo,
    work: &[LineWork<'_>],
    until: Option<Instant>,
    sink: LineSink<'_>,
) -> Result<(), GixError> {
    if work.is_empty() {
        return Ok(());
    }
    let threads = crate::threads::threads(work.len().div_ceil(COMMIT_BATCH));
    std::thread::scope(|scope| {
        let pool = Pool::start(scope, &source.sync, threads);
        let mut start = 0;
        let mut size = FIRST_SEGMENT;
        while let Some(segment) = work
            .get(start..(start + size).min(work.len()))
            .map(one_part)
            .filter(|s| !s.is_empty())
        {
            if past(until) || !count_segment(&pool, segment, until, sink)? {
                break;
            }
            start += segment.len();
            size = (size * 2).min(LARGEST_SEGMENT);
        }
        Ok(())
    })
}

fn one_part<'a, 'b>(segment: &'a [LineWork<'b>]) -> &'a [LineWork<'b>] {
    let first = segment.first().map(|w| w.mainline);
    let end = segment
        .iter()
        .position(|w| Some(w.mainline) != first)
        .unwrap_or(segment.len());
    segment.get(..end).unwrap_or(segment)
}

fn past(until: Option<Instant>) -> bool {
    until.is_some_and(|t| Instant::now() >= t)
}

struct Commit<'a> {
    raws: Vec<RawChange<'a>>,
    want: Vec<Option<usize>>,
}

struct Pair<'a> {
    path: &'a [u8],
    newest: i64,
    before: Option<ObjectId>,
    after: ObjectId,
}

#[derive(PartialEq, Eq)]
struct PairKey {
    before: Option<ObjectId>,
    after: ObjectId,
}

impl Hash for PairKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.after.hash(state);
    }
}

fn count_segment(
    pool: &Pool,
    segment: &[LineWork<'_>],
    until: Option<Instant>,
    sink: LineSink<'_>,
) -> Result<bool, GixError> {
    let ids = segment
        .iter()
        .map(|w| {
            ObjectId::try_from(w.id.0.as_slice()).map_err(|e| GixError::Git {
                context: "reading a commit id",
                source: Box::new(e),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut diffs: Vec<Option<Option<Vec<Changed>>>> = (0..segment.len()).map(|_| None).collect();
    for (start, out) in pool.run(Task::Diff(ids), until)? {
        if let Output::Diffs(found) = out {
            for (slot, d) in diffs.iter_mut().skip(start).zip(found) {
                *slot = Some(d);
            }
        }
    }
    if diffs.iter().any(Option::is_none) {
        return Ok(false);
    }

    let mut slots: gix::hashtable::HashMap<PairKey, usize> = gix::hashtable::HashMap::default();
    let mut pairs: Vec<Pair<'_>> = Vec::new();
    let mut commits: Vec<Option<Commit<'_>>> = Vec::with_capacity(segment.len());
    for (w, diff) in segment.iter().zip(&diffs) {
        let Some(Some(changed)) = diff else {
            commits.push(None);
            continue;
        };
        let kept: Vec<(&Changed, Oid)> = changed
            .iter()
            .filter_map(|c| Some((c, Oid::from_bytes(c.blob.as_bytes())?)))
            .collect();
        let raws: Vec<RawChange<'_>> = kept
            .iter()
            .map(|&(c, blob)| RawChange {
                path: &c.path,
                kind: c.kind,
                blob,
            })
            .collect();
        let mut counts = vec![false; raws.len()];
        for (j, resolved) in pair_exact_renames(&raws).iter().enumerate() {
            if let Resolved::Plain { raw, .. } = resolved {
                if !w.skip.get(j).copied().unwrap_or(false) {
                    if let Some(c) = counts.get_mut(*raw) {
                        *c = true;
                    }
                }
            }
        }
        let mut want = Vec::with_capacity(kept.len());
        for (&(c, _), counted) in kept.iter().zip(counts) {
            let pair = match c.kind {
                _ if c.symlink || !counted => None,
                RawChangeKind::Added => Some((None, false)),
                RawChangeKind::Deleted => Some((None, true)),
                RawChangeKind::Modified => c.before.map(|b| (Some(b), false)),
            };
            want.push(pair.map(|(before, deleted)| {
                let key = PairKey {
                    before,
                    after: c.blob,
                };
                let slot = *slots.entry(key).or_insert_with(|| {
                    pairs.push(Pair {
                        path: &c.path,
                        newest: w.time,
                        before,
                        after: c.blob,
                    });
                    pairs.len() - 1
                });
                if let Some(p) = pairs.get_mut(slot) {
                    p.newest = p.newest.max(w.time);
                }
                (slot << 1) | usize::from(deleted)
            }));
        }
        commits.push(Some(Commit { raws, want }));
    }
    drop(slots);

    let mut order: Vec<usize> = (0..pairs.len()).collect();
    order.sort_unstable_by_key(|&i| pairs.get(i).map(|p| (p.path, p.newest)));
    let wanted: Vec<(Option<ObjectId>, ObjectId)> = order
        .iter()
        .filter_map(|&i| pairs.get(i).map(|p| (p.before, p.after)))
        .collect();
    let mut by_pair: Vec<Option<Counted>> = vec![None; pairs.len()];
    for (start, out) in pool.run(Task::Count(wanted), until)? {
        if let Output::Counts(found) = out {
            for (k, delta) in found.into_iter().enumerate() {
                if let Some(slot) = order.get(start + k).and_then(|&i| by_pair.get_mut(i)) {
                    *slot = Some(delta);
                }
            }
        }
    }

    let mut finished = true;
    for (w, commit) in segment.iter().zip(&commits) {
        let Some(commit) = commit else {
            continue;
        };
        let mut deltas: Vec<Option<LineDelta>> = Vec::with_capacity(commit.want.len());
        let mut reached = true;
        let mut missing = false;
        for want in &commit.want {
            let Some(want) = want else {
                deltas.push(None);
                continue;
            };
            match by_pair.get(want >> 1).copied().flatten() {
                None => reached = false,
                Some(Counted::Missing) => missing = true,
                Some(Counted::Lines(counted)) => deltas.push(counted.map(|d| {
                    if want & 1 == 1 {
                        LineDelta {
                            added: d.removed,
                            removed: d.added,
                        }
                    } else {
                        d
                    }
                })),
            }
        }
        if !reached {
            finished = false;
        } else if !missing {
            sink(w.id, &commit.raws, &deltas);
        }
    }
    Ok(finished)
}

enum Task {
    Diff(Vec<ObjectId>),
    Count(Vec<(Option<ObjectId>, ObjectId)>),
}

#[derive(Clone, Copy)]
enum Counted {
    Lines(Option<LineDelta>),
    Missing,
}

enum Output {
    Diffs(Vec<Option<Vec<Changed>>>),
    Counts(Vec<Counted>),
}

type Done = Result<Vec<(usize, Output)>, GixError>;

struct Job {
    task: Task,
    next: AtomicUsize,
    stop: AtomicBool,
    until: Option<Instant>,
}

impl Job {
    fn halted(&self) -> bool {
        self.stop.load(Ordering::Relaxed) || past(self.until)
    }

    fn claim<'a, T>(&self, items: &'a [T], batch: usize) -> Option<(usize, &'a [T])> {
        if self.halted() {
            return None;
        }
        let start = self.next.fetch_add(batch, Ordering::Relaxed);
        let chunk = items.get(start..(start + batch).min(items.len()))?;
        (!chunk.is_empty()).then_some((start, chunk))
    }

    fn failed(&self, e: GixError) -> Done {
        self.stop.store(true, Ordering::Relaxed);
        Err(e)
    }
}

struct Pool {
    jobs: Vec<Sender<Arc<Job>>>,
    done: Receiver<Done>,
}

impl Pool {
    fn start<'scope, 'env>(
        scope: &'scope std::thread::Scope<'scope, 'env>,
        sync: &'env gix::ThreadSafeRepository,
        threads: usize,
    ) -> Pool {
        let (finished, done) = channel::<Done>();
        let mut jobs = Vec::with_capacity(threads);
        for _ in 0..threads {
            let (send, receive) = channel::<Arc<Job>>();
            jobs.push(send);
            let finished = finished.clone();
            scope.spawn(move || {
                let mut worker = Worker::new(sync);
                for job in receive {
                    let done = std::panic::catch_unwind(AssertUnwindSafe(|| worker.run(&job)))
                        .unwrap_or_else(|_| {
                            job.failed(GixError::Git {
                                context: "counting lines on a thread",
                                source: Box::new(std::io::Error::other("the thread stopped")),
                            })
                        });
                    if finished.send(done).is_err() {
                        break;
                    }
                }
            });
        }
        Pool { jobs, done }
    }

    fn run(&self, task: Task, until: Option<Instant>) -> Result<Vec<(usize, Output)>, GixError> {
        let job = Arc::new(Job {
            task,
            next: AtomicUsize::new(0),
            stop: AtomicBool::new(false),
            until,
        });
        let sent = self
            .jobs
            .iter()
            .filter(|send| send.send(Arc::clone(&job)).is_ok())
            .count();
        let mut out = Vec::new();
        let mut error = None;
        for _ in 0..sent {
            match self.done.recv() {
                Ok(Ok(mut batches)) => out.append(&mut batches),
                Ok(Err(e)) => {
                    job.stop.store(true, Ordering::Relaxed);
                    error.get_or_insert(e);
                }
                Err(_) => break,
            }
        }
        match error {
            Some(e) => Err(e),
            None => Ok(out),
        }
    }
}

struct Worker {
    trees: gix::Repository,
    blobs: gix::Repository,
    differ: Differ,
    recent: Blobs,
}

impl Worker {
    fn new(sync: &gix::ThreadSafeRepository) -> Worker {
        let mut trees = sync.to_thread_local();
        trees.object_cache_size(TREE_OBJECT_CACHE_BYTES);
        trees
            .objects
            .set_pack_cache(|| Box::new(MemoryCappedHashmap::new(TREE_DELTA_CACHE_BYTES)));
        let mut blobs = sync.to_thread_local();
        blobs.object_cache_size(0);
        blobs
            .objects
            .set_pack_cache(|| Box::new(MemoryCappedHashmap::new(BLOB_DELTA_CACHE_BYTES)));
        Worker {
            differ: Differ::new(&trees),
            trees,
            blobs,
            recent: Blobs::new(),
        }
    }

    fn run(&mut self, job: &Job) -> Done {
        let mut out = Vec::new();
        match &job.task {
            Task::Diff(commits) => {
                while let Some((start, chunk)) = job.claim(commits, COMMIT_BATCH) {
                    let mut found = Vec::with_capacity(chunk.len());
                    for id in chunk {
                        if job.halted() {
                            break;
                        }
                        match self.differ.one(&self.trees, *id) {
                            Ok(changed) => found.push(changed),
                            Err(e) => return job.failed(e),
                        }
                    }
                    out.push((start, Output::Diffs(found)));
                }
            }
            Task::Count(pairs) => {
                while let Some((start, chunk)) = job.claim(pairs, PAIR_BATCH) {
                    let mut found = Vec::with_capacity(chunk.len());
                    for (before, after) in chunk {
                        if job.halted() {
                            break;
                        }
                        match self.recent.count(&self.blobs, *before, *after) {
                            Ok(delta) => found.push(delta),
                            Err(e) => return job.failed(e),
                        }
                    }
                    out.push((start, Output::Counts(found)));
                }
            }
        }
        Ok(out)
    }
}

struct Differ {
    differ: TreeDiffer,
    commit: Vec<u8>,
}

impl Differ {
    fn new(repo: &gix::Repository) -> Self {
        Differ {
            differ: TreeDiffer::new(repo.object_hash()),
            commit: Vec::new(),
        }
    }

    fn one(
        &mut self,
        repo: &gix::Repository,
        oid: ObjectId,
    ) -> Result<Option<Vec<Changed>>, GixError> {
        let (tree, parents) = {
            let commit = repo
                .objects
                .find_commit(&oid, &mut self.commit)
                .map_err(|e| GixError::Git {
                    context: "reading a commit for its lines",
                    source: Box::new(e),
                })?;
            (commit.tree(), commit.parents().collect::<Vec<_>>())
        };
        let parent_tree = match parents.as_slice() {
            [] => None,
            [parent] => tree_of_commit(repo, *parent)?,
            _ => return Ok(None),
        };
        let mut changed = Vec::new();
        self.differ
            .diff(&repo.objects, tree, &[parent_tree], &mut changed)
            .map_err(|source| GixError::Git {
                context: "diffing a commit for its lines",
                source,
            })?;
        Ok(Some(changed))
    }
}

struct Recent {
    id: ObjectId,
    bytes: Vec<u8>,
    big: bool,
}

struct Blobs {
    recent: Vec<Recent>,
}

impl Blobs {
    fn new() -> Self {
        Blobs {
            recent: Vec::with_capacity(RECENT_BLOBS),
        }
    }

    fn count(
        &mut self,
        repo: &gix::Repository,
        before: Option<ObjectId>,
        after: ObjectId,
    ) -> Result<Counted, GixError> {
        let mut hint = None;
        if let Some(id) = before {
            match self.load(repo, id, None)? {
                None => return Ok(Counted::Missing),
                Some(false) => return Ok(Counted::Lines(None)),
                Some(true) => {}
            }
            let bytes = self.bytes(Some(id));
            if is_binary(bytes) {
                return Ok(Counted::Lines(None));
            }
            hint = Some(bytes.len());
        }
        match self.load(repo, after, hint)? {
            None => return Ok(Counted::Missing),
            Some(false) => return Ok(Counted::Lines(None)),
            Some(true) => {}
        }
        Ok(Counted::Lines(line_delta(
            self.bytes(before),
            self.bytes(Some(after)),
        )))
    }

    fn bytes(&self, id: Option<ObjectId>) -> &[u8] {
        id.and_then(|id| self.recent.iter().find(|r| r.id == id))
            .map_or(&[][..], |r| r.bytes.as_slice())
    }

    fn load(
        &mut self,
        repo: &gix::Repository,
        id: ObjectId,
        hint: Option<usize>,
    ) -> Result<Option<bool>, GixError> {
        if let Some(at) = self.recent.iter().position(|r| r.id == id) {
            let big = self.recent.get(at).is_some_and(|r| r.big);
            if let Some(hit) = self.recent.get_mut(at..) {
                hit.rotate_left(1);
            }
            return Ok(Some(!big));
        }
        let unsure = hint.is_none_or(|n| n > MAX_BYTES / 2);
        if unsure {
            match self.size_of(repo, &id)? {
                None => return Ok(None),
                Some(size) if size > MAX_BYTES as u64 => {
                    self.keep(id, Vec::new(), true);
                    return Ok(Some(false));
                }
                Some(_) => {}
            }
        }
        let mut bytes = if self.recent.len() >= RECENT_BLOBS {
            self.recent.remove(0).bytes
        } else {
            Vec::new()
        };
        let found = repo
            .objects
            .try_find(&id, &mut bytes)
            .map_err(|source| GixError::Git {
                context: "reading a blob for its lines",
                source,
            })?;
        let Some(size) = found.map(|d| d.data.len()) else {
            return Ok(None);
        };
        bytes.truncate(size);
        let big = size > MAX_BYTES;
        if big {
            bytes = Vec::new();
        }
        self.keep(id, bytes, big);
        Ok(Some(!big))
    }

    fn keep(&mut self, id: ObjectId, bytes: Vec<u8>, big: bool) {
        if self.recent.len() >= RECENT_BLOBS {
            self.recent.remove(0);
        }
        self.recent.push(Recent { id, bytes, big });
    }

    fn size_of(&self, repo: &gix::Repository, id: &ObjectId) -> Result<Option<u64>, GixError> {
        let header = repo
            .objects
            .try_header(id)
            .map_err(|source| GixError::Git {
                context: "reading the size of a blob for its lines",
                source,
            })?;
        Ok(header.map(|h| h.size))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work(mainline: &[bool]) -> Vec<LineWork<'static>> {
        mainline
            .iter()
            .enumerate()
            .map(|(i, &mainline)| LineWork {
                id: Oid([i as u8; 20]),
                time: 0,
                mainline,
                skip: &[],
            })
            .collect()
    }

    #[test]
    fn a_segment_ends_where_the_mainline_does() {
        let all = work(&[true, true, false, false]);
        assert_eq!(one_part(&all).len(), 2);
        assert_eq!(one_part(all.get(2..).unwrap_or_default()).len(), 2);
        assert!(one_part(&[]).is_empty());
    }
}
