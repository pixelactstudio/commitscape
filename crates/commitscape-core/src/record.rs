use std::mem::{offset_of, size_of};

use crate::{CommitKind, CommitMeta, FileChange};

/// A record kept in a column file exactly as it lies in memory: written field by field with no stray padding bytes, and checked before it is read in place.
pub trait Record: Copy + Send + Sync + 'static {
    const SIZE: usize;

    fn write_to(&self, out: &mut [u8]);

    fn valid(bytes: &[u8]) -> bool;
}

fn put(out: &mut [u8], at: usize, bytes: &[u8]) {
    if let Some(slot) = out.get_mut(at..at + bytes.len()) {
        slot.copy_from_slice(bytes);
    }
}

const COMMIT_KINDS: u8 = CommitKind::EVERY.len() as u8;
const CHANGE_KINDS: u8 = 4;

impl Record for u8 {
    const SIZE: usize = 1;

    fn write_to(&self, out: &mut [u8]) {
        put(out, 0, &[*self]);
    }

    fn valid(_: &[u8]) -> bool {
        true
    }
}

impl Record for u32 {
    const SIZE: usize = 4;

    fn write_to(&self, out: &mut [u8]) {
        put(out, 0, &self.to_ne_bytes());
    }

    fn valid(_: &[u8]) -> bool {
        true
    }
}

impl Record for CommitMeta {
    const SIZE: usize = size_of::<CommitMeta>();

    fn write_to(&self, out: &mut [u8]) {
        out.fill(0);
        put(out, offset_of!(CommitMeta, id), &self.id.0);
        put(out, offset_of!(CommitMeta, time), &self.time.to_ne_bytes());
        put(
            out,
            offset_of!(CommitMeta, signature),
            &self.signature.0.to_ne_bytes(),
        );
        put(out, offset_of!(CommitMeta, flags), &[self.flags.0]);
        put(
            out,
            offset_of!(CommitMeta, changes_start),
            &self.changes_start.to_ne_bytes(),
        );
        put(
            out,
            offset_of!(CommitMeta, changes_len),
            &self.changes_len.to_ne_bytes(),
        );
        put(
            out,
            offset_of!(CommitMeta, offset_minutes),
            &self.offset_minutes.to_ne_bytes(),
        );
        put(
            out,
            offset_of!(CommitMeta, author_delta),
            &self.author_delta.to_ne_bytes(),
        );
        put(out, offset_of!(CommitMeta, kind), &[self.kind as u8]);
        put(
            out,
            offset_of!(CommitMeta, subject_start),
            &self.subject_start.to_ne_bytes(),
        );
        put(
            out,
            offset_of!(CommitMeta, subject_len),
            &[self.subject_len],
        );
    }

    fn valid(bytes: &[u8]) -> bool {
        bytes.len() == Self::SIZE
            && bytes
                .get(offset_of!(CommitMeta, kind))
                .is_some_and(|&k| k < COMMIT_KINDS)
    }
}

impl Record for FileChange {
    const SIZE: usize = size_of::<FileChange>();

    fn write_to(&self, out: &mut [u8]) {
        out.fill(0);
        let lines = self.lines();
        put(
            out,
            offset_of!(FileChange, file),
            &self.file.0.to_ne_bytes(),
        );
        put(out, offset_of!(FileChange, kind), &[self.kind as u8]);
        put(out, FileChange::COUNTED_AT, &[u8::from(lines.is_some())]);
        if let Some(d) = lines {
            put(out, FileChange::ADDED_AT, &d.added.to_ne_bytes());
            put(out, FileChange::REMOVED_AT, &d.removed.to_ne_bytes());
        }
    }

    fn valid(bytes: &[u8]) -> bool {
        bytes.len() == Self::SIZE
            && bytes
                .get(offset_of!(FileChange, kind))
                .is_some_and(|&k| k < CHANGE_KINDS)
            && bytes.get(FileChange::COUNTED_AT).is_some_and(|&c| c <= 1)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::indexing_slicing)]

    use super::*;
    use crate::{ChangeKind, CommitFlags, FileId, LineDelta, Oid, SignatureId};

    #[test]
    fn every_kind_fits_the_byte_it_is_kept_in() {
        assert!(CommitKind::EVERY.iter().all(|k| (*k as u8) < COMMIT_KINDS));
        for k in [
            ChangeKind::Added,
            ChangeKind::Modified,
            ChangeKind::Deleted,
            ChangeKind::Renamed,
        ] {
            assert!((k as u8) < CHANGE_KINDS);
        }
    }

    #[test]
    fn records_are_written_whole_and_refused_when_a_kind_is_not_one() {
        let c = CommitMeta {
            id: Oid([7; 20]),
            time: -5,
            signature: SignatureId(3),
            flags: CommitFlags(4),
            changes_start: 9,
            changes_len: 2,
            offset_minutes: -60,
            author_delta: 11,
            kind: CommitKind::Revert,
            subject_start: 40,
            subject_len: 12,
        };
        let mut out = vec![0xff; CommitMeta::SIZE];
        c.write_to(&mut out);
        assert!(CommitMeta::valid(&out));
        out[offset_of!(CommitMeta, kind)] = COMMIT_KINDS;
        assert!(!CommitMeta::valid(&out));
        let ch = FileChange::new(
            FileId(5),
            ChangeKind::Renamed,
            Some(LineDelta {
                added: 1,
                removed: 2,
            }),
        );
        let mut out = vec![0xff; FileChange::SIZE];
        ch.write_to(&mut out);
        assert!(FileChange::valid(&out));
        out[FileChange::COUNTED_AT] = 2;
        assert!(!FileChange::valid(&out));
    }
}
