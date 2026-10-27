use std::io::{self, Write};
use std::path::{Path, PathBuf};

use commitscape_core::{Index, LineDelta, Oid, RepoIdentity};

use crate::commit_at::CommitAt;
use foldhash::{HashMap, HashMapExt};
use xxhash_rust::xxh3::xxh3_64;

use super::CacheOptions;

const FILE: &str = "lines";
const MAGIC: &[u8] = b"commitscape lines 1\n";

#[derive(Debug, Clone)]
pub struct LineStore {
    dir: PathBuf,
}

pub type Counted = HashMap<Oid, Vec<Option<LineDelta>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogMark {
    pub len: u64,
    pub hash: u64,
}

impl LineStore {
    pub fn for_repo(options: &CacheOptions, repo: &RepoIdentity) -> Option<Self> {
        Some(LineStore {
            dir: super::repo_dir(options, repo)?,
        })
    }

    fn path(&self) -> PathBuf {
        self.dir.join(FILE)
    }

    /// Starts this store from another repository's, when it has none yet: lines are counted per commit, so the ones counted there for commits this repository shares (a fork's parent, say) are not counted again, and the others are never asked for. Only commits of `index` are taken whose changes this repository leaves out (`skipped`, by file) wherever the other left lines uncounted, so a file it keeps is never taken as having none. True when anything was taken.
    pub fn seed(&self, from: &Path, index: &Index, skipped: &[bool]) -> bool {
        let path = self.path();
        if path.exists() {
            return false;
        }
        let at = CommitAt::of(index);
        let fits = |id: &Oid, deltas: &[Option<LineDelta>]| {
            let Some(c) = at.get(index, id) else {
                return false;
            };
            let changes = index.changes_of(c);
            changes.len() == deltas.len()
                && changes.iter().zip(deltas).all(|(change, delta)| {
                    delta.is_some() || skipped.get(change.file.idx()).copied().unwrap_or(false)
                })
        };
        let temp = self.dir.join(format!("{FILE}.seeding"));
        let mut taken = 0usize;
        let written = (|| -> io::Result<bool> {
            std::fs::create_dir_all(&self.dir)?;
            let mut out = io::BufWriter::new(std::fs::File::create(&temp)?);
            out.write_all(MAGIC)?;
            let mut failed = None;
            let read = each_record(from, &mut |id, deltas, raw| {
                if failed.is_none() && fits(&id, &deltas) {
                    taken += 1;
                    if let Err(e) = out.write_all(raw) {
                        failed = Some(e);
                    }
                }
            });
            if let Some(e) = failed {
                return Err(e);
            }
            out.flush()?;
            Ok(read.is_some() && taken > 0)
        })();
        match written {
            Ok(true) => std::fs::rename(&temp, &path).is_ok(),
            _ => {
                let _ = std::fs::remove_file(&temp);
                false
            }
        }
    }

    pub fn read(&self) -> Counted {
        let path = self.path();
        let bytes = std::fs::read(&path).unwrap_or_default();
        let (counted, whole) = decode(&bytes);
        if whole == 0 && !bytes.is_empty() {
            let _ = std::fs::remove_file(&path);
        } else if whole < bytes.len() {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .and_then(|f| f.set_len(whole as u64));
        }
        counted
    }

    /// The lines kept for the commits in `wanted` only, read through the log a piece at a time without holding the rest.
    pub fn read_some(&self, wanted: &std::collections::HashSet<Oid>) -> Counted {
        let mut out = Counted::new();
        if wanted.is_empty() {
            return out;
        }
        let _ = each_record(&self.path(), &mut |id, deltas, _| {
            if wanted.contains(&id) {
                out.insert(id, deltas);
            }
        });
        out
    }

    /// Where the store's log ends now, and the commits counted into it after `mark`, an earlier end: `None` when the log no longer begins with what `mark` covered. The log is read a piece at a time.
    pub fn since(&self, mark: Option<LogMark>) -> (LogMark, Option<Vec<Oid>>) {
        let from = mark.map_or(0, |m| m.len);
        let empty = xxh3_64(&[]);
        let mut after = Vec::new();
        let mut hasher = xxhash_rust::xxh3::Xxh3::new();
        hasher.update(MAGIC);
        let mut whole = MAGIC.len() as u64;
        let mut at_mark = match from {
            0 => Some(empty),
            n if n == whole => Some(hasher.digest()),
            _ => None,
        };
        let read = each_record(&self.path(), &mut |id, _, raw| {
            if mark.is_some() && whole >= from {
                after.push(id);
            }
            hasher.update(raw);
            whole += raw.len() as u64;
            if whole == from {
                at_mark = Some(hasher.digest());
            }
        });
        let now = match read {
            Some(()) => LogMark {
                len: whole,
                hash: hasher.digest(),
            },
            None => LogMark {
                len: 0,
                hash: empty,
            },
        };
        let held = mark.filter(|m| m.len <= now.len && at_mark == Some(m.hash));
        (now, held.map(|_| after))
    }

