use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use commitscape_core::{Column, Oid};
use commitscape_map::Records;
use xxhash_rust::xxh3::{xxh3_64, Xxh3};

use crate::cache::Moved;

const MAGIC: &[u8; 8] = b"CSOWNS\x00\x02";
const ID: usize = 20;
const ENTRY: usize = 8 + 4 + ID + 8 + 4;
const FOOTER: usize = ID + 1 + 1 + 8 + 8 * 8;
const SUM: usize = 8;

static TEMPS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Span {
    at: usize,
    len: usize,
}

/// Who owns every line of a head's files, as blame would say, kept per head so the next head only works out the files that changed. Read in place from its file: commits sorted by id, files sorted by path, and each file's owners as runs of (commit, lines).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Ownership {
    pub head: Option<Oid>,
    pub settings: u64,
    pub complete: bool,
    pub moves: HashMap<Oid, Moved>,
    bytes: Column<u8>,
    commits: Span,
    runs: Span,
    paths: Span,
    files: Span,
    kept: Option<PathBuf>,
}

/// One file at a head: its blob, and its owners as runs of (commit, lines), the commit a position in the Ownership's commits.
#[derive(Debug, Clone, Copy)]
pub struct Owned<'a> {
    pub blob: Oid,
    runs: &'a [u8],
}

impl Owned<'_> {
    pub fn runs(&self) -> Runs<'_> {
        Runs {
            bytes: self.runs,
            at: 0,
        }
    }
}

pub struct Runs<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Iterator for Runs<'_> {
    type Item = (u32, u32);

    fn next(&mut self) -> Option<(u32, u32)> {
        let commit = varint(self.bytes, &mut self.at)?;
        let lines = varint(self.bytes, &mut self.at)?;
        Some((u32::try_from(commit).ok()?, u32::try_from(lines).ok()?))
    }
}

