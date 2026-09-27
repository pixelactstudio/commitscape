use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write as _};
use std::path::{Path, PathBuf};

use commitscape_core::{
    AuthorTable, CommitMeta, FileChange, FileHistory, HeadFile, HistorySpan, Index, Month, Oid,
    PathTable, RepoIdentity, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use xxhash_rust::xxh3::xxh3_64;

use crate::head_pass::ClassifyContext;

const HEAD_MAGIC: [u8; 8] = *b"CSCAPEH\x02";
const DATA_MAGIC: [u8; 8] = *b"CSCAPED\x02";
const POINTER_FILE: &str = "index.current";
const LOCK_FILE: &str = "index.lock";
const MAX_ID_RUNS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Unusable {
    Missing,
    OtherSchema,
    Damaged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Extent {
    pub offset: u64,
    pub len: u64,
    pub checksum: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct BlockEntry {
    pub month: Month,
    pub commits: u32,
    pub changes: u32,
    pub extent: Extent,
}

#[derive(Debug)]
pub(super) struct Head {
    pub schema_version: u32,
    pub generation: u64,
    pub repo: RepoIdentity,
    pub refs_fingerprint: u64,
    pub mailmap_fingerprint: u64,
    pub frontier: Vec<Oid>,
    pub history_truncated: bool,
    pub span: HistorySpan,
    pub paths: PathTable,
    pub authors: AuthorTable,
    pub head: Vec<HeadFile>,
    pub file_history: Vec<FileHistory>,
    pub head_commit: Option<Oid>,
    pub classify: ClassifyContext,
    pub data_file: String,
    pub blocks: Vec<BlockEntry>,
    pub id_runs: Vec<Extent>,
}

#[derive(Serialize, Deserialize)]
struct HeadMeta {
    schema_version: u32,
    generation: u64,
    repo: RepoIdentity,
    refs_fingerprint: u64,
    mailmap_fingerprint: u64,
    frontier: Vec<Oid>,
    history_truncated: bool,
    span: HistorySpan,
    head_commit: Option<Oid>,
    classify: ClassifyContext,
    data_file: String,
    blocks: Vec<BlockEntry>,
    id_runs: Vec<Extent>,
}

fn encode_head(head: &Head) -> std::io::Result<Vec<u8>> {
    let meta = HeadMeta {
        schema_version: head.schema_version,
        generation: head.generation,
        repo: head.repo.clone(),
        refs_fingerprint: head.refs_fingerprint,
        mailmap_fingerprint: head.mailmap_fingerprint,
        frontier: head.frontier.clone(),
        history_truncated: head.history_truncated,
        span: head.span,
        head_commit: head.head_commit,
        classify: head.classify.clone(),
        data_file: head.data_file.clone(),
        blocks: head.blocks.clone(),
        id_runs: head.id_runs.clone(),
    };
    let encode = |v: &dyn erased::Encode| v.encode();
    let sections = [
        encode(&meta)?,
        encode(&head.paths)?,
        encode(&head.authors)?,
        encode(&(&head.head, &head.file_history))?,
    ];
    let mut out = Vec::with_capacity(sections.iter().map(|s| s.len() + 8).sum());
    for section in &sections {
        out.extend_from_slice(&(section.len() as u64).to_le_bytes());
        out.extend_from_slice(section);
    }
    Ok(out)
}

mod erased {
    pub(super) trait Encode {
        fn encode(&self) -> std::io::Result<Vec<u8>>;
    }

    impl<T: serde::Serialize> Encode for T {
        fn encode(&self) -> std::io::Result<Vec<u8>> {
            bincode::serde::encode_to_vec(self, super::config())
                .map_err(|e| std::io::Error::other(e.to_string()))
        }
    }
}

fn sections(mut payload: &[u8]) -> Result<[&[u8]; 4], Unusable> {
    let mut out: [&[u8]; 4] = [&[]; 4];
    for slot in &mut out {
        let (len, rest) = payload.split_at_checked(8).ok_or(Unusable::Damaged)?;
        let len = u64::from_le_bytes(len.try_into().map_err(|_| Unusable::Damaged)?) as usize;
        let (section, rest) = rest.split_at_checked(len).ok_or(Unusable::Damaged)?;
        *slot = section;
        payload = rest;
    }
    Ok(out)
}

fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, Unusable> {
    bincode::serde::decode_from_slice(bytes, config())
        .map(|(v, _)| v)
        .map_err(|_| Unusable::Damaged)
}

fn joined<T>(r: std::thread::Result<Result<T, Unusable>>) -> Result<T, Unusable> {
    r.unwrap_or(Err(Unusable::Damaged))
}

fn decode_head(payload: &[u8]) -> Result<Head, Unusable> {
    let [meta, paths, authors, files] = sections(payload)?;
    let version: u32 = decode(meta)?;
    if version != SCHEMA_VERSION {
        return Err(Unusable::OtherSchema);
    }
    let meta: HeadMeta = decode(meta)?;
    let (paths, authors, files) = std::thread::scope(|s| {
        let paths = s.spawn(|| decode::<PathTable>(paths));
        let authors = s.spawn(|| decode::<AuthorTable>(authors));
        let files = decode::<(Vec<HeadFile>, Vec<FileHistory>)>(files);
        (joined(paths.join()), joined(authors.join()), files)
    });
    Ok(Head {
        schema_version: meta.schema_version,
        generation: meta.generation,
        repo: meta.repo,
        refs_fingerprint: meta.refs_fingerprint,
        mailmap_fingerprint: meta.mailmap_fingerprint,
        frontier: meta.frontier,
        history_truncated: meta.history_truncated,
        span: meta.span,
        paths: paths?,
        authors: authors?,
        head: files.as_ref().map(|f| f.0.clone()).map_err(|e| *e)?,
        file_history: files.map(|f| f.1)?,
        head_commit: meta.head_commit,
        classify: meta.classify,
        data_file: meta.data_file,
        blocks: meta.blocks,
        id_runs: meta.id_runs,
    })
}

#[derive(Serialize, Deserialize)]
struct Block {
    commits: Vec<CommitMeta>,
    changes: Vec<FileChange>,
    subjects: Vec<u8>,
}

#[derive(Debug, Default)]
pub(super) struct Decoded {
    pub commits: Vec<CommitMeta>,
    pub changes: Vec<FileChange>,
    pub subjects: Vec<u8>,
}

fn config() -> bincode::config::Configuration {
    bincode::config::standard()
}

fn head_path(dir: &Path, generation: u64) -> PathBuf {
    dir.join(format!("{generation:016x}.head"))
}

fn current_generation(dir: &Path) -> Result<u64, Unusable> {
    let text = match std::fs::read_to_string(dir.join(POINTER_FILE)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(Unusable::Missing),
        Err(_) => return Err(Unusable::Damaged),
    };
    u64::from_str_radix(text.trim(), 16).map_err(|_| Unusable::Damaged)
}

pub(super) fn read_head(dir: &Path) -> Result<Head, Unusable> {
    let generation = current_generation(dir)?;
    let bytes = std::fs::read(head_path(dir, generation)).map_err(|_| Unusable::Damaged)?;
    let (magic, rest) = bytes.split_at_checked(8).ok_or(Unusable::Damaged)?;
    if magic != HEAD_MAGIC {
        return Err(Unusable::Damaged);
    }
    let (sum, payload) = rest.split_at_checked(8).ok_or(Unusable::Damaged)?;
    let sum = u64::from_le_bytes(sum.try_into().map_err(|_| Unusable::Damaged)?);
    if sum != xxh3_64(payload) {
        return Err(Unusable::Damaged);
    }
    let head = decode_head(payload)?;
    if head.generation != generation {
        return Err(Unusable::Damaged);
    }
    Ok(head)
}

fn read_extents(dir: &Path, data_file: &str, extents: &[Extent]) -> Result<Vec<Vec<u8>>, Unusable> {
    if extents.is_empty() {
        return Ok(Vec::new());
    }
    let mut file = File::open(dir.join(data_file)).map_err(|_| Unusable::Damaged)?;
    let mut out = Vec::with_capacity(extents.len());
    for e in extents {
        let mut bytes = vec![0u8; e.len as usize];
        file.seek(SeekFrom::Start(e.offset))
            .map_err(|_| Unusable::Damaged)?;
        file.read_exact(&mut bytes).map_err(|_| Unusable::Damaged)?;
        if xxh3_64(&bytes) != e.checksum {
            return Err(Unusable::Damaged);
        }
        out.push(bytes);
    }
    Ok(out)
}

pub(super) fn read_blocks(
    dir: &Path,
    data_file: &str,
    entries: &[BlockEntry],
) -> Result<Decoded, Unusable> {
    let extents: Vec<Extent> = entries.iter().map(|e| e.extent).collect();
    let raw = read_extents(dir, data_file, &extents)?;
    let mut out = Decoded::default();
    for (entry, bytes) in entries.iter().zip(raw) {
        let (block, _): (Block, usize) =
            bincode::serde::decode_from_slice(&bytes, config()).map_err(|_| Unusable::Damaged)?;
        if block.commits.len() != entry.commits as usize
            || block.changes.len() != entry.changes as usize
        {
            return Err(Unusable::Damaged);
        }
        let base = out.changes.len() as u32;
        let subject_base = out.subjects.len() as u32;
        for mut c in block.commits {
            if c.changes_start as u64 + c.changes_len as u64 > entry.changes as u64
                || c.subject_start as u64 + c.subject_len as u64 > block.subjects.len() as u64
            {
                return Err(Unusable::Damaged);
            }
            c.changes_start += base;
            c.subject_start += subject_base;
            out.commits.push(c);
        }
        out.changes.extend(block.changes);
        out.subjects.extend(block.subjects);
    }
    Ok(out)
}

pub(super) struct SortedIds {
    runs: Vec<Vec<u8>>,
}

impl SortedIds {
    pub fn run_of(ids: impl Iterator<Item = Oid>) -> Vec<u8> {
        let mut ids: Vec<[u8; 20]> = ids.map(|id| id.0).collect();
        ids.sort_unstable();
        ids.concat()
    }

    fn merged_with(&self, more: &[u8]) -> Vec<u8> {
        let mut all: Vec<&[u8; 20]> = self
            .runs
            .iter()
            .flat_map(|r| r.as_chunks::<20>().0)
            .chain(more.as_chunks::<20>().0)
            .collect();
        all.sort_unstable();
        all.into_iter().flatten().copied().collect()
    }
}

fn run_contains(run: &[u8], id: &[u8; 20]) -> bool {
    let (mut lo, mut hi) = (0usize, run.len() / 20);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match run.get(mid * 20..mid * 20 + 20) {
            Some(probe) if probe < id.as_slice() => lo = mid + 1,
            Some(probe) if probe > id.as_slice() => hi = mid,
            Some(_) => return true,
            None => return false,
        }
    }
    false
}

impl crate::source::Indexed for SortedIds {
    fn contains(&self, id: &Oid) -> bool {
        self.runs.iter().any(|run| run_contains(run, &id.0))
    }
}

pub(super) fn read_ids(dir: &Path, head: &Head) -> Result<SortedIds, Unusable> {
    let runs = read_extents(dir, &head.data_file, &head.id_runs)?;
    if runs.iter().any(|r| r.len() % 20 != 0) {
        return Err(Unusable::Damaged);
    }
    Ok(SortedIds { runs })
}

pub(super) fn encode_blocks(
    commits: &[CommitMeta],
    changes: &[FileChange],
    subjects: &[u8],
) -> Vec<(Month, u32, u32, Vec<u8>)> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(first) = commits.get(i) {
        let month = Month::of(first.time);
        let len = commits
            .get(i..)
            .unwrap_or(&[])
            .iter()
            .take_while(|c| Month::of(c.time) == month)
            .count();
        let run = commits.get(i..i + len).unwrap_or(&[]);
        let mut block = Block {
            commits: Vec::with_capacity(run.len()),
            changes: Vec::new(),
            subjects: Vec::new(),
        };
        for c in run {
            let slice = changes.get(c.changes()).unwrap_or(&[]);
            let text = subjects.get(c.subject()).unwrap_or(&[]);
            let mut local = *c;
            local.changes_start = block.changes.len() as u32;
            block.changes.extend_from_slice(slice);
            local.subject_start = block.subjects.len() as u32;
            local.subject_len = text.len() as u8;
            block.subjects.extend_from_slice(text);
            block.commits.push(local);
        }
        let (n_commits, n_changes) = (block.commits.len() as u32, block.changes.len() as u32);
        let bytes = bincode::serde::encode_to_vec(&block, config()).unwrap_or_default();
        out.push((month, n_commits, n_changes, bytes));
        i += len.max(1);
    }
    out
}

pub(super) struct Previous {
    pub data_file: String,
    pub blocks: Vec<BlockEntry>,
    pub id_runs: Vec<Extent>,
    pub ids: SortedIds,
}

pub(super) struct Writing<'a> {
    pub head: Head,
    pub previous: Option<Previous>,
    pub fresh: Vec<(Month, u32, u32, Vec<u8>)>,
    pub new_ids: Vec<u8>,
    pub dir: &'a Path,
}

