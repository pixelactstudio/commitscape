//! Byte strings to dense ids, keyed by a 64-bit hash of the bytes.

use std::collections::HashMap;

/// Byte strings to dense ids, keyed by a 64-bit hash of the bytes.
///
/// Resuming an index rebuilds this for every path it has ever seen. Keyed by
/// owned copies that meant one allocation per path, a noticeable share of an
/// update; keyed by hash it is one table of integers. Every hit is checked
/// against the real bytes, so a hash collision costs a lookup, not a wrong id.
#[derive(Default)]
pub(crate) struct HashIndex {
    by_hash: HashMap<u64, u32>,
    /// Entries whose hash was already taken. Practically always empty.
    collisions: Vec<(u64, u32)>,
}

impl HashIndex {
    pub(crate) fn get(&self, hash: u64, matches: impl Fn(u32) -> bool) -> Option<u32> {
        if let Some(&id) = self.by_hash.get(&hash) {
            if matches(id) {
                return Some(id);
            }
        }
        self.collisions
            .iter()
            .find(|(h, id)| *h == hash && matches(*id))
            .map(|(_, id)| *id)
    }

    pub(crate) fn insert(&mut self, hash: u64, id: u32) {
        match self.by_hash.entry(hash) {
            std::collections::hash_map::Entry::Vacant(v) => {
                v.insert(id);
            }
            std::collections::hash_map::Entry::Occupied(_) => self.collisions.push((hash, id)),
        }
    }
}
