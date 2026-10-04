use std::collections::HashMap;
use std::io::{self, Write};
use std::path::PathBuf;

use commitscape_core::{Oid, RepoIdentity};

use super::line_store::{leb128, read_leb128};
use super::CacheOptions;
use crate::blame::Blamed;

const DIR: &str = "blame";
const MAGIC: &[u8] = b"commitscape blame 2\n";
const FILE: u8 = 0;
const MOVES: u8 = 1;

#[derive(Debug, Clone)]
pub struct BlameStore {
    dir: PathBuf,
    name: String,
}

pub type Moved = Vec<(Vec<u8>, Vec<u8>)>;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Known {
    pub files: HashMap<Vec<u8>, Blamed>,
    pub moves: HashMap<Oid, Moved>,
}

impl BlameStore {
    pub fn for_head(
        options: &CacheOptions,
        repo: &RepoIdentity,
        head: Oid,
        settings: u64,
    ) -> Option<Self> {
        Some(BlameStore {
            dir: super::repo_dir(options, repo)?.join(DIR),
            name: format!("{}-{settings:016x}", head.to_hex()),
        })
    }

    fn path(&self) -> PathBuf {
        self.dir.join(&self.name)
    }

    pub fn read(&self) -> Known {
        let path = self.path();
        let bytes = std::fs::read(&path).unwrap_or_default();
        let (known, whole) = decode(&bytes);
        if whole == 0 && !bytes.is_empty() {
            let _ = std::fs::remove_file(&path);
        } else if whole < bytes.len() {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .and_then(|f| f.set_len(whole as u64));
        }
        known
    }

    pub fn append_file(&self, path: &[u8], blamed: &Blamed) -> io::Result<()> {
        let mut out = vec![FILE];
        bytes(&mut out, path);
        leb128(&mut out, blamed.len() as u64);
        for (id, lines) in blamed {
            out.extend_from_slice(&id.0);
            leb128(&mut out, u64::from(*lines));
        }
        self.append(&out)
    }

    pub fn append_moves(&self, commit: Oid, moved: &Moved) -> io::Result<()> {
        let mut out = vec![MOVES];
        out.extend_from_slice(&commit.0);
        leb128(&mut out, moved.len() as u64);
        for (from, to) in moved {
            bytes(&mut out, from);
            bytes(&mut out, to);
        }
        self.append(&out)
    }

    fn append(&self, record: &[u8]) -> io::Result<()> {
        let file = self.path();
        if !file.exists() {
            std::fs::create_dir_all(&self.dir)?;
            if let Ok(others) = std::fs::read_dir(&self.dir) {
                for other in others.flatten() {
                    if other.file_name() != self.name.as_str() {
                        let _ = std::fs::remove_file(other.path());
                    }
                }
            }
            let mut fresh = MAGIC.to_vec();
            fresh.extend_from_slice(record);
            let tmp = file.with_extension("tmp");
            std::fs::write(&tmp, fresh)?;
            return std::fs::rename(tmp, file);
        }
        std::fs::OpenOptions::new()
            .append(true)
            .open(&file)?
            .write_all(record)
    }
}

fn bytes(out: &mut Vec<u8>, b: &[u8]) {
    leb128(out, b.len() as u64);
    out.extend_from_slice(b);
}

fn read_bytes(input: &[u8]) -> Option<(Vec<u8>, &[u8])> {
    let (len, rest) = read_leb128(input)?;
    let len = usize::try_from(len).ok()?;
    Some((rest.get(..len)?.to_vec(), rest.get(len..)?))
}

fn decode(bytes: &[u8]) -> (Known, usize) {
    let mut known = Known::default();
    let Some(mut rest) = bytes.strip_prefix(MAGIC) else {
        return (known, 0);
    };
    let mut whole = MAGIC.len();
    while let Some(after) = record(rest, &mut known) {
        whole += rest.len() - after.len();
        rest = after;
    }
    (known, whole)
}

fn record<'a>(input: &'a [u8], known: &mut Known) -> Option<&'a [u8]> {
    let (&tag, rest) = input.split_first()?;
    match tag {
        FILE => {
            let (path, rest) = read_bytes(rest)?;
            let (n, mut rest) = read_leb128(rest)?;
            let mut blamed = Vec::with_capacity(n.min(1 << 16) as usize);
            for _ in 0..n {
                let id: [u8; 20] = rest.get(..20)?.try_into().ok()?;
                let (lines, after) = read_leb128(rest.get(20..)?)?;
                blamed.push((Oid(id), u32::try_from(lines).ok()?));
                rest = after;
            }
            known.files.insert(path, blamed);
            Some(rest)
        }
        MOVES => {
            let id: [u8; 20] = rest.get(..20)?.try_into().ok()?;
            let (n, mut rest) = read_leb128(rest.get(20..)?)?;
            let mut moved = Vec::with_capacity(n.min(1 << 16) as usize);
            for _ in 0..n {
                let (from, after) = read_bytes(rest)?;
                let (to, after) = read_bytes(after)?;
                moved.push((from, to));
                rest = after;
            }
            known.moves.insert(Oid(id), moved);
            Some(rest)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(n: u8) -> Oid {
        Oid([n; 20])
    }

    #[test]
    fn records_survive_a_torn_tail_and_a_new_head_clears_the_old_one() {
        let dir = tempfile::tempdir().unwrap();
        let options = CacheOptions {
            root: Some(dir.path().to_path_buf()),
        };
        let repo = RepoIdentity {
            git_dir: "/r/.git".to_string(),
        };
        let first = BlameStore::for_head(&options, &repo, oid(1), 7).unwrap();
        assert_eq!(first.read(), Known::default());
        first
            .append_file(b"src/a.rs", &vec![(oid(2), 3), (oid(3), 1)])
            .unwrap();
        first.append_file(b"src/b.rs", &vec![]).unwrap();
        first
            .append_moves(oid(5), &vec![(b"old.rs".to_vec(), b"new.rs".to_vec())])
            .unwrap();
        let path = first.path();
        let mut bytes = std::fs::read(&path).unwrap();
        bytes.extend_from_slice(&[FILE, 9, b's']);
        std::fs::write(&path, &bytes).unwrap();

        let known = first.read();
        assert_eq!(known.files.len(), 2);
        assert_eq!(
            known.files.get(b"src/a.rs".as_slice()),
            Some(&vec![(oid(2), 3), (oid(3), 1)])
        );
        assert_eq!(known.files.get(b"src/b.rs".as_slice()), Some(&vec![]));
        assert_eq!(
            known.moves.get(&oid(5)),
            Some(&vec![(b"old.rs".to_vec(), b"new.rs".to_vec())])
        );
        assert_eq!(std::fs::read(&path).unwrap().len(), bytes.len() - 3);

        let second = BlameStore::for_head(&options, &repo, oid(4), 7).unwrap();
        assert_eq!(second.read(), Known::default());
        second.append_file(b"src/a.rs", &vec![(oid(4), 2)]).unwrap();
        assert!(!path.exists());
        assert_eq!(first.read(), Known::default());
    }
}
