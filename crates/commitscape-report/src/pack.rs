use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::os::unix::fs::FileExt;
use std::path::Path;

use commitscape_core::{Column, CommitMeta, FileChange, Index, Record};
use commitscape_map::Records;
use commitscape_metrics::Options;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

use crate::api;
use crate::report::Report;

pub const MAGIC: &[u8] = b"commitscape pack 3\n";

const MAGIC_2: &[u8] = b"commitscape pack 1\n";

const UNPACKED: &[u8; 8] = b"CSUNPK03";

pub const FORMAT: u32 = 3;

const LEVEL: u32 = 6;

const SECTIONS: usize = 5;

const PAGE: u64 = 4096;

const NO_ARRIVAL: i64 = i64::MIN;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pack {
    pub format: u32,
    pub name: String,
    pub head: Option<String>,
    pub lineage: u64,
    pub anchor: i64,
    pub options: Options,
    pub lines_counted: bool,
    pub lines_complete: bool,
    pub lines_mainline: bool,
    pub index: Index,
    pub logins: Vec<(u32, String)>,
    pub colours: Vec<(u32, u8)>,
    pub releases: Vec<(String, i64)>,
    pub release_commits: Vec<(String, String)>,
    pub mainline: Vec<u8>,
    pub arrival: Vec<Option<i64>>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Reading {
    pub lineage: u64,
    pub lines_complete: bool,
    pub lines_mainline: bool,
    pub mainline: Vec<u8>,
    pub arrival: Vec<Option<i64>>,
    pub release_commits: Vec<(String, String)>,
}

#[derive(Debug)]
pub enum PackError {
    Io(std::io::Error),
    NotAPack,
    Format(u32),
    Encode(String),
    Decode(String),
}

impl std::fmt::Display for PackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackError::Io(e) => write!(f, "could not read or write the pack: {e}"),
            PackError::NotAPack => write!(f, "not a commitscape pack"),
            PackError::Format(n) => write!(f, "pack format {n}, expected {FORMAT}"),
            PackError::Encode(e) => write!(f, "could not encode the pack: {e}"),
            PackError::Decode(e) => write!(f, "could not decode the pack: {e}"),
        }
    }
}

impl std::error::Error for PackError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            PackError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for PackError {
    fn from(e: std::io::Error) -> Self {
        PackError::Io(e)
    }
}

impl Pack {
    /// Makes the pack of a Report's Index at its head, with what the same reading worked out beside it, and every email address in it blanked once the people and their logins are resolved.
    pub fn of(report: Report, reading: Reading) -> Pack {
        let logins = api::logins(&report.index, &report.accounts);
        let mut logins: Vec<(u32, String)> = api::login_of(&logins)
            .into_iter()
            .map(|(id, login)| (id.0, login))
            .collect();
        logins.sort();
        let mut colours: Vec<(u32, u8)> = api::colours(&report.index)
            .into_iter()
            .map(|(id, colour)| (id.0, colour))
            .collect();
        colours.sort();
        let mut index = report.index;
        index.authors.blank_emails();
        Pack {
            format: FORMAT,
            name: report.name,
            head: index.head_commit.map(|h| h.to_hex()),
            lineage: reading.lineage,
            anchor: report.anchor,
            options: report.options,
            lines_counted: report.lines_counted,
            lines_complete: reading.lines_complete,
            lines_mainline: reading.lines_mainline,
            index,
            logins,
            colours,
            releases: report.releases,
            release_commits: reading.release_commits,
            mainline: reading.mainline,
            arrival: reading.arrival,
        }
    }

    /// About how many bytes the pack holds in memory once read.
    pub fn heap_bytes(&self) -> usize {
        let text = |s: &String| s.capacity();
        self.index.heap_bytes()
            + std::mem::size_of::<Pack>()
            + text(&self.name)
            + self.head.as_ref().map_or(0, text)
            + self.logins.capacity() * std::mem::size_of::<(u32, String)>()
            + self.logins.iter().map(|(_, l)| text(l)).sum::<usize>()
            + self.colours.capacity() * std::mem::size_of::<(u32, u8)>()
            + self.releases.capacity() * std::mem::size_of::<(String, i64)>()
            + self.releases.iter().map(|(n, _)| text(n)).sum::<usize>()
            + self.release_commits.capacity() * std::mem::size_of::<(String, String)>()
            + self
                .release_commits
                .iter()
                .map(|(n, c)| text(n) + text(c))
                .sum::<usize>()
            + self.mainline.capacity()
            + self.arrival.capacity() * std::mem::size_of::<Option<i64>>()
    }
}

