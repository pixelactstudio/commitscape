use std::io::{BufWriter, Read, Write};

use commitscape_core::Index;
use commitscape_metrics::Options;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

use crate::api;
use crate::report::Report;

pub const MAGIC: &[u8] = b"commitscape pack 1\n";

pub const FORMAT: u32 = 2;

const LEVEL: u32 = 6;

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

/// Writes a pack: its magic line, then the zlib of its bincode.
pub fn write_pack(pack: &Pack, out: &mut impl Write) -> Result<(), PackError> {
    out.write_all(MAGIC)?;
    let mut z = BufWriter::with_capacity(1 << 16, ZlibEncoder::new(out, Compression::new(LEVEL)));
    bincode::serde::encode_into_std_write(pack, &mut z, config())
        .map_err(|e| PackError::Encode(e.to_string()))?;
    z.into_inner()
        .map_err(|e| PackError::Io(e.into_error()))?
        .finish()?;
    Ok(())
}

/// Reads a pack `write_pack` wrote.
pub fn read_pack(bytes: &[u8]) -> Result<Pack, PackError> {
    let rest = bytes.strip_prefix(MAGIC).ok_or(PackError::NotAPack)?;
    let mut payload = Vec::with_capacity(rest.len().saturating_mul(4));
    ZlibDecoder::new(rest).read_to_end(&mut payload)?;
    let format: u32 = bincode::serde::decode_from_slice(&payload, config())
        .map(|(f, _)| f)
        .map_err(|e| PackError::Decode(e.to_string()))?;
    if format != FORMAT {
        return Err(PackError::Format(format));
    }
    bincode::serde::decode_from_slice(&payload, config())
        .map(|(pack, _)| pack)
        .map_err(|e| PackError::Decode(e.to_string()))
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
        let mut bytes = Vec::new();
        write_pack(&pack, &mut bytes).expect("written");
        assert!(bytes.starts_with(MAGIC));
        let read = read_pack(&bytes).expect("read");
        assert_eq!(read, pack);
        assert!(read.heap_bytes() > read.index.commits.len() * 40);
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
