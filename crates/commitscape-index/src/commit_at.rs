use commitscape_core::{CommitMeta, Index, Oid};

/// Where each commit of an Index is, by id: the first eight bytes of each id with its place, sorted, so a lookup is a binary search and a check of the whole id, in twelve bytes a commit.
pub(crate) struct CommitAt {
    keys: Vec<(u64, u32)>,
}

impl CommitAt {
    pub(crate) fn of(index: &Index) -> Self {
        let mut keys: Vec<(u64, u32)> = index
            .commits
            .iter()
            .zip(0u32..)
            .map(|(c, i)| (key(&c.id), i))
            .collect();
        keys.sort_unstable();
        CommitAt { keys }
    }

    /// The place of a commit in the Index.
    pub(crate) fn position(&self, index: &Index, id: &Oid) -> Option<u32> {
        let k = key(id);
        let from = self.keys.partition_point(|&(at, _)| at < k);
        self.keys
            .get(from..)?
            .iter()
            .take_while(|&&(at, _)| at == k)
            .find(|&&(_, i)| index.commits.get(i as usize).is_some_and(|c| c.id == *id))
            .map(|&(_, i)| i)
    }

    pub(crate) fn get<'i>(&self, index: &'i Index, id: &Oid) -> Option<&'i CommitMeta> {
        index.commits.get(self.position(index, id)? as usize)
    }
}

fn key(id: &Oid) -> u64 {
    let mut head = [0u8; 8];
    head.copy_from_slice(id.0.get(..8).unwrap_or(&[0; 8]));
    u64::from_le_bytes(head)
}
