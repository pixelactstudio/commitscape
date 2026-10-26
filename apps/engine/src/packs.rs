use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use sha2::{Digest, Sha256};
use tokio::sync::OnceCell;
use tracing::Instrument;

use crate::loaded::LoadedPack;
use crate::lru::SizedLru;
use crate::s3::{Fetched, S3Source};
use crate::work::{Work, WorkError};

pub enum Fetcher {
    Dir(PathBuf),
    S3(Arc<S3Source>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackFailure {
    BadKey,
    Missing,
    Fetch(String),
    Decode(String),
    Work(WorkError),
}

impl std::fmt::Display for PackFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackFailure::BadKey => write!(f, "not a pack key"),
            PackFailure::Missing => write!(f, "no such pack"),
            PackFailure::Fetch(why) => write!(f, "could not fetch the pack: {why}"),
            PackFailure::Decode(why) => write!(f, "could not read the pack: {why}"),
            PackFailure::Work(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for PackFailure {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Held {
    pub memory_packs: usize,
    pub memory_bytes: u64,
    pub disk_packs: usize,
    pub disk_bytes: u64,
    pub fetches: u64,
    pub decodes: u64,
}

pub struct Packs {
    fetcher: Fetcher,
    dir: PathBuf,
    disk: Mutex<SizedLru<String, ()>>,
    memory: Mutex<SizedLru<String, Arc<LoadedPack>>>,
    loading: Mutex<HashMap<String, Arc<OnceCell<Arc<LoadedPack>>>>>,
    work: Arc<Work>,
    fetches: AtomicU64,
    decodes: AtomicU64,
    parts: AtomicU64,
}

/// Whether a key can name a pack: a relative path of plain segments, as R2 keys are.
pub fn is_pack_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 1024
        && !key.contains(['\\', '\0'])
        && key
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn file_name(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let mut out = String::with_capacity(70);
    for b in digest.iter().take(20) {
        let _ = write!(out, "{b:02x}");
    }
    out.push_str(".pack");
    out
}

fn io(e: std::io::Error) -> PackFailure {
    PackFailure::Fetch(e.to_string())
}

impl Packs {
    /// The packs kept under `dir`, fetched by `fetcher` when missing: on disk while their sizes add up to `disk_bytes`, decoded in memory while theirs add up to `memory_bytes`. What an earlier run left on disk is kept, oldest first to go.
    pub async fn open(
        fetcher: Fetcher,
        dir: PathBuf,
        disk_bytes: u64,
        memory_bytes: u64,
        work: Arc<Work>,
    ) -> std::io::Result<Packs> {
        tokio::fs::create_dir_all(&dir).await?;
        let mut found: Vec<(SystemTime, String, u64)> = Vec::new();
        let mut entries = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".part") {
                let _ = tokio::fs::remove_file(entry.path()).await;
            } else if name.ends_with(".pack") {
                let meta = entry.metadata().await?;
                found.push((
                    meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    name,
                    meta.len(),
                ));
            }
        }
        found.sort();
        let mut disk = SizedLru::new(disk_bytes);
        let mut gone = Vec::new();
        for (_, name, bytes) in found {
            gone.extend(disk.insert(name, (), bytes));
        }
        for (name, ()) in gone {
            let _ = tokio::fs::remove_file(dir.join(name)).await;
        }
        Ok(Packs {
            fetcher,
            dir,
            disk: Mutex::new(disk),
            memory: Mutex::new(SizedLru::new(memory_bytes)),
            loading: Mutex::new(HashMap::new()),
            work,
            fetches: AtomicU64::new(0),
            decodes: AtomicU64::new(0),
            parts: AtomicU64::new(0),
        })
    }

    /// How many packs are held, and how many bytes they take, in memory and on disk.
    pub fn held(&self) -> Held {
        let (memory_packs, memory_bytes) =
            self.memory.lock().map_or((0, 0), |m| (m.len(), m.used()));
        let (disk_packs, disk_bytes) = self.disk.lock().map_or((0, 0), |d| (d.len(), d.used()));
        Held {
            memory_packs,
            memory_bytes,
            disk_packs,
            disk_bytes,
            fetches: self.fetches.load(Ordering::Relaxed),
            decodes: self.decodes.load(Ordering::Relaxed),
        }
    }

    fn in_memory(&self, key: &str) -> Option<Arc<LoadedPack>> {
        self.memory.lock().ok()?.get(&key.to_string())
    }

    /// A pack decoded, from memory, from disk, or fetched once however many ask for it at the same time.
    pub async fn get(&self, key: &str) -> Result<Arc<LoadedPack>, PackFailure> {
        if !is_pack_key(key) {
            return Err(PackFailure::BadKey);
        }
        if let Some(hit) = self.in_memory(key) {
            if let Ok(mut disk) = self.disk.lock() {
                disk.get(&file_name(key));
            }
            return Ok(hit);
        }
        let cell = match self.loading.lock() {
            Ok(mut loading) => loading.entry(key.to_string()).or_default().clone(),
            Err(_) => Arc::new(OnceCell::new()),
        };
        let out = cell.get_or_try_init(|| self.load(key)).await.cloned();
        if let Ok(mut loading) = self.loading.lock() {
            if loading.get(key).is_some_and(|c| Arc::ptr_eq(c, &cell)) {
                loading.remove(key);
            }
        }
        out
    }

    async fn load(&self, key: &str) -> Result<Arc<LoadedPack>, PackFailure> {
        if let Some(hit) = self.in_memory(key) {
            return Ok(hit);
        }
        let name = file_name(key);
        let path = self.dir.join(&name);
        let kept = self.disk.lock().is_ok_and(|mut d| d.get(&name).is_some());
        if !kept {
            self.fetch(key, &name, &path).await?;
        }
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.fetch(key, &name, &path).await?;
                tokio::fs::read(&path).await.map_err(io)?
            }
            Err(e) => return Err(io(e)),
        };
        let owned = key.to_string();
        let decoded = self
            .work
            .run(move || {
                let _span = tracing::info_span!("pack.decode", bytes = bytes.len()).entered();
                LoadedPack::decode(&owned, &bytes)
            })
            .await
            .map_err(PackFailure::Work)?;
        let loaded = match decoded {
            Ok(loaded) => Arc::new(loaded),
            Err(e) => {
                if let Ok(mut disk) = self.disk.lock() {
                    disk.remove(&name);
                }
                let _ = tokio::fs::remove_file(&path).await;
                return Err(PackFailure::Decode(e.to_string()));
            }
        };
        self.decodes.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut memory) = self.memory.lock() {
            memory.insert(key.to_string(), loaded.clone(), loaded.bytes);
        }
        Ok(loaded)
    }

    async fn fetch(&self, key: &str, name: &str, path: &Path) -> Result<(), PackFailure> {
        let part = self.dir.join(format!(
            "{name}.{}.{}.part",
            std::process::id(),
            self.parts.fetch_add(1, Ordering::Relaxed)
        ));
        let fetched = self
            .fetch_into(key, &part)
            .instrument(tracing::info_span!("pack.fetch"))
            .await;
        let bytes = match fetched {
            Ok(Fetched::Written(bytes)) => bytes,
            Ok(Fetched::Missing) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(PackFailure::Missing);
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(e);
            }
        };
        if let Err(e) = tokio::fs::rename(&part, path).await {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(io(e));
        }
        self.fetches.fetch_add(1, Ordering::Relaxed);
        let gone = match self.disk.lock() {
            Ok(mut disk) => disk.insert(name.to_string(), (), bytes),
            Err(_) => Vec::new(),
        };
        for (old, ()) in gone {
            let _ = tokio::fs::remove_file(self.dir.join(old)).await;
        }
        Ok(())
    }

    async fn fetch_into(&self, key: &str, part: &Path) -> Result<Fetched, PackFailure> {
        match &self.fetcher {
            Fetcher::Dir(dir) => match tokio::fs::copy(dir.join(key), part).await {
                Ok(bytes) => Ok(Fetched::Written(bytes)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Fetched::Missing),
                Err(e) => Err(io(e)),
            },
            Fetcher::S3(s3) => {
                let (s3, key, part) = (s3.clone(), key.to_string(), part.to_path_buf());
                tokio::task::spawn_blocking(move || s3.fetch(&key, &part))
                    .await
                    .map_err(|e| PackFailure::Fetch(e.to_string()))?
                    .map_err(PackFailure::Fetch)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_relative_paths_of_plain_segments() {
        assert!(is_pack_key("packs/gh/facebook/react/12/abc-34-lines.pack"));
        assert!(is_pack_key("packs/socket.io/1/a.pack"));
        for bad in [
            "",
            "/etc/passwd",
            "a/../b",
            "a//b",
            "./a",
            "a/.",
            "a\\b",
            "a\0b",
        ] {
            assert!(!is_pack_key(bad), "{bad:?}");
        }
        assert!(!is_pack_key(&"a".repeat(1025)));
    }

    #[test]
    fn a_key_is_kept_under_a_name_of_its_own() {
        let a = file_name("packs/a.pack");
        assert_eq!(a.len(), 45);
        assert!(a.ends_with(".pack"));
        assert_ne!(a, file_name("packs/b.pack"));
        assert_eq!(a, file_name("packs/a.pack"));
    }
}