struct WriteLock(File);

impl Drop for WriteLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

fn lock(dir: &Path) -> std::io::Result<WriteLock> {
    let f = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOCK_FILE))?;
    f.try_lock()
        .map_err(|_| std::io::Error::other("another process is writing this cache"))?;
    Ok(WriteLock(f))
}

pub(super) fn write(w: Writing<'_>) -> std::io::Result<(String, Vec<BlockEntry>)> {
    std::fs::create_dir_all(w.dir)?;
    let _lock = lock(w.dir)?;
    let mut head = w.head;
    head.generation = new_generation();
    head.schema_version = SCHEMA_VERSION;

    let appendable = w.previous.as_ref().filter(|p| {
        let live: u64 = p.blocks.iter().map(|b| b.extent.len).sum::<u64>()
            + p.id_runs.iter().map(|e| e.len).sum::<u64>();
        std::fs::metadata(w.dir.join(&p.data_file))
            .map(|m| m.len() <= 2 * live.max(1 << 20))
            .unwrap_or(false)
    });

    match appendable {
        Some(prev) => {
            let mut file = std::fs::OpenOptions::new()
                .append(true)
                .open(w.dir.join(&prev.data_file))?;
            let mut at = file.seek(SeekFrom::End(0))?;
            let mut out = std::io::BufWriter::with_capacity(1 << 20, &mut file);
            head.data_file = prev.data_file.clone();
            head.blocks = prev.blocks.clone();
            append_blocks(&mut out, &mut at, &w.fresh, &mut head.blocks)?;
            head.id_runs = prev.id_runs.clone();
            if prev.id_runs.len() >= MAX_ID_RUNS {
                let merged = prev.ids.merged_with(&w.new_ids);
                head.id_runs = vec![append(&mut out, &mut at, &merged)?];
            } else if !w.new_ids.is_empty() {
                head.id_runs.push(append(&mut out, &mut at, &w.new_ids)?);
            }
            out.flush()?;
        }
        None => {
            let name = format!("{:016x}.data", head.generation);
            let file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(w.dir.join(&name))?;
            let mut out = std::io::BufWriter::with_capacity(1 << 20, file);
            out.write_all(&DATA_MAGIC)?;
            let mut at = DATA_MAGIC.len() as u64;
            head.data_file = name;
            head.blocks = Vec::new();
            let ids = match &w.previous {
                Some(prev) => {
                    let extents: Vec<Extent> = prev.blocks.iter().map(|b| b.extent).collect();
                    let kept = read_extents(w.dir, &prev.data_file, &extents)
                        .map_err(|_| std::io::Error::other("the previous data file is damaged"))?;
                    for (entry, bytes) in prev.blocks.iter().zip(kept) {
                        let extent = append(&mut out, &mut at, &bytes)?;
                        head.blocks.push(BlockEntry { extent, ..*entry });
                    }
                    prev.ids.merged_with(&w.new_ids)
                }
                None => w.new_ids.clone(),
            };
            append_blocks(&mut out, &mut at, &w.fresh, &mut head.blocks)?;
            head.id_runs = vec![append(&mut out, &mut at, &ids)?];
            out.flush()?;
        }
    }

    let payload = encode_head(&head)?;
    let head_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(head_path(w.dir, head.generation))?;
    let mut out = std::io::BufWriter::with_capacity(1 << 20, head_file);
    out.write_all(&HEAD_MAGIC)?;
    out.write_all(&xxh3_64(&payload).to_le_bytes())?;
    out.write_all(&payload)?;
    out.flush()?;
    drop(out);

    swap_to(w.dir, head.generation, &head.data_file)?;
    Ok((head.data_file, head.blocks))
}

