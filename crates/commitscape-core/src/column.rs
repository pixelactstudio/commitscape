use std::ops::{Deref, DerefMut};

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Records laid out in memory a Column can stand on: a file mapped in place, read without decoding it.
pub trait Slab<T>: Send + Sync {
    fn get(&self) -> &[T];
    fn get_mut(&mut self) -> &mut [T];
}

/// One of the Index's long arrays: held in memory, or read in place from a mapped file.
pub struct Column<T: 'static> {
    owned: Vec<T>,
    mapped: Option<Box<dyn Slab<T>>>,
}

impl<T: 'static> Column<T> {
    /// A column read in place from a mapped file.
    pub fn mapped(slab: Box<dyn Slab<T>>) -> Self {
        Column {
            owned: Vec::new(),
            mapped: Some(slab),
        }
    }

    pub fn is_mapped(&self) -> bool {
        self.mapped.is_some()
    }

    /// The bytes the column holds on the heap: none when it is mapped.
    pub fn heap_bytes(&self) -> usize {
        self.owned.capacity() * std::mem::size_of::<T>()
    }
}

impl<T: Clone + 'static> Column<T> {
    /// The records as a vector, copied out of the mapping when the column is mapped.
    pub fn into_vec(self) -> Vec<T> {
        match self.mapped {
            Some(m) => m.get().to_vec(),
            None => self.owned,
        }
    }

    /// The records as a vector to grow or reorder, copied out of the mapping first when the column is mapped.
    pub fn vec_mut(&mut self) -> &mut Vec<T> {
        if let Some(m) = self.mapped.take() {
            self.owned = m.get().to_vec();
        }
        &mut self.owned
    }
}

impl<T> Deref for Column<T> {
    type Target = [T];

    fn deref(&self) -> &[T] {
        match &self.mapped {
            Some(m) => m.get(),
            None => &self.owned,
        }
    }
}

impl<T> DerefMut for Column<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        match &mut self.mapped {
            Some(m) => m.get_mut(),
            None => &mut self.owned,
        }
    }
}

impl<T> Default for Column<T> {
    fn default() -> Self {
        Column {
            owned: Vec::new(),
            mapped: None,
        }
    }
}

impl<T> From<Vec<T>> for Column<T> {
    fn from(owned: Vec<T>) -> Self {
        Column {
            owned,
            mapped: None,
        }
    }
}

impl<T: Clone> Clone for Column<T> {
    fn clone(&self) -> Self {
        Column::from(self.to_vec())
    }
}

impl<T: PartialEq> PartialEq for Column<T> {
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl<T: std::fmt::Debug> std::fmt::Debug for Column<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

impl<T: Serialize> Serialize for Column<T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        (**self).serialize(s)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Column<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Column::from(Vec::deserialize(d)?))
    }
}

impl<'a, T> IntoIterator for &'a Column<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a, T> IntoIterator for &'a mut Column<T> {
    type Item = &'a mut T;
    type IntoIter = std::slice::IterMut<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}