fn config() -> bincode::config::Configuration {
    bincode::config::standard()
}

struct Counting<W: Write> {
    inner: W,
    n: u64,
}

impl<W: Write> Write for Counting<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.n += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

fn section<W: Write>(
    out: &mut Counting<W>,
    fill: &mut dyn FnMut(&mut dyn Write) -> std::io::Result<()>,
) -> std::io::Result<(u64, u64)> {
    let start = out.n;
    let n = {
        let mut raw = Counting {
            inner: BufWriter::with_capacity(
                1 << 16,
                ZlibEncoder::new(&mut *out, Compression::new(LEVEL)),
            ),
            n: 0,
        };
        fill(&mut raw)?;
        let n = raw.n;
        raw.inner
            .into_inner()
            .map_err(std::io::IntoInnerError::into_error)?
            .finish()?;
        n
    };
    Ok((n, out.n - start))
}

fn records<T: Record>(out: &mut dyn Write, items: &[T]) -> std::io::Result<()> {
    let mut buf = vec![0u8; T::SIZE * 4096];
    for chunk in items.chunks(4096) {
        for (r, slot) in chunk.iter().zip(buf.chunks_exact_mut(T::SIZE)) {
            r.write_to(slot);
        }
        out.write_all(buf.get(..chunk.len() * T::SIZE).unwrap_or(&[]))?;
    }
    Ok(())
}

/// Writes a pack: its magic line, the zlib of its bincode without the Index's long columns, then each column as zlib of its records, and a table of the sections' sizes at the end.
pub fn write_pack(pack: &mut Pack, out: &mut impl Write) -> Result<(), PackError> {
    let commits = std::mem::take(&mut pack.index.commits);
    let changes = std::mem::take(&mut pack.index.changes);
    let subjects = std::mem::take(&mut pack.index.subjects);
    let arrival = std::mem::take(&mut pack.arrival);
    let written = write_sections(pack, &commits, &changes, &subjects, &arrival, out);
    pack.index.commits = commits;
    pack.index.changes = changes;
    pack.index.subjects = subjects;
    pack.arrival = arrival;
    written
}

fn write_sections(
    rest: &Pack,
    commits: &[CommitMeta],
    changes: &[FileChange],
    subjects: &[u8],
    arrival: &[Option<i64>],
    out: &mut impl Write,
) -> Result<(), PackError> {
    out.write_all(MAGIC)?;
    let mut out = Counting { inner: out, n: 0 };
    let mut sizes = Vec::with_capacity(SECTIONS);
    sizes.push(section(&mut out, &mut |mut w| {
        bincode::serde::encode_into_std_write(rest, &mut w, config())
            .map(|_| ())
            .map_err(|e| std::io::Error::other(e.to_string()))
    })?);
    sizes.push(section(&mut out, &mut |w| records(w, commits))?);
    sizes.push(section(&mut out, &mut |w| records(w, changes))?);
    sizes.push(section(&mut out, &mut |w| w.write_all(subjects))?);
    sizes.push(section(&mut out, &mut |w| {
        for chunk in arrival.chunks(4096) {
            let bytes: Vec<u8> = chunk
                .iter()
                .flat_map(|a| a.unwrap_or(NO_ARRIVAL).to_le_bytes())
                .collect();
            w.write_all(&bytes)?;
        }
        Ok(())
    })?);
    for (raw, packed) in &sizes {
        out.write_all(&raw.to_le_bytes())?;
        out.write_all(&packed.to_le_bytes())?;
    }
    out.write_all(&(sizes.len() as u32).to_le_bytes())?;
    Ok(())
}

const TAIL: usize = 4 + 16 * SECTIONS;