fn append(out: &mut impl std::io::Write, at: &mut u64, bytes: &[u8]) -> std::io::Result<Extent> {
    out.write_all(bytes)?;
    let extent = Extent {
        offset: *at,
        len: bytes.len() as u64,
        checksum: xxh3_64(bytes),
    };
    *at += bytes.len() as u64;
    Ok(extent)
}

fn append_blocks(
    out: &mut impl std::io::Write,
    at: &mut u64,
    fresh: &[(Month, u32, u32, Vec<u8>)],
    blocks: &mut Vec<BlockEntry>,
) -> std::io::Result<()> {
    for (month, commits, changes, bytes) in fresh {
        let extent = append(out, at, bytes)?;
        blocks.retain(|b| b.month != *month);
        blocks.push(BlockEntry {
            month: *month,
            commits: *commits,
            changes: *changes,
            extent,
        });
    }
    blocks.sort_by_key(|b| b.month);
    Ok(())
}

fn swap_to(dir: &Path, generation: u64, data_file: &str) -> std::io::Result<()> {
    let previous = current_generation(dir).ok();
    let previous_data = previous.and_then(|g| data_file_of(dir, g).ok());
    let tmp = dir.join(format!("{POINTER_FILE}.{generation:016x}.tmp"));
    std::fs::write(&tmp, format!("{generation:016x}\n"))?;
    std::fs::rename(&tmp, dir.join(POINTER_FILE))?;

    let keep_head = |name: &str| {
        [Some(generation), previous]
            .into_iter()
            .flatten()
            .any(|g| name == format!("{g:016x}.head"))
    };
    let keep_data = |name: &str| name == data_file || previous_data.as_deref() == Some(name);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stale = (name.ends_with(".head") && !keep_head(&name))
                || (name.ends_with(".data") && !keep_data(&name))
                || name.ends_with(".tmp");
            if stale {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

fn data_file_of(dir: &Path, generation: u64) -> Result<String, Unusable> {
    let bytes = std::fs::read(head_path(dir, generation)).map_err(|_| Unusable::Damaged)?;
    let [meta, ..] = sections(bytes.get(16..).ok_or(Unusable::Damaged)?)?;
    decode::<HeadMeta>(meta).map(|m| m.data_file)
}

fn new_generation() -> u64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    xxh3_64(
        &[
            nanos.to_le_bytes(),
            (std::process::id() as u64).to_le_bytes(),
            counter.to_le_bytes(),
        ]
        .concat(),
    )
}

static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub(super) fn head_of(
    index: &Index,
    refs_fingerprint: u64,
    mailmap_fingerprint: u64,
    classify: ClassifyContext,
) -> Head {
    Head {
        schema_version: SCHEMA_VERSION,
        generation: 0,
        repo: index.repo.clone(),
        refs_fingerprint,
        mailmap_fingerprint,
        frontier: index.frontier.clone(),
        history_truncated: index.history_truncated,
        span: index.span,
        paths: index.paths.clone(),
        authors: index.authors.clone(),
        head: index.head.clone(),
        file_history: index.file_history.clone(),
        head_commit: index.head_commit,
        classify,
        data_file: String::new(),
        blocks: Vec::new(),
        id_runs: Vec::new(),
    }
}