    pub fn append(&self, counted: &[(Oid, Vec<Option<LineDelta>>)]) -> io::Result<()> {
        let mut out = Vec::new();
        for (id, deltas) in counted {
            encode(&mut out, *id, deltas);
        }
        let path = self.path();
        if !path.exists() {
            std::fs::create_dir_all(&self.dir)?;
            let mut fresh = MAGIC.to_vec();
            fresh.extend_from_slice(&out);
            return write_new(&path, &fresh);
        }
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)?
            .write_all(&out)
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(tmp, path)
}

fn encode(out: &mut Vec<u8>, id: Oid, deltas: &[Option<LineDelta>]) {
    out.extend_from_slice(&id.0);
    leb128(out, deltas.len() as u64);
    for d in deltas {
        match d {
            Some(d) => {
                leb128(out, u64::from(d.added) + 1);
                leb128(out, u64::from(d.removed));
            }
            None => leb128(out, 0),
        }
    }
}

pub(super) fn leb128(out: &mut Vec<u8>, mut n: u64) {
    loop {
        let byte = (n & 0x7f) as u8;
        n >>= 7;
        if n == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn decode(bytes: &[u8]) -> (Counted, usize) {
    let mut counted = Counted::new();
    let Some(mut rest) = bytes.strip_prefix(MAGIC) else {
        return (counted, 0);
    };
    let mut whole = MAGIC.len();
    while let Some((id, deltas, after)) = record(rest) {
        whole += rest.len() - after.len();
        counted.insert(id, deltas);
        rest = after;
    }
    (counted, whole)
}

type Record<'a> = (Oid, Vec<Option<LineDelta>>, &'a [u8]);

fn record(bytes: &[u8]) -> Option<Record<'_>> {
    let id: [u8; 20] = bytes.get(..20)?.try_into().ok()?;
    let (n, mut rest) = read_leb128(bytes.get(20..)?)?;
    let mut deltas = Vec::with_capacity(n.min(1 << 16) as usize);
    for _ in 0..n {
        let (added, after) = read_leb128(rest)?;
        rest = after;
        if added == 0 {
            deltas.push(None);
            continue;
        }
        let (removed, after) = read_leb128(rest)?;
        rest = after;
        deltas.push(Some(LineDelta {
            added: u32::try_from(added - 1).ok()?,
            removed: u32::try_from(removed).ok()?,
        }));
    }
    Some((Oid(id), deltas, rest))
}

pub(super) fn read_leb128(bytes: &[u8]) -> Option<(u64, &[u8])> {
    let mut n = 0u64;
    for (i, &b) in bytes.iter().enumerate().take(10) {
        n |= u64::from(b & 0x7f) << (7 * i);
        if b & 0x80 == 0 {
            return Some((n, bytes.get(i + 1..)?));
        }
    }
    None
}

type Visit<'a> = dyn FnMut(Oid, Vec<Option<LineDelta>>, &[u8]) + 'a;

fn each_record(path: &Path, visit: &mut Visit<'_>) -> Option<()> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf: Vec<u8> = Vec::with_capacity(1 << 20);
    let mut chunk = vec![0u8; 1 << 20];
    let mut started = false;
    let mut eof = false;
    loop {
        if !eof && buf.len() < 1 << 19 {
            let n = file.read(&mut chunk).ok()?;
            eof = n == 0;
            buf.extend_from_slice(chunk.get(..n).unwrap_or(&[]));
        }
        if !started {
            if buf.len() < MAGIC.len() && !eof {
                continue;
            }
            if !buf.starts_with(MAGIC) {
                return None;
            }
            buf.drain(..MAGIC.len());
            started = true;
        }
        let mut used = 0usize;
        while let Some((id, deltas, rest)) = buf.get(used..).and_then(record) {
            let len = buf.len() - used - rest.len();
            visit(id, deltas, buf.get(used..used + len).unwrap_or(&[]));
            used += len;
            if !eof && buf.len() - used < 1 << 16 {
                break;
            }
        }
        buf.drain(..used);
        if eof && (used == 0 || buf.is_empty()) {
            return Some(());
        }
    }
}