fn varint(bytes: &[u8], at: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    let mut shift = 0;
    loop {
        let b = *bytes.get(*at)?;
        *at += 1;
        value |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Some(value);
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}

fn put_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn number(bytes: &[u8], at: usize) -> Option<u64> {
    let mut b = [0u8; 8];
    b.copy_from_slice(bytes.get(at..at + 8)?);
    Some(u64::from_le_bytes(b))
}

fn small(bytes: &[u8], at: usize) -> Option<u32> {
    let mut b = [0u8; 4];
    b.copy_from_slice(bytes.get(at..at + 4)?);
    Some(u32::from_le_bytes(b))
}

fn oid(bytes: &[u8], at: usize) -> Option<Oid> {
    let mut b = [0u8; ID];
    b.copy_from_slice(bytes.get(at..at + ID)?);
    Some(Oid(b))
}

fn moves_of(path: &Path) -> PathBuf {
    path.with_extension("moves")
}

impl Ownership {
    /// Maps an Ownership written by `Writer`, with the moves kept beside it; None when there is none or it is not whole.
    pub fn open(path: &Path) -> Option<Ownership> {
        let file = File::open(path).ok()?;
        let size = usize::try_from(file.metadata().ok()?.len()).ok()?;
        if size < MAGIC.len() + FOOTER + SUM {
            return None;
        }
        let bytes = Column::mapped(Box::new(Records::<u8>::open(&file, 0, size).ok()?));
        let mut ownership = Ownership::parse(bytes)?;
        ownership.moves = std::fs::read(moves_of(path))
            .ok()
            .and_then(|b| {
                bincode::serde::decode_from_slice(&b, bincode::config::standard())
                    .ok()
                    .map(|(m, _)| m)
            })
            .unwrap_or_default();
        ownership.kept = Some(path.to_path_buf());
        Some(ownership)
    }

    fn parse(bytes: Column<u8>) -> Option<Ownership> {
        let size = bytes.len();
        if bytes.get(..MAGIC.len())? != MAGIC {
            return None;
        }
        let body = size.checked_sub(SUM)?;
        if number(&bytes, body)? != xxh3_64(bytes.get(..body)?) {
            return None;
        }
        let f = body.checked_sub(FOOTER)?;
        let head = oid(&bytes, f)?;
        let has_head = *bytes.get(f + ID)? == 1;
        let complete = *bytes.get(f + ID + 1)? == 1;
        let at = f + ID + 2;
        let settings = number(&bytes, at)?;
        let span = |i: usize, unit: usize| -> Option<Span> {
            let s = Span {
                at: usize::try_from(number(&bytes, at + 8 + i * 16)?).ok()?,
                len: usize::try_from(number(&bytes, at + 16 + i * 16)?).ok()?,
            };
            (s.at.checked_add(s.len.checked_mul(unit)?)? <= f).then_some(s)
        };
        let commits = span(0, ID)?;
        let runs = span(1, 1)?;
        let paths = span(2, 1)?;
        let files = span(3, ENTRY)?;
        Some(Ownership {
            head: has_head.then_some(head),
            settings,
            complete,
            moves: HashMap::new(),
            bytes,
            commits,
            runs,
            paths,
            files,
            kept: None,
        })
    }

    /// Keeps the moves beside the Ownership's file, when it has one.
    pub fn keep_moves(&self) -> io::Result<()> {
        let Some(path) = self.kept.as_deref() else {
            return Ok(());
        };
        let to = moves_of(path);
        let temp = to.with_extension("moves.writing");
        let bytes = bincode::serde::encode_to_vec(&self.moves, bincode::config::standard())
            .map_err(io::Error::other)?;
        std::fs::write(&temp, bytes)?;
        std::fs::rename(temp, to)
    }

    pub fn len(&self) -> usize {
        self.files.len
    }

    pub fn is_empty(&self) -> bool {
        self.files.len == 0
    }

    fn commit(&self, i: u32) -> Option<Oid> {
        let i = i as usize;
        (i < self.commits.len)
            .then(|| oid(&self.bytes, self.commits.at + i * ID))
            .flatten()
    }

    fn commits_len(&self) -> usize {
        self.commits.len
    }

    fn position(&self, id: &Oid) -> Option<u32> {
        let (mut lo, mut hi) = (0usize, self.commits.len);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let at = self.commits.at + mid * ID;
            match self.bytes.get(at..at + ID)?.cmp(&id.0[..]) {
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid,
                std::cmp::Ordering::Equal => return u32::try_from(mid).ok(),
            }
        }
        None
    }

    fn path(&self, i: usize) -> Option<&[u8]> {
        let e = self.files.at + i * ENTRY;
        let at = usize::try_from(number(&self.bytes, e)?).ok()?;
        let len = small(&self.bytes, e + 8)? as usize;
        let from = self.paths.at.checked_add(at)?;
        let to = from.checked_add(len)?;
        (to <= self.paths.at + self.paths.len)
            .then(|| self.bytes.get(from..to))
            .flatten()
    }

    fn entry(&self, i: usize) -> Option<Owned<'_>> {
        let e = self.files.at + i * ENTRY + 12;
        let blob = oid(&self.bytes, e)?;
        let at = usize::try_from(number(&self.bytes, e + ID)?).ok()?;
        let len = small(&self.bytes, e + ID + 8)? as usize;
        let from = self.runs.at.checked_add(at)?;
        let to = from.checked_add(len)?;
        (to <= self.runs.at + self.runs.len).then_some(Owned {
            blob,
            runs: self.bytes.get(from..to)?,
        })
    }

    fn find(&self, path: &[u8]) -> Option<usize> {
        let (mut lo, mut hi) = (0usize, self.files.len);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            match self.path(mid)?.cmp(path) {
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid,
                std::cmp::Ordering::Equal => return Some(mid),
            }
        }
        None
    }

    /// One file's blob and owners.
    pub fn get(&self, path: &[u8]) -> Option<Owned<'_>> {
        self.entry(self.find(path)?)
    }

    /// The files' paths, in order.
    pub fn paths(&self) -> impl Iterator<Item = &[u8]> {
        (0..self.files.len).filter_map(|i| self.path(i))
    }

    /// Each owner of a file's lines with how many lines it owns.
    pub fn counts(&self, path: &[u8]) -> Vec<(Oid, u32)> {
        let Some(owned) = self.get(path) else {
            return Vec::new();
        };
        let mut counts: HashMap<Oid, u32> = HashMap::new();
        for (c, n) in owned.runs() {
            if let Some(id) = self.commit(c) {
                *counts.entry(id).or_default() += n;
            }
        }
        let mut out: Vec<(Oid, u32)> = counts.into_iter().collect();
        out.sort_unstable();
        out
    }

    /// The owner of each line of a file at `blob`.
    pub fn lines(&self, path: &[u8], blob: Oid) -> Option<Vec<Oid>> {
        let owned = self.get(path).filter(|o| o.blob == blob)?;
        let mut out = Vec::new();
        for (c, n) in owned.runs() {
            out.extend(std::iter::repeat_n(self.commit(c)?, n as usize));
        }
        Some(out)
    }
}

struct Entry {
    path: Vec<u8>,
    blob: Oid,
    len: u32,
}

/// Writes a new Ownership file by file, owners going to disk as they come, then lays the file out whole and maps it.
pub(crate) struct Writer<'p> {
    to: PathBuf,
    temporary: bool,
    runs_path: PathBuf,
    runs: BufWriter<File>,
    previous: Option<&'p Ownership>,
    used: Vec<bool>,
    fresh: Vec<Oid>,
    fresh_at: HashMap<Oid, u32>,
    entries: Vec<Entry>,
    head: Option<Oid>,
    settings: u64,
    buf: Vec<u8>,
}

