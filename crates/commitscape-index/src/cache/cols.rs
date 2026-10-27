use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use commitscape_core::{Column, CommitFlags, CommitMeta, FileChange, Index, Record};
use commitscape_map::Records;
use serde::{Deserialize, Serialize};

const MAGIC: [u8; 8] = *b"CSCOLS01";
const PAGE: u64 = 4096;
const SECTIONS: usize = 4;
const MERGING: &str = "merging.part";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Trailer {
    sections: [(u64, u64); SECTIONS],
    bulk: u32,
    skipped: Vec<u8>,
}

/// What the line pass masked the kept Lines Changed with: the Bulk Commit size and, file by file, which files it leaves out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Masking {
    pub bulk: u32,
    pub skipped: Vec<bool>,
}

impl Masking {
    /// The files whose lines `now` keeps where `self` left them out, or the other way round, when lines masked with `self` can be brought to `now` file by file: the same Bulk Commit size, and no file forgotten. Files new since only reach commits not counted yet.
    pub fn flips(&self, now: &Masking) -> Option<Vec<usize>> {
        (self.bulk == now.bulk && self.skipped.len() <= now.skipped.len()).then(|| {
            now.skipped
                .iter()
                .zip(&self.skipped)
                .enumerate()
                .filter(|(_, (a, b))| a != b)
                .map(|(i, _)| i)
                .collect()
        })
    }
}

/// The Index's columns kept beside the cache for one generation, with each commit's Lines Changed in its changes and whether they are settled.
pub type Mapped = (Column<CommitMeta>, Column<FileChange>, Column<u8>);

pub struct Kept {
    path: PathBuf,
    sections: [(u64, u64); SECTIONS],
    pub settled: Column<u8>,
    pub masking: Masking,
}

fn path_of(dir: &Path, generation: u64) -> PathBuf {
    dir.join(format!("{generation:016x}.cols"))
}

fn aligned(at: u64) -> u64 {
    at.div_ceil(PAGE) * PAGE
}

fn bits(skipped: &[bool]) -> Vec<u8> {
    skipped
        .chunks(8)
        .map(|c| {
            c.iter()
                .enumerate()
                .fold(0u8, |b, (i, &s)| b | (u8::from(s) << i))
        })
        .collect()
}

fn unbits(bytes: &[u8], len: usize) -> Vec<bool> {
    (0..len)
        .map(|i| bytes.get(i / 8).is_some_and(|b| b >> (i % 8) & 1 == 1))
        .collect()
}

struct Sink {
    file: File,
    at: u64,
    pending: Vec<u8>,
    record: Vec<u8>,
}

const PENDING: usize = 1 << 20;

impl Sink {
    fn at(file: &File, offset: u64) -> std::io::Result<Sink> {
        Ok(Sink {
            file: file.try_clone()?,
            at: offset,
            pending: Vec::with_capacity(PENDING),
            record: Vec::new(),
        })
    }

    fn put<T: Record>(&mut self, r: &T) -> std::io::Result<()> {
        self.record.resize(T::SIZE, 0);
        r.write_to(&mut self.record);
        let record = std::mem::take(&mut self.record);
        self.bytes(&record)?;
        self.record = record;
        Ok(())
    }

