use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use commitscape_core::{LineDelta, Oid};
use gix::objs::{FindExt, FindHeader};
use gix::ObjectId;

use super::tree_diff::{Changed, TreeDiffer};
use super::walk::tree_of_commit;
use super::{GixError, GixRepo};
use crate::lines::{is_binary, line_delta, MAX_BYTES};
use crate::source::{LineSink, RawChange, RawChangeKind};

const COMMIT_BATCH: usize = 16;
const PAIR_BATCH: usize = 32;
const THREAD_OBJECT_CACHE_BYTES: usize = 16 * 1024 * 1024;
const THREAD_DELTA_CACHE_BYTES: usize = 48 * 1024 * 1024;
const RECENT_BLOBS: usize = 4;

pub(super) fn count(source: &GixRepo, commits: &[Oid], sink: LineSink<'_>) -> Result<(), GixError> {
    let diffs = in_parallel(
        source,
        commits,
        COMMIT_BATCH,
        |repo| {
            repo.object_cache_size_if_unset(THREAD_OBJECT_CACHE_BYTES);
            Differ::new(repo)
        },
        |differ, repo, id| differ.one(repo, *id),
    )?;

    let mut slots: HashMap<(Option<ObjectId>, ObjectId), usize> = HashMap::new();
    let mut pairs: Vec<Pair<'_>> = Vec::new();
    let mut wanted: Vec<Vec<Option<usize>>> = Vec::with_capacity(diffs.len());
    for (at, changed) in diffs.iter().enumerate() {
        let Some(changed) = changed else {
            wanted.push(Vec::new());
            continue;
        };
        let mut want = Vec::with_capacity(changed.len());
        for c in changed {
            if Oid::from_bytes(c.blob.as_bytes()).is_none() {
                continue;
            }
            let pair = match c.kind {
                _ if c.symlink => None,
                RawChangeKind::Added => Some((None, c.blob, false)),
                RawChangeKind::Deleted => Some((None, c.blob, true)),
                RawChangeKind::Modified => c.before.map(|b| (Some(b), c.blob, false)),
            };
            want.push(pair.map(|(before, after, deleted)| {
                let key = (before, after);
                let slot = *slots.entry(key).or_insert_with(|| {
                    pairs.push(Pair {
                        path: &c.path,
                        newest: at,
                        before,
                        after,
                    });
                    pairs.len() - 1
                });
                if let Some(p) = pairs.get_mut(slot) {
                    p.newest = p.newest.max(at);
                }
                (slot << 1) | usize::from(deleted)
            }));
        }
        wanted.push(want);
    }
    drop(slots);

    let mut order: Vec<usize> = (0..pairs.len()).collect();
    order.sort_unstable_by_key(|&i| pairs.get(i).map(|p| (p.path, p.newest)));
    let counted = in_parallel(
        source,
        &order,
        PAIR_BATCH,
        |repo| {
            repo.object_cache_size(0);
            Blobs::new()
        },
        |blobs, repo, &i| match pairs.get(i) {
            Some(p) => blobs.count(repo, p.before, p.after),
            None => Ok(None),
        },
    )?;
    let mut by_pair = vec![None; pairs.len()];
    for (&i, delta) in order.iter().zip(counted) {
        if let Some(slot) = by_pair.get_mut(i) {
            *slot = delta;
        }
    }

    for ((id, changed), want) in commits.iter().zip(&diffs).zip(&wanted) {
        let Some(changed) = changed else {
            continue;
        };
        let raws: Vec<RawChange<'_>> = changed
            .iter()
            .filter_map(|c| {
                Some(RawChange {
                    path: &c.path,
                    kind: c.kind,
                    blob: Oid::from_bytes(c.blob.as_bytes())?,
                })
            })
            .collect();
        let deltas: Vec<Option<LineDelta>> = want
            .iter()
            .map(|w| {
                let w = (*w)?;
                let d = by_pair.get(w >> 1).copied().flatten()?;
                Some(if w & 1 == 1 {
                    LineDelta {
                        added: d.removed,
                        removed: d.added,
                    }
                } else {
                    d
                })
            })
            .collect();
        sink(*id, &raws, &deltas);
    }
    Ok(())
}

struct Pair<'a> {
    path: &'a [u8],
    newest: usize,
    before: Option<ObjectId>,
    after: ObjectId,
}