impl<'p> Writer<'p> {
    /// A writer for the Ownership of `head` at `to`, or in a temporary file when there is nowhere to keep it, numbering owners the previous Ownership knows by its numbers.
    pub(crate) fn create(
        to: Option<&Path>,
        previous: Option<&'p Ownership>,
        head: Option<Oid>,
        settings: u64,
    ) -> io::Result<Writer<'p>> {
        let (to, temporary) = match to {
            Some(p) => (p.to_path_buf(), false),
            None => (
                std::env::temp_dir().join(format!(
                    "commitscape-ownership-{}-{}",
                    std::process::id(),
                    TEMPS.fetch_add(1, Ordering::Relaxed)
                )),
                true,
            ),
        };
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let runs_path = to.with_extension("runs");
        let runs = BufWriter::new(File::create(&runs_path)?);
        Ok(Writer {
            used: vec![false; previous.map_or(0, Ownership::commits_len)],
            to,
            temporary,
            runs_path,
            runs,
            previous,
            fresh: Vec::new(),
            fresh_at: HashMap::new(),
            entries: Vec::new(),
            head,
            settings,
            buf: Vec::new(),
        })
    }

    fn push(&mut self, path: Vec<u8>, blob: Oid) -> io::Result<()> {
        self.runs.write_all(&self.buf)?;
        self.entries.push(Entry {
            path,
            blob,
            len: u32::try_from(self.buf.len()).map_err(io::Error::other)?,
        });
        Ok(())
    }

    /// Keeps a file's owners as the previous Ownership has them; false when it has no such file.
    pub(crate) fn carry(&mut self, path: &[u8]) -> io::Result<bool> {
        let Some(previous) = self.previous else {
            return Ok(false);
        };
        let Some(owned) = previous.get(path) else {
            return Ok(false);
        };
        self.buf.clear();
        for (c, n) in owned.runs() {
            if let Some(u) = self.used.get_mut(c as usize) {
                *u = true;
            }
            put_varint(&mut self.buf, u64::from(c) << 1);
            put_varint(&mut self.buf, u64::from(n));
        }
        self.push(path.to_vec(), owned.blob)?;
        Ok(true)
    }

    /// Adds a file with the owner of each of its lines.
    pub(crate) fn add(&mut self, path: Vec<u8>, blob: Oid, owners: &[Oid]) -> io::Result<()> {
        self.buf.clear();
        let mut at = 0;
        while let Some(&id) = owners.get(at) {
            let n = owners
                .get(at..)
                .unwrap_or(&[])
                .iter()
                .take_while(|&&o| o == id)
                .count();
            at += n;
            let known = self.previous.and_then(|p| p.position(&id));
            let code = match known {
                Some(c) => {
                    if let Some(u) = self.used.get_mut(c as usize) {
                        *u = true;
                    }
                    u64::from(c) << 1
                }
                None => {
                    let next = self.fresh.len() as u32;
                    let f = *self.fresh_at.entry(id).or_insert(next);
                    if f == next {
                        self.fresh.push(id);
                    }
                    (u64::from(f) << 1) | 1
                }
            };
            put_varint(&mut self.buf, code);
            put_varint(&mut self.buf, n as u64);
        }
        self.push(path, blob)
    }

    /// Lays the Ownership out in its file, the owners numbered by their place among the commits it keeps, then maps it.
    pub(crate) fn finish(
        mut self,
        complete: bool,
        moves: HashMap<Oid, Moved>,
    ) -> io::Result<Ownership> {
        self.runs.flush()?;
        let mut fresh: Vec<(Oid, u32)> = self.fresh.iter().copied().zip(0u32..).collect();
        fresh.sort_unstable();
        let mut from_previous = vec![u32::MAX; self.used.len()];
        let mut from_fresh = vec![u32::MAX; fresh.len()];
        let mut commits: Vec<Oid> = Vec::new();
        {
            let mut old = (0..self.used.len())
                .filter(|&i| self.used.get(i).copied().unwrap_or(false))
                .filter_map(|i| {
                    let id = self.previous.and_then(|p| p.commit(i as u32))?;
                    Some((id, i))
                })
                .peekable();
            let mut new = fresh.iter().peekable();
            loop {
                let take_old = match (old.peek(), new.peek()) {
                    (Some((a, _)), Some((b, _))) => a < b,
                    (Some(_), None) => true,
                    (None, Some(_)) => false,
                    (None, None) => break,
                };
                let n = commits.len() as u32;
                if take_old {
                    if let Some((id, i)) = old.next() {
                        commits.push(id);
                        if let Some(slot) = from_previous.get_mut(i) {
                            *slot = n;
                        }
                    }
                } else if let Some(&(id, f)) = new.next() {
                    commits.push(id);
                    if let Some(slot) = from_fresh.get_mut(f as usize) {
                        *slot = n;
                    }
                }
            }
        }
        let renumber = |code: u64| -> u64 {
            let i = (code >> 1) as usize;
            let table = if code & 1 == 0 {
                &from_previous
            } else {
                &from_fresh
            };
            u64::from(table.get(i).copied().unwrap_or(u32::MAX))
        };

        let writing = self.to.with_extension("writing");
        let mut out = Hashed::new(BufWriter::new(File::create(&writing)?));
        out.write_all(MAGIC)?;
        let commits_at = out.at;
        for id in &commits {
            out.write_all(&id.0)?;
        }
        let runs_at = out.at;
        let mut reading = BufReader::new(File::open(&self.runs_path)?);
        let mut chunk = Vec::new();
        let mut placed: Vec<(u64, u32)> = Vec::with_capacity(self.entries.len());
        for e in &self.entries {
            chunk.resize(e.len as usize, 0);
            reading.read_exact(&mut chunk)?;
            self.buf.clear();
            let mut at = 0;
            while let (Some(code), Some(n)) = (varint(&chunk, &mut at), varint(&chunk, &mut at)) {
                put_varint(&mut self.buf, renumber(code));
                put_varint(&mut self.buf, n);
            }
            placed.push((
                out.at - runs_at,
                u32::try_from(self.buf.len()).map_err(io::Error::other)?,
            ));
            out.write_all(&self.buf)?;
        }
        drop(reading);
        let runs_len = out.at - runs_at;
        let mut order: Vec<usize> = (0..self.entries.len()).collect();
        order.sort_unstable_by(|&a, &b| {
            let path = |i: usize| self.entries.get(i).map(|e| e.path.as_slice());
            path(a).cmp(&path(b))
        });
        let paths_at = out.at;
        let mut path_at: Vec<u64> = Vec::with_capacity(order.len());
        for &i in &order {
            path_at.push(out.at - paths_at);
            if let Some(e) = self.entries.get(i) {
                out.write_all(&e.path)?;
            }
        }
        let paths_len = out.at - paths_at;
        let files_at = out.at;
        for (&i, &p) in order.iter().zip(&path_at) {
            let (Some(e), Some(&(at, len))) = (self.entries.get(i), placed.get(i)) else {
                continue;
            };
            out.write_all(&p.to_le_bytes())?;
            out.write_all(
                &u32::try_from(e.path.len())
                    .map_err(io::Error::other)?
                    .to_le_bytes(),
            )?;
            out.write_all(&e.blob.0)?;
            out.write_all(&at.to_le_bytes())?;
            out.write_all(&len.to_le_bytes())?;
        }
        out.write_all(&self.head.map_or([0; ID], |h| h.0))?;
        out.write_all(&[u8::from(self.head.is_some()), u8::from(complete)])?;
        out.write_all(&self.settings.to_le_bytes())?;
        for (at, len) in [
            (commits_at, commits.len() as u64),
            (runs_at, runs_len),
            (paths_at, paths_len),
            (files_at, order.len() as u64),
        ] {
            out.write_all(&at.to_le_bytes())?;
            out.write_all(&len.to_le_bytes())?;
        }
        let sum = out.hasher.digest();
        let mut file = out.into_inner();
        file.write_all(&sum.to_le_bytes())?;
        let file = file.into_inner().map_err(io::IntoInnerError::into_error)?;
        file.sync_data()?;
        drop(file);
        std::fs::rename(&writing, &self.to)?;
        let _ = std::fs::remove_file(&self.runs_path);
        let opened = Ownership::open(&self.to);
        if self.temporary {
            let _ = std::fs::remove_file(&self.to);
        }
        let mut ownership =
            opened.ok_or_else(|| io::Error::other("the ownership just written does not read"))?;
        ownership.moves = moves;
        if self.temporary {
            ownership.kept = None;
        }
        Ok(ownership)
    }
}

impl Drop for Writer<'_> {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.runs_path);
    }
}

struct Hashed<W: Write> {
    inner: W,
    hasher: Xxh3,
    at: u64,
}

impl<W: Write> Hashed<W> {
    fn new(inner: W) -> Self {
        Hashed {
            inner,
            hasher: Xxh3::new(),
            at: 0,
        }
    }

    fn into_inner(self) -> W {
        self.inner
    }
}

impl<W: Write> Write for Hashed<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hasher.update(buf.get(..n).unwrap_or(&[]));
        self.at += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}