    fn bytes(&mut self, b: &[u8]) -> std::io::Result<()> {
        self.pending.extend_from_slice(b);
        if self.pending.len() >= PENDING {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        commitscape_map::write_all_at(&self.file, &self.pending, self.at)?;
        self.at += self.pending.len() as u64;
        self.pending.clear();
        Ok(())
    }

    fn done(mut self) -> std::io::Result<()> {
        self.flush()
    }
}

fn layout(commits: u64, changes: u64, subjects: u64) -> [(u64, u64); SECTIONS] {
    let mut at = PAGE;
    let mut out = [(0, 0); SECTIONS];
    for (slot, (count, size)) in out.iter_mut().zip([
        (commits, CommitMeta::SIZE as u64),
        (changes, FileChange::SIZE as u64),
        (subjects, 1),
        (commits, 1),
    ]) {
        *slot = (at, count);
        at = aligned(at + count * size);
    }
    out
}

fn finish(file: &File, sections: [(u64, u64); SECTIONS], masking: &Masking) -> std::io::Result<()> {
    let end = sections
        .iter()
        .zip([CommitMeta::SIZE as u64, FileChange::SIZE as u64, 1, 1])
        .map(|((at, n), size)| at + n * size)
        .max()
        .unwrap_or(PAGE);
    write_trailer(file, aligned(end), sections, masking)
}

fn write_trailer(
    file: &File,
    at: u64,
    sections: [(u64, u64); SECTIONS],
    masking: &Masking,
) -> std::io::Result<()> {
    let trailer = Trailer {
        sections,
        bulk: masking.bulk,
        skipped: bits(&masking.skipped),
    };
    let mut tail = bincode::serde::encode_to_vec(&trailer, bincode::config::standard())
        .map_err(std::io::Error::other)?;
    let len = tail.len() as u64;
    tail.extend_from_slice(&len.to_le_bytes());
    tail.extend_from_slice(&(masking.skipped.len() as u64).to_le_bytes());
    tail.extend_from_slice(&MAGIC);
    commitscape_map::write_all_at(file, &MAGIC, 0)?;
    commitscape_map::write_all_at(file, &tail, at)?;
    let end = at + tail.len() as u64;
    if file.metadata()?.len() == end {
        return Ok(());
    }
    file.set_len(end)
}

fn clean(commit: &CommitMeta) -> CommitMeta {
    CommitMeta {
        flags: CommitFlags(commit.flags.0 & !CommitFlags::BLAME_IGNORED.0),
        ..*commit
    }
}

/// Writes the Index's columns for `generation` beside the cache, whole into a temporary file then moved into place, with the commits' settled marks and the masking their lines were counted with. Blame's ignored marks, which each Build sets again, are left out.
pub fn write(
    dir: &Path,
    generation: u64,
    index: &Index,
    settled: &[u8],
    masking: &Masking,
) -> std::io::Result<()> {
    let temp = dir.join(format!("{generation:016x}.cols.writing"));
    let file = File::create(&temp)?;
    let sections = layout(
        index.commits.len() as u64,
        index.changes.len() as u64,
        index.subjects.len() as u64,
    );
    let [c, ch, s, st] = sections;
    let mut commits = Sink::at(&file, c.0)?;
    for commit in index.commits.iter() {
        commits.put(&clean(commit))?;
    }
    commits.done()?;
    let mut changes = Sink::at(&file, ch.0)?;
    for change in index.changes.iter() {
        changes.put(change)?;
    }
    changes.done()?;
    let mut subjects = Sink::at(&file, s.0)?;
    subjects.bytes(&index.subjects)?;
    subjects.done()?;
    let mut marks = Sink::at(&file, st.0)?;
    marks.bytes(
        &settled
            .iter()
            .take(index.commits.len())
            .copied()
            .collect::<Vec<u8>>(),
    )?;
    marks.bytes(&vec![0; index.commits.len().saturating_sub(settled.len())])?;
    marks.done()?;
    finish(&file, sections, masking)?;
    file.sync_data()?;
    std::fs::rename(temp, path_of(dir, generation))
}

/// Merges new commits, already in order, into the mapped columns of `base`, writing the result straight to a file and mapping it: no column of the base is copied into memory. The new commits are not settled.
pub fn merge(
    dir: &Path,
    base: &Index,
    base_settled: &[u8],
    masking: &Masking,
    commits: &[CommitMeta],
    changes: &[FileChange],
    subjects: &[u8],
) -> std::io::Result<(Mapped, Kept)> {
    let temp = dir.join(MERGING);
    let file = File::create(&temp)?;
    let sections = layout(
        (base.commits.len() + commits.len()) as u64,
        (base.changes.len() + changes.len()) as u64,
        (base.subjects.len() + subjects.len()) as u64,
    );
    let [c, ch, s, st] = sections;
    let mut out_commits = Sink::at(&file, c.0)?;
    let mut out_changes = Sink::at(&file, ch.0)?;
    let mut out_subjects = Sink::at(&file, s.0)?;
    let mut out_settled = Sink::at(&file, st.0)?;
    let key = |c: &CommitMeta| (c.time, c.id.0);
    let base_changes: &[FileChange] = &base.changes;
    let base_subjects: &[u8] = &base.subjects;
    let (mut a, mut b) = (0usize, 0usize);
    let (mut change_at, mut subject_at) = (0u32, 0u32);
    loop {
        let from_base = match (base.commits.get(a), commits.get(b)) {
            (Some(x), Some(y)) => key(x) <= key(y),
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => break,
        };
        let (commit, arena, texts, mark) = if from_base {
            a += 1;
            (
                base.commits.get(a - 1),
                base_changes,
                base_subjects,
                base_settled.get(a - 1).copied().unwrap_or(0),
            )
        } else {
            b += 1;
            (commits.get(b - 1), changes, subjects, 0)
        };
        let Some(commit) = commit else {
            break;
        };
        for change in arena.get(commit.changes()).unwrap_or(&[]) {
            out_changes.put(change)?;
        }
        let text = texts.get(commit.subject()).unwrap_or(&[]);
        out_subjects.bytes(text)?;
        out_commits.put(&clean(&CommitMeta {
            changes_start: change_at,
            subject_start: subject_at,
            subject_len: text.len() as u8,
            ..*commit
        }))?;
        out_settled.bytes(&[mark])?;
        change_at += commit.changes_len;
        subject_at += text.len() as u32;
    }
    for sink in [out_commits, out_changes, out_subjects, out_settled] {
        sink.done()?;
    }
    finish(&file, sections, masking)?;
    drop(file);
    open(&temp)
}

fn open(path: &Path) -> std::io::Result<(Mapped, Kept)> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut tail = [0u8; 24];
    file.seek(SeekFrom::Start(
        size.checked_sub(24)
            .ok_or_else(|| std::io::Error::other("too short"))?,
    ))?;
    file.read_exact(&mut tail)?;
    let (len, rest) = tail.split_at(8);
    let (files, magic) = rest.split_at(8);
    if magic != MAGIC {
        return Err(std::io::Error::other("not a column file"));
    }
    let len = u64::from_le_bytes(len.try_into().map_err(std::io::Error::other)?);
    let files = u64::from_le_bytes(files.try_into().map_err(std::io::Error::other)?) as usize;
    let mut body = vec![0u8; len as usize];
    file.seek(SeekFrom::Start(size - 24 - len))?;
    file.read_exact(&mut body)?;
    let (trailer, _): (Trailer, usize) =
        bincode::serde::decode_from_slice(&body, bincode::config::standard())
            .map_err(std::io::Error::other)?;
    let [c, ch, s, st] = trailer.sections;
    let count = |n: u64| usize::try_from(n).map_err(std::io::Error::other);
    let commits = Column::mapped(Box::new(Records::<CommitMeta>::open(
        &file,
        c.0,
        count(c.1)?,
    )?));
    let changes = Column::mapped(Box::new(Records::<FileChange>::open(
        &file,
        ch.0,
        count(ch.1)?,
    )?));
    let subjects = Column::mapped(Box::new(Records::<u8>::open(&file, s.0, count(s.1)?)?));
    let settled = Column::mapped(Box::new(Records::<u8>::open(&file, st.0, count(st.1)?)?));
    let kept = Kept {
        path: path.to_path_buf(),
        sections: trailer.sections,
        settled,
        masking: Masking {
            bulk: trailer.bulk,
            skipped: unbits(&trailer.skipped, files),
        },
    };
    Ok(((commits, changes, subjects), kept))
}

