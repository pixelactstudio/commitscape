use std::collections::HashMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use commitscape_core::{LineDelta, Oid, RepoIdentity};

use super::CacheOptions;

const FILE: &str = "lines";
const MAGIC: &[u8] = b"commitscape lines 1\n";

#[derive(Debug, Clone)]
pub struct LineStore {
    dir: PathBuf,
}

pub type Counted = HashMap<Oid, Vec<Option<LineDelta>>>;

impl LineStore {
    pub fn for_repo(options: &CacheOptions, repo: &RepoIdentity) -> Option<Self> {
        Some(LineStore {
            dir: super::repo_dir(options, repo)?,
        })
    }

    fn path(&self) -> PathBuf {
        self.dir.join(FILE)
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

fn leb128(out: &mut Vec<u8>, mut n: u64) {
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

fn read_leb128(bytes: &[u8]) -> Option<(u64, &[u8])> {
    let mut n = 0u64;
    for (i, &b) in bytes.iter().enumerate().take(10) {
        n |= u64::from(b & 0x7f) << (7 * i);
        if b & 0x80 == 0 {
            return Some((n, bytes.get(i + 1..)?));
        }
    }
    None
}
