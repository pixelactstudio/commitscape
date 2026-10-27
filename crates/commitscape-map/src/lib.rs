use std::fs::File;
use std::io;
use std::marker::PhantomData;
use std::mem::{align_of, size_of};

use commitscape_core::{Record, Slab};
use memmap2::{MmapMut, MmapOptions};

const LARGE_BLOCK: i32 = 1 << 20;

/// Has the C allocator map every block of a megabyte or more on its own and give it back to the system when freed, and give back free memory past a megabyte at the top of its heap. glibc otherwise raises the size it maps blocks at each time a large one is freed, so a long run reading file versions of many sizes on several threads keeps hundreds of MB it no longer uses. Does nothing where the allocator is not glibc's.
pub fn release_large_blocks() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    #[allow(unsafe_code)]
    unsafe {
        libc::mallopt(libc::M_MMAP_THRESHOLD, LARGE_BLOCK);
        libc::mallopt(libc::M_TRIM_THRESHOLD, LARGE_BLOCK);
    }
}

/// Records read in place from a stretch of a file mapped copy-on-write: the pages are the file's until one is written, which then becomes the process's own and never reaches the file.
pub struct Records<T: Record> {
    map: Option<MmapMut>,
    len: usize,
    kind: PhantomData<T>,
}

fn invalid(why: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, why.to_string())
}

impl<T: Record> Records<T> {
    /// Maps `len` records of `file` from `offset`, which is a multiple of the page size, after checking every record is one: a kind byte outside its kinds, or a record of another size, refuses the whole stretch.
    #[allow(unsafe_code)]
    pub fn open(file: &File, offset: u64, len: usize) -> io::Result<Records<T>> {
        if size_of::<T>() != T::SIZE {
            return Err(invalid("a record's size differs from its layout"));
        }
        if len == 0 {
            return Ok(Records {
                map: None,
                len: 0,
                kind: PhantomData,
            });
        }
        let bytes = len
            .checked_mul(T::SIZE)
            .ok_or_else(|| invalid("too many records"))?;
        let map = unsafe {
            MmapOptions::new()
                .offset(offset)
                .len(bytes)
                .map_copy(file)?
        };
        if map.as_ptr().align_offset(align_of::<T>()) != 0 {
            return Err(invalid("records are not aligned"));
        }
        if !map.chunks_exact(T::SIZE).all(T::valid) {
            return Err(invalid("a record is not one"));
        }
        Ok(Records {
            map: Some(map),
            len,
            kind: PhantomData,
        })
    }
}

impl<T: Record> Records<T> {
    /// Records copied out of `bytes` into memory of their own, after the same checks as `open`.
    pub fn copied(bytes: &[u8]) -> io::Result<Records<T>> {
        if size_of::<T>() != T::SIZE || !bytes.len().is_multiple_of(T::SIZE) {
            return Err(invalid("not whole records"));
        }
        let len = bytes.len() / T::SIZE;
        if len == 0 {
            return Ok(Records {
                map: None,
                len: 0,
                kind: PhantomData,
            });
        }
        let mut map = MmapMut::map_anon(bytes.len())?;
        map.copy_from_slice(bytes);
        if map.as_ptr().align_offset(align_of::<T>()) != 0 {
            return Err(invalid("records are not aligned"));
        }
        if !map.chunks_exact(T::SIZE).all(T::valid) {
            return Err(invalid("a record is not one"));
        }
        Ok(Records {
            map: Some(map),
            len,
            kind: PhantomData,
        })
    }
}

impl<T: Record> Slab<T> for Records<T> {
    #[allow(unsafe_code)]
    fn get(&self) -> &[T] {
        match &self.map {
            Some(map) => unsafe { std::slice::from_raw_parts(map.as_ptr().cast::<T>(), self.len) },
            None => &[],
        }
    }

    #[allow(unsafe_code)]
    fn get_mut(&mut self) -> &mut [T] {
        match &mut self.map {
            Some(map) => unsafe {
                std::slice::from_raw_parts_mut(map.as_mut_ptr().cast::<T>(), self.len)
            },
            None => &mut [],
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::indexing_slicing)]

    use super::*;
    use commitscape_core::{
        ChangeKind, CommitFlags, CommitKind, CommitMeta, FileChange, FileId, LineDelta, Oid,
        SignatureId,
    };
    use std::io::{Seek, SeekFrom, Write};

    const PAGE: u64 = 4096;

    fn commit(n: u8) -> CommitMeta {
        CommitMeta {
            id: Oid([n; 20]),
            time: i64::from(n) * 100,
            signature: SignatureId(u32::from(n)),
            flags: CommitFlags(n % 3),
            changes_start: u32::from(n),
            changes_len: 1,
            offset_minutes: -30,
            author_delta: 5,
            kind: CommitKind::EVERY[usize::from(n) % 11],
            subject_start: 0,
            subject_len: n,
        }
    }

    #[test]
    fn records_written_by_their_layout_read_back_in_place_and_writes_stay_in_memory() {
        let commits: Vec<CommitMeta> = (0..300u16).map(|n| commit(n as u8)).collect();
        let changes = vec![
            FileChange::new(FileId(1), ChangeKind::Added, None),
            FileChange::new(
                FileId(2),
                ChangeKind::Renamed,
                Some(LineDelta {
                    added: 4,
                    removed: 9,
                }),
            ),
        ];
        let mut file = tempfile::tempfile().expect("a file");
        let mut buf = vec![0u8; CommitMeta::SIZE];
        file.seek(SeekFrom::Start(PAGE)).expect("seek");
        for c in &commits {
            c.write_to(&mut buf);
            file.write_all(&buf).expect("write");
        }
        let at = PAGE * 8;
        file.seek(SeekFrom::Start(at)).expect("seek");
        let mut buf = vec![0u8; FileChange::SIZE];
        for c in &changes {
            c.write_to(&mut buf);
            file.write_all(&buf).expect("write");
        }
        let read = Records::<CommitMeta>::open(&file, PAGE, commits.len()).expect("mapped");
        assert_eq!(read.get(), commits.as_slice());
        let mut bytes = vec![0u8; CommitMeta::SIZE * commits.len()];
        for (c, slot) in commits
            .iter()
            .zip(bytes.as_chunks_mut::<{ CommitMeta::SIZE }>().0)
        {
            c.write_to(slot);
        }
        let copied = Records::<CommitMeta>::copied(&bytes).expect("copied");
        assert_eq!(copied.get(), commits.as_slice());
        assert!(Records::<CommitMeta>::copied(&bytes[1..]).is_err());
        let mut read = Records::<FileChange>::open(&file, at, changes.len()).expect("mapped");
        assert_eq!(read.get(), changes.as_slice());
        read.get_mut()[0].set_lines(Some(LineDelta {
            added: 1,
            removed: 1,
        }));
        let again = Records::<FileChange>::open(&file, at, changes.len()).expect("mapped");
        assert_eq!(again.get(), changes.as_slice());
        file.seek(SeekFrom::Start(
            PAGE + std::mem::offset_of!(CommitMeta, kind) as u64,
        ))
        .expect("seek");
        file.write_all(&[200]).expect("write");
        assert!(Records::<CommitMeta>::open(&file, PAGE, commits.len()).is_err());
    }
}