fn in_parallel<I, T, S>(
    source: &GixRepo,
    items: &[I],
    batch: usize,
    init: impl Fn(&mut gix::Repository) -> S + Sync,
    work: impl Fn(&mut S, &gix::Repository, &I) -> Result<T, GixError> + Sync,
) -> Result<Vec<T>, GixError>
where
    I: Sync,
    T: Send,
{
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, 16)
        .min(items.len().div_ceil(batch).max(1));
    let next = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let first_error: Mutex<Option<GixError>> = Mutex::new(None);
    let done: Mutex<Vec<(usize, Vec<T>)>> = Mutex::new(Vec::new());

    std::thread::scope(|scope| {
        for _ in 0..threads {
            let (next, failed, first_error, done) = (&next, &failed, &first_error, &done);
            let (init, work) = (&init, &work);
            let sync = &source.sync;
            scope.spawn(move || {
                let mut repo = sync.to_thread_local();
                repo.objects.set_pack_cache(|| {
                    Box::new(gix::odb::pack::cache::lru::MemoryCappedHashmap::new(
                        THREAD_DELTA_CACHE_BYTES,
                    ))
                });
                let mut state = init(&mut repo);
                let mut mine = Vec::new();
                loop {
                    if failed.load(Ordering::Relaxed) {
                        break;
                    }
                    let start = next.fetch_add(batch, Ordering::Relaxed);
                    let Some(chunk) = items.get(start..(start + batch).min(items.len())) else {
                        break;
                    };
                    if chunk.is_empty() {
                        break;
                    }
                    let mut out = Vec::with_capacity(chunk.len());
                    for item in chunk {
                        match work(&mut state, &repo, item) {
                            Ok(t) => out.push(t),
                            Err(e) => {
                                failed.store(true, Ordering::Relaxed);
                                if let Ok(mut slot) = first_error.lock() {
                                    slot.get_or_insert(e);
                                }
                                return;
                            }
                        }
                    }
                    mine.push((start, out));
                }
                if let Ok(mut d) = done.lock() {
                    d.append(&mut mine);
                }
            });
        }
    });

    if let Some(e) = first_error.into_inner().ok().flatten() {
        return Err(e);
    }
    let mut done = done.into_inner().unwrap_or_default();
    done.sort_unstable_by_key(|(start, _)| *start);
    Ok(done.into_iter().flat_map(|(_, out)| out).collect())
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

    fn one(&mut self, repo: &gix::Repository, id: Oid) -> Result<Option<Vec<Changed>>, GixError> {
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

struct Blobs {
    recent: Vec<(ObjectId, Vec<u8>)>,
    scratch: Vec<u8>,
}

impl Blobs {
    fn new() -> Self {
        Blobs {
            recent: Vec::with_capacity(RECENT_BLOBS),
            scratch: Vec::new(),
        }
    }

    fn count(
        &mut self,
        repo: &gix::Repository,
        before: Option<ObjectId>,
        after: ObjectId,
    ) -> Result<Option<LineDelta>, GixError> {
        for id in before.iter().chain(std::iter::once(&after)) {
            if self.too_big(repo, id)? {
                return Ok(None);
            }
        }
        if let Some(id) = before {
            self.load(repo, id)?;
            let bytes = self.bytes(Some(id));
            if bytes.len() > MAX_BYTES || is_binary(bytes) {
                return Ok(None);
            }
        }
        self.load(repo, after)?;
        Ok(line_delta(self.bytes(before), self.bytes(Some(after))))
    }

    fn bytes(&self, id: Option<ObjectId>) -> &[u8] {
        id.and_then(|id| self.recent.iter().find(|(r, _)| *r == id))
            .map_or(&[][..], |(_, b)| b.as_slice())
    }

    fn too_big(&self, repo: &gix::Repository, id: &ObjectId) -> Result<bool, GixError> {
        if let Some((_, b)) = self.recent.iter().find(|(r, _)| r == id) {
            return Ok(b.len() > MAX_BYTES);
        }
        let header = repo
            .objects
            .try_header(id)
            .map_err(|source| GixError::Git {
                context: "reading the size of a blob for its lines",
                source,
            })?;
        Ok(header.is_some_and(|h| h.size > MAX_BYTES as u64))
    }

    fn load(&mut self, repo: &gix::Repository, id: ObjectId) -> Result<(), GixError> {
        if let Some(at) = self.recent.iter().position(|(r, _)| *r == id) {
            if let Some(hit) = self.recent.get_mut(at..) {
                hit.rotate_left(1);
            }
            return Ok(());
        }
        let mut kept = if self.recent.len() >= RECENT_BLOBS {
            self.recent.remove(0).1
        } else {
            Vec::new()
        };
        let blob = repo
            .objects
            .find_blob(&id, &mut self.scratch)
            .map_err(|e| GixError::Git {
                context: "reading a blob for its lines",
                source: Box::new(e),
            })?;
        kept.clear();
        kept.extend_from_slice(blob.data);
        self.recent.push((id, kept));
        Ok(())
    }
}
