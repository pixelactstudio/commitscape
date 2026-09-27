use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct HashIndex {
    by_hash: HashMap<u64, u32>,
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