/// Maps the columns kept for `generation`, when they are there and hold as many commits and changes as the cache says.
pub fn read(dir: &Path, generation: u64, counts: (usize, usize)) -> Option<(Mapped, Kept)> {
    let (mapped, kept) = open(&path_of(dir, generation)).ok()?;
    ((mapped.0.len(), mapped.1.len()) == counts).then_some((mapped, kept))
}

impl Kept {
    /// Moves a merged column file into place as the columns of `generation`.
    pub fn settle_as(&mut self, dir: &Path, generation: u64) -> std::io::Result<()> {
        let to = path_of(dir, generation);
        std::fs::rename(&self.path, &to)?;
        self.path = to;
        Ok(())
    }

    /// Keeps the same columns for another generation of the cache, whose commits did not change.
    pub fn link_as(&mut self, dir: &Path, generation: u64) -> std::io::Result<()> {
        let to = path_of(dir, generation);
        if std::fs::hard_link(&self.path, &to).is_err() {
            std::fs::copy(&self.path, &to)?;
        }
        self.path = to;
        Ok(())
    }

    /// Writes into the file the changes and settled marks of the commits given, as they now are in `index`, and the masking. The file reads as no columns until the writes are on disk, so a Build stopped halfway reads the lines from the store again rather than trust them.
    pub fn save(&self, index: &Index, commits: &[usize], masking: &Masking) -> std::io::Result<()> {
        let file = std::fs::OpenOptions::new().write(true).open(&self.path)?;
        let size = file.metadata()?.len();
        let sealed = size
            .checked_sub(MAGIC.len() as u64)
            .ok_or_else(|| std::io::Error::other("too short"))?;
        commitscape_map::write_all_at(&file, &[0; MAGIC.len()], sealed)?;
        file.sync_data()?;
        let [_, ch, _, st] = self.sections;
        let mut buf = Vec::new();
        for &i in commits {
            let Some(c) = index.commits.get(i) else {
                continue;
            };
            let Some(changes) = index.changes.get(c.changes()) else {
                continue;
            };
            buf.clear();
            for change in changes {
                let at = buf.len();
                buf.resize(at + FileChange::SIZE, 0);
                if let Some(slot) = buf.get_mut(at..) {
                    change.write_to(slot);
                }
            }
            commitscape_map::write_all_at(
                &file,
                &buf,
                ch.0 + u64::from(c.changes_start) * FileChange::SIZE as u64,
            )?;
            commitscape_map::write_all_at(
                &file,
                &[self.settled.get(i).copied().unwrap_or(0)],
                st.0 + i as u64,
            )?;
        }
        file.sync_data()?;
        let end = aligned(st.0 + st.1);
        write_trailer(&file, end, self.sections, masking)
    }
}

/// Deletes column files no generation in `keep` names, and merges left half-written.
pub fn tidy(dir: &Path, keep: &[u64]) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let names: Vec<String> = keep.iter().map(|g| format!("{g:016x}.cols")).collect();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let stale =
            (name.ends_with(".cols") && !names.contains(&name)) || name.ends_with(".cols.writing");
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
