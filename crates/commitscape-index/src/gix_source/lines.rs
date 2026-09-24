//! The line pass (ADR-0012): each commit diffed against its parent again,
//! and every changed file's blobs, before and after, compared line by line.
//!
//! Separate from the history walk, which never reads a blob (ADR-0004), and
//! run after the first screen. Commits are handed out to one thread per core
//! in batches, each thread with its own object and delta-base caches, as the
//! walk's diffs are.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use commitscape_core::Oid;
use gix::objs::FindExt;
use gix::ObjectId;

use super::tree_diff::TreeDiffer;
use super::walk::tree_of_commit;
use super::{GixError, GixRepo};
use crate::lines::line_delta;
use crate::source::{LineSink, RawChange, RawChangeKind};

/// Commits per unit of work handed to a thread.
const BATCH: usize = 16;
const THREAD_OBJECT_CACHE_BYTES: usize = 16 * 1024 * 1024;
const THREAD_DELTA_CACHE_BYTES: usize = 48 * 1024 * 1024;

pub(super) fn count(source: &GixRepo, commits: &[Oid], sink: LineSink<'_>) -> Result<(), GixError> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, 16)
        .min(commits.len().div_ceil(BATCH).max(1));
    let next = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let first_error: Mutex<Option<GixError>> = Mutex::new(None);

    std::thread::scope(|scope| {
        for _ in 0..threads {
            let (next, failed, first_error) = (&next, &failed, &first_error);
            let sync = &source.sync;
            scope.spawn(move || {
                let mut repo = sync.to_thread_local();
                repo.object_cache_size_if_unset(THREAD_OBJECT_CACHE_BYTES);
                repo.objects.set_pack_cache(|| {
                    Box::new(gix::odb::pack::cache::lru::MemoryCappedHashmap::new(
                        THREAD_DELTA_CACHE_BYTES,
                    ))
                });
                let mut work = Work::new(&repo);
                loop {
                    if failed.load(Ordering::Relaxed) {
                        return;
                    }
                    let start = next.fetch_add(BATCH, Ordering::Relaxed);
                    let Some(chunk) = commits.get(start..(start + BATCH).min(commits.len())) else {
                        return;
                    };
                    if chunk.is_empty() {
                        return;
                    }
                    for id in chunk {
                        if let Err(e) = work.one(&repo, *id, sink) {
                            failed.store(true, Ordering::Relaxed);
                            if let Ok(mut slot) = first_error.lock() {
                                slot.get_or_insert(e);
                            }
                            return;
                        }
                    }
                }
            });
        }
    });

    match first_error.into_inner().ok().flatten() {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// One thread's reusable state.
struct Work {
    differ: TreeDiffer,
    commit: Vec<u8>,
    before: Vec<u8>,
    after: Vec<u8>,
    scratch: Vec<u8>,
    changed: Vec<super::tree_diff::Changed>,
}

impl Work {
    fn new(repo: &gix::Repository) -> Self {
        Work {
            differ: TreeDiffer::new(repo.object_hash()),
            commit: Vec::new(),
            before: Vec::new(),
            after: Vec::new(),
            scratch: Vec::new(),
            changed: Vec::new(),
        }
    }

    fn one(&mut self, repo: &gix::Repository, id: Oid, sink: LineSink<'_>) -> Result<(), GixError> {
        let oid = ObjectId::try_from(id.0.as_slice()).map_err(|e| GixError::Git {
            context: "reading a commit id",
            source: Box::new(e),
        })?;
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
            _ => return Ok(()),
        };
        self.changed.clear();
        self.differ
            .diff(&repo.objects, tree, &[parent_tree], &mut self.changed)
            .map_err(|source| GixError::Git {
                context: "diffing a commit for its lines",
                source,
            })?;

        let mut raws = Vec::with_capacity(self.changed.len());
        let mut deltas = Vec::with_capacity(self.changed.len());
        for c in &self.changed {
            let Some(blob) = Oid::from_bytes(c.blob.as_bytes()) else {
                continue;
            };
            raws.push(RawChange {
                path: &c.path,
                kind: c.kind,
                blob,
            });
            if c.symlink {
                deltas.push(None);
                continue;
            }
            let (before, after) = match c.kind {
                RawChangeKind::Added => (None, Some(c.blob)),
                RawChangeKind::Deleted => (Some(c.blob), None),
                RawChangeKind::Modified => (c.before, Some(c.blob)),
            };
            // The object's bytes are wherever the store put them in the
            // scratch buffer, so they are copied out rather than assumed to
            // start it.
            let mut read = |id: Option<ObjectId>, buf: &mut Vec<u8>| -> Result<(), GixError> {
                buf.clear();
                if let Some(id) = id {
                    let blob = repo
                        .objects
                        .find_blob(&id, &mut self.scratch)
                        .map_err(|e| GixError::Git {
                            context: "reading a blob for its lines",
                            source: Box::new(e),
                        })?;
                    buf.extend_from_slice(blob.data);
                }
                Ok(())
            };
            if c.kind == RawChangeKind::Modified && before.is_none() {
                deltas.push(None);
                continue;
            }
            read(before, &mut self.before)?;
            read(after, &mut self.after)?;
            deltas.push(line_delta(&self.before, &self.after));
        }
        sink(id, &raws, &deltas);
        Ok(())
    }
}
