use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use commitscape_core::Oid;
use gix::objs::FindExt;

use super::{GixError, GixRepo};
use crate::source::BlobSink;

const BATCH: usize = 256;

const THREAD_DELTA_CACHE_BYTES: usize = 32 * 1024 * 1024;

pub(super) fn read(source: &GixRepo, blobs: &[Oid], sink: BlobSink<'_>) -> Result<(), GixError> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, 16)
        .min(blobs.len().div_ceil(BATCH).max(1));
    let next = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let first_error: Mutex<Option<GixError>> = Mutex::new(None);

    std::thread::scope(|scope| {
        for _ in 0..threads {
            let (next, failed, first_error) = (&next, &failed, &first_error);
            let sync = &source.sync;
            scope.spawn(move || {
                let repo = sync.to_thread_local();
                let mut objects = repo.objects.clone();
                objects.set_pack_cache(|| {
                    Box::new(gix::odb::pack::cache::lru::MemoryCappedHashmap::new(
                        THREAD_DELTA_CACHE_BYTES,
                    ))
                });
                let mut buf = Vec::new();
                loop {
                    if failed.load(Ordering::Relaxed) {
                        return;
                    }
                    let start = next.fetch_add(BATCH, Ordering::Relaxed);
                    let Some(chunk) = blobs.get(start..(start + BATCH).min(blobs.len())) else {
                        return;
                    };
                    if chunk.is_empty() {
                        return;
                    }
                    for (offset, id) in chunk.iter().enumerate() {
                        let found = gix::ObjectId::try_from(id.0.as_slice())
                            .ok()
                            .map(|oid| objects.find_blob(&oid, &mut buf));
                        match found {
                            Some(Ok(blob)) => sink(start + offset, blob.data),
                            Some(Err(e)) => {
                                failed.store(true, Ordering::Relaxed);
                                if let Ok(mut slot) = first_error.lock() {
                                    slot.get_or_insert(GixError::Git {
                                        context: "reading a file at HEAD",
                                        source: Box::new(e),
                                    });
                                }
                                return;
                            }
                            None => {}
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