fn sections(tail: &[u8], size: u64) -> Result<Vec<(u64, u64, u64)>, PackError> {
    let bad = || PackError::Decode("the section table does not add up".into());
    let count = tail
        .get(TAIL - 4..TAIL)
        .and_then(|b| b.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or_else(bad)?;
    if count as usize != SECTIONS {
        return Err(bad());
    }
    let mut at = MAGIC.len() as u64;
    let mut out = Vec::with_capacity(SECTIONS);
    for i in 0..SECTIONS {
        let e = 16 * i;
        let raw = tail
            .get(e..e + 8)
            .and_then(|b| b.try_into().ok())
            .map(u64::from_le_bytes)
            .ok_or_else(bad)?;
        let packed = tail
            .get(e + 8..e + 16)
            .and_then(|b| b.try_into().ok())
            .map(u64::from_le_bytes)
            .ok_or_else(bad)?;
        out.push((at, packed, raw));
        at = at.checked_add(packed).ok_or_else(bad)?;
    }
    if at + TAIL as u64 != size {
        return Err(bad());
    }
    Ok(out)
}

fn table(bytes: &[u8]) -> Result<Vec<(u64, u64, u64)>, PackError> {
    let from = bytes.len().checked_sub(TAIL).ok_or(PackError::NotAPack)?;
    sections(bytes.get(from..).unwrap_or(&[]), bytes.len() as u64)
}

fn footer(file: &File) -> Result<Vec<(u64, u64, u64)>, PackError> {
    let size = file.metadata()?.len();
    let mut head = vec![0u8; MAGIC.len()];
    file.read_exact_at(&mut head, 0)?;
    if head != MAGIC {
        return Err(PackError::NotAPack);
    }
    let mut tail = vec![0u8; TAIL];
    file.read_exact_at(
        &mut tail,
        size.checked_sub(TAIL as u64).ok_or(PackError::NotAPack)?,
    )?;
    sections(&tail, size)
}

fn inflate(bytes: &[u8], raw: u64) -> Result<Vec<u8>, PackError> {
    let mut out = Vec::with_capacity(usize::try_from(raw).unwrap_or(0));
    ZlibDecoder::new(bytes).read_to_end(&mut out)?;
    if out.len() as u64 != raw {
        return Err(PackError::Decode(
            "a section is not as long as its table says".into(),
        ));
    }
    Ok(out)
}

fn decoded_rest(bytes: &[u8]) -> Result<Pack, PackError> {
    let format: u32 = bincode::serde::decode_from_slice(bytes, config())
        .map(|(f, _)| f)
        .map_err(|e| PackError::Decode(e.to_string()))?;
    if format != FORMAT {
        return Err(PackError::Format(format));
    }
    bincode::serde::decode_from_slice(bytes, config())
        .map(|(pack, _)| pack)
        .map_err(|e| PackError::Decode(e.to_string()))
}

fn column<T: Record>(records: std::io::Result<Records<T>>) -> Result<Column<T>, PackError> {
    Ok(Column::mapped(Box::new(
        records.map_err(|e| PackError::Decode(e.to_string()))?,
    )))
}

/// Reads a pack `write_pack` wrote, or one of format 2, whole into memory.
pub fn read_pack(bytes: &[u8]) -> Result<Pack, PackError> {
    if let Some(rest) = bytes.strip_prefix(MAGIC_2) {
        return read_pack_2(rest);
    }
    if !bytes.starts_with(MAGIC) {
        return Err(PackError::NotAPack);
    }
    let sections = table(bytes)?;
    let part = |i: usize| -> Result<Vec<u8>, PackError> {
        let &(at, packed, raw) = sections
            .get(i)
            .ok_or_else(|| PackError::Decode("a section is missing".into()))?;
        let at = usize::try_from(at).map_err(|e| PackError::Decode(e.to_string()))?;
        let to = at + usize::try_from(packed).map_err(|e| PackError::Decode(e.to_string()))?;
        inflate(bytes.get(at..to).unwrap_or(&[]), raw)
    };
    let mut pack = decoded_rest(&part(0)?)?;
    pack.index.commits = column(Records::<CommitMeta>::copied(&part(1)?))?;
    pack.index.changes = column(Records::<FileChange>::copied(&part(2)?))?;
    pack.index.subjects = column(Records::<u8>::copied(&part(3)?))?;
    pack.arrival = arrivals(&part(4)?);
    Ok(pack)
}

fn read_pack_2(rest: &[u8]) -> Result<Pack, PackError> {
    let mut payload = Vec::with_capacity(rest.len().saturating_mul(4));
    ZlibDecoder::new(rest).read_to_end(&mut payload)?;
    let format: u32 = bincode::serde::decode_from_slice(&payload, config())
        .map(|(f, _)| f)
        .map_err(|e| PackError::Decode(e.to_string()))?;
    if format != 2 {
        return Err(PackError::Format(format));
    }
    bincode::serde::decode_from_slice(&payload, config())
        .map(|(pack, _)| pack)
        .map_err(|e| PackError::Decode(e.to_string()))
}

/// Unpacks a pack of this format from `from` into `to`, its columns laid out on page boundaries to be mapped by `open_unpacked`, streaming each section so only a little of it is in memory at once. Returns the bytes written; a pack of an older format is `PackError::Format`, to be read whole instead.
pub fn unpack(from: &Path, to: &Path) -> Result<u64, PackError> {
    let file = File::open(from)?;
    let mut head = vec![0u8; MAGIC.len().max(MAGIC_2.len())];
    file.read_exact_at(&mut head, 0)?;
    if head.starts_with(MAGIC_2) {
        return Err(PackError::Format(2));
    }
    let sections = footer(&file)?;
    let part = to.with_extension("part");
    let out = File::create(&part)?;
    let mut placed: Vec<(u64, u64)> = Vec::with_capacity(SECTIONS);
    let mut at = PAGE;
    for &(from_at, packed, raw) in &sections {
        let mut reader = BufReader::with_capacity(1 << 16, &file);
        reader.seek(SeekFrom::Start(from_at))?;
        let mut z = ZlibDecoder::new(reader.take(packed));
        let mut buf = vec![0u8; 1 << 20];
        let mut written = 0u64;
        loop {
            let n = z.read(&mut buf)?;
            if n == 0 {
                break;
            }
            out.write_all_at(buf.get(..n).unwrap_or(&[]), at + written)?;
            written += n as u64;
        }
        if written != raw {
            let _ = std::fs::remove_file(&part);
            return Err(PackError::Decode(
                "a section is not as long as its table says".into(),
            ));
        }
        placed.push((at, raw));
        at = (at + raw).div_ceil(PAGE) * PAGE;
    }
    let mut header = UNPACKED.to_vec();
    for (offset, len) in &placed {
        header.extend_from_slice(&offset.to_le_bytes());
        header.extend_from_slice(&len.to_le_bytes());
    }
    out.write_all_at(&header, 0)?;
    out.set_len(at.max(PAGE))?;
    out.sync_data()?;
    drop(out);
    std::fs::rename(&part, to)?;
    Ok(at.max(PAGE))
}

/// Opens a pack `unpack` laid out, the Index's columns read in place from the file.
pub fn open_unpacked(path: &Path) -> Result<Pack, PackError> {
    let file = File::open(path)?;
    let mut header = vec![0u8; UNPACKED.len() + 16 * SECTIONS];
    file.read_exact_at(&mut header, 0)?;
    if header.get(..UNPACKED.len()) != Some(UNPACKED.as_slice()) {
        return Err(PackError::NotAPack);
    }
    let placed: Vec<(u64, usize)> = (0..SECTIONS)
        .filter_map(|i| {
            let e = UNPACKED.len() + 16 * i;
            let offset = u64::from_le_bytes(header.get(e..e + 8)?.try_into().ok()?);
            let len = u64::from_le_bytes(header.get(e + 8..e + 16)?.try_into().ok()?);
            Some((offset, usize::try_from(len).ok()?))
        })
        .collect();
    let [rest, commits, changes, subjects, arrival] = placed.as_slice() else {
        return Err(PackError::Decode(
            "the unpacked pack has no section table".into(),
        ));
    };
    let mut bytes = vec![0u8; rest.1];
    file.read_exact_at(&mut bytes, rest.0)?;
    let mut pack = decoded_rest(&bytes)?;
    drop(bytes);
    pack.index.commits = column(Records::<CommitMeta>::open(
        &file,
        commits.0,
        commits.1 / CommitMeta::SIZE,
    ))?;
    pack.index.changes = column(Records::<FileChange>::open(
        &file,
        changes.0,
        changes.1 / FileChange::SIZE,
    ))?;
    pack.index.subjects = column(Records::<u8>::open(&file, subjects.0, subjects.1))?;
    let mut times = vec![0u8; arrival.1];
    file.read_exact_at(&mut times, arrival.0)?;
    pack.arrival = arrivals(&times);
    Ok(pack)
}

fn arrivals(bytes: &[u8]) -> Vec<Option<i64>> {
    bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|&b| Some(i64::from_le_bytes(b)).filter(|&t| t != NO_ARRIVAL))
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]

    use super::*;
    use commitscape_core::Oid;
    use commitscape_index::source::RawChangeKind::{Added, Modified};
    use commitscape_index::{index_from_scratch, ScriptedRepo};
    use std::collections::HashMap;

    fn blob(n: u8) -> Oid {
        let mut b = [0u8; 20];
        b[0] = n;
        Oid(b)
    }

    fn report() -> Report {
        let repo = ScriptedRepo::new()
            .commit(
                1_704_067_200,
                ("Ada", "ada@example.com"),
                &[(b"src/a.rs", Added, blob(1))],
            )
            .commit(
                1_704_153_600,
                ("Bob", "12+bob@users.noreply.github.com"),
                &[(b"src/a.rs", Modified, blob(2))],
            );
        let index = match index_from_scratch(&repo) {
            Ok(i) => i,
            Err(never) => match never {},
        };
        Report {
            name: "rocket".into(),
            index,
            anchor: 1_704_200_000,
            span: commitscape_metrics::Span::All,
            options: Options::default(),
            releases: vec![("v1".into(), 1_704_153_600)],
            lines_counted: false,
            accounts: HashMap::from([("ada@example.com".to_string(), "ada".to_string())]),
            avatars: false,
            commit_link: None,
            emails: false,
        }
    }

    #[test]
    fn a_pack_reads_back_as_written_with_no_email_address_in_it() {
        let report = report();
        let mut expected = report.index.clone();
        expected.authors.blank_emails();
        let pack = Pack::of(
            report,
            Reading {
                lineage: 9,
                lines_complete: true,
                lines_mainline: true,
                mainline: vec![24, 24],
                arrival: vec![Some(1), Some(2)],
                release_commits: vec![("v1".into(), "ab".repeat(20))],
            },
        );
        assert_eq!(pack.index, expected);
        assert_eq!(
            pack.logins,
            vec![(0, "bob".to_string()), (1, "ada".to_string())]
        );
        let mut pack = pack;
        let mut bytes = Vec::new();
        write_pack(&mut pack, &mut bytes).expect("written");
        assert!(bytes.starts_with(MAGIC));
        let read = read_pack(&bytes).expect("read");
        assert_eq!(read, pack);
        let dir = tempfile::tempdir().expect("a folder");
        let (packed, unpacked) = (dir.path().join("a.pack"), dir.path().join("a.unpacked"));
        std::fs::write(&packed, &bytes).expect("a pack file");
        unpack(&packed, &unpacked).expect("unpacked");
        let mapped = open_unpacked(&unpacked).expect("opened");
        assert!(mapped.index.commits.is_mapped());
        assert_eq!(mapped, pack);
        let payload = bincode::serde::encode_to_vec(&read, config()).expect("encoded");
        assert!(!payload.contains(&b'@'));
    }

    #[test]
    fn anything_else_is_not_a_pack() {
        assert!(matches!(read_pack(b"PK\x03\x04"), Err(PackError::NotAPack)));
        let mut bytes = MAGIC.to_vec();
        bytes.extend_from_slice(b"garbage");
        assert!(read_pack(&bytes).is_err());
    }
}
