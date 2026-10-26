use std::collections::{BTreeMap, HashMap};
use std::hash::Hash;

struct Entry<V> {
    value: V,
    bytes: u64,
    tick: u64,
}

pub struct SizedLru<K, V> {
    budget: u64,
    used: u64,
    tick: u64,
    entries: HashMap<K, Entry<V>>,
    order: BTreeMap<u64, K>,
}

impl<K: Hash + Eq + Clone, V: Clone> SizedLru<K, V> {
    /// An empty cache that holds entries while their sizes add up to at most `budget`, always keeping the newest.
    pub fn new(budget: u64) -> Self {
        SizedLru {
            budget,
            used: 0,
            tick: 0,
            entries: HashMap::new(),
            order: BTreeMap::new(),
        }
    }

    fn bump(&mut self) -> u64 {
        self.tick += 1;
        self.tick
    }

    /// The entry under `key`, now the most recently used.
    pub fn get(&mut self, key: &K) -> Option<V> {
        let tick = self.bump();
        let entry = self.entries.get_mut(key)?;
        self.order.remove(&entry.tick);
        entry.tick = tick;
        self.order.insert(tick, key.clone());
        Some(entry.value.clone())
    }

    pub fn contains(&self, key: &K) -> bool {
        self.entries.contains_key(key)
    }

    /// Keeps `value` under `key` as the most recently used, and returns what had to go to make room.
    pub fn insert(&mut self, key: K, value: V, bytes: u64) -> Vec<(K, V)> {
        let tick = self.bump();
        if let Some(old) = self.entries.remove(&key) {
            self.order.remove(&old.tick);
            self.used -= old.bytes;
        }
        self.used += bytes;
        self.order.insert(tick, key.clone());
        self.entries.insert(key, Entry { value, bytes, tick });
        let mut gone = Vec::new();
        while self.used > self.budget && self.entries.len() > 1 {
            let Some((_, oldest)) = self.order.pop_first() else {
                break;
            };
            if let Some(entry) = self.entries.remove(&oldest) {
                self.used -= entry.bytes;
                gone.push((oldest, entry.value));
            }
        }
        gone
    }

    pub fn remove(&mut self, key: &K) -> Option<V> {
        let entry = self.entries.remove(key)?;
        self.order.remove(&entry.tick);
        self.used -= entry.bytes;
        Some(entry.value)
    }

    pub fn used(&self) -> u64 {
        self.used
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_least_recently_used_go_first_once_the_budget_is_spent() {
        let mut lru = SizedLru::new(10);
        assert!(lru.insert("a", 1, 4).is_empty());
        assert!(lru.insert("b", 2, 4).is_empty());
        assert_eq!(lru.get(&"a"), Some(1));
        assert_eq!(lru.insert("c", 3, 4), vec![("b", 2)]);
        assert_eq!((lru.len(), lru.used()), (2, 8));
        assert_eq!(lru.get(&"b"), None);
    }

    #[test]
    fn the_newest_stays_even_when_it_alone_is_over_budget() {
        let mut lru = SizedLru::new(10);
        lru.insert("a", 1, 4);
        assert_eq!(lru.insert("big", 2, 40), vec![("a", 1)]);
        assert_eq!(lru.get(&"big"), Some(2));
        assert_eq!(lru.remove(&"big"), Some(2));
        assert!(lru.is_empty());
        assert_eq!(lru.used(), 0);
    }

    #[test]
    fn keeping_a_key_again_replaces_it() {
        let mut lru = SizedLru::new(10);
        lru.insert("a", 1, 4);
        lru.insert("a", 2, 6);
        assert_eq!((lru.len(), lru.used()), (1, 6));
        assert_eq!(lru.get(&"a"), Some(2));
        assert!(lru.contains(&"a"));
    }
}
