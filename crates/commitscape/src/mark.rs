use std::fmt;

use commitscape_core::Oid;
use commitscape_index::LogMark;
use commitscape_report::export::FORMAT;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Mark {
    pub(crate) head: Option<Oid>,
    pub(crate) lines: Option<LogMark>,
    pub(crate) fingerprint: u64,
}

impl Mark {
    /// Reads a mark an earlier export wrote into its manifest; `None` for anything else.
    pub(crate) fn parse(text: &str) -> Option<Mark> {
        let mut parts = text.trim().split('.');
        let head = match parts.next()? {
            "-" => None,
            hex => Some(Oid::from_hex(hex)?),
        };
        let lines = match (parts.next()?, parts.next()?) {
            ("-", "-") => None,
            (len, hash) => Some(LogMark {
                len: len.parse().ok()?,
                hash: u64::from_str_radix(hash, 16).ok()?,
            }),
        };
        let fingerprint = u64::from_str_radix(parts.next()?, 16).ok()?;
        parts.next().is_none().then_some(Mark {
            head,
            lines,
            fingerprint,
        })
    }
}

impl fmt::Display for Mark {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.head {
            Some(head) => write!(f, "{}", head.to_hex())?,
            None => write!(f, "-")?,
        }
        match self.lines {
            Some(l) => write!(f, ".{}.{:x}", l.len, l.hash)?,
            None => write!(f, ".-.-")?,
        }
        write!(f, ".{:x}", self.fingerprint)
    }
}

/// What an export's rows depend on beside the commits themselves: the export format, the Bulk Commit size, the commits blame passes through and whether the history was cut short.
pub(crate) fn fingerprint(max_changeset_size: u32, ignored: &[Oid], truncated: bool) -> u64 {
    let mut ignored = ignored.to_vec();
    ignored.sort_unstable();
    let mut h = Sha256::new();
    h.update(FORMAT.to_le_bytes());
    h.update(max_changeset_size.to_le_bytes());
    h.update([u8::from(truncated)]);
    for id in &ignored {
        h.update(id.0);
    }
    let digest = h.finalize();
    let mut first = [0u8; 8];
    first.copy_from_slice(digest.get(..8).unwrap_or(&[0; 8]));
    u64::from_le_bytes(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mark_reads_back_as_it_was_written_and_nothing_else_reads_as_one() {
        let marks = [
            Mark {
                head: Some(Oid([7; 20])),
                lines: Some(LogMark {
                    len: 1234,
                    hash: 0xfeed,
                }),
                fingerprint: fingerprint(100, &[Oid([1; 20])], false),
            },
            Mark {
                head: None,
                lines: None,
                fingerprint: 0,
            },
        ];
        for mark in marks {
            assert_eq!(Mark::parse(&mark.to_string()), Some(mark));
        }
        for text in ["", "-", "-.-.-", "zz.-.-.0", "-.1.2.3.4", "-.x.2.3"] {
            assert_eq!(Mark::parse(text), None, "{text}");
        }
    }

    #[test]
    fn the_fingerprint_changes_with_what_the_rows_depend_on_and_not_with_order() {
        let (a, b) = (Oid([1; 20]), Oid([2; 20]));
        let base = fingerprint(100, &[a, b], false);
        assert_eq!(base, fingerprint(100, &[b, a], false));
        assert_ne!(base, fingerprint(101, &[a, b], false));
        assert_ne!(base, fingerprint(100, &[a], false));
        assert_ne!(base, fingerprint(100, &[a, b], true));
    }
}
