use std::cmp::Ordering;

use gix::hash::oid;
use gix::objs::tree::EntryMode;
use gix::objs::{Find, FindExt};
use gix::ObjectId;

use crate::source::RawChangeKind;

pub(super) type DiffError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Debug, Clone)]
pub(super) struct Changed {
    pub path: Vec<u8>,
    pub kind: RawChangeKind,
    pub blob: ObjectId,
    pub symlink: bool,
    pub before: Option<ObjectId>,
}

#[derive(Clone, Copy)]
struct Entry<'a> {
    name: &'a [u8],
    mode: EntryMode,
    oid: &'a oid,
}

struct Descend {
    name: Vec<u8>,
    tree: Option<ObjectId>,
    parents: Vec<Option<ObjectId>>,
}

pub(super) struct TreeDiffer {
    buffers: Vec<Vec<Vec<u8>>>,
    prefix: Vec<u8>,
    empty_tree: ObjectId,
}

impl TreeDiffer {
    pub fn new(hash: gix::hash::Kind) -> Self {
        TreeDiffer {
            buffers: Vec::new(),
            prefix: Vec::new(),
            empty_tree: ObjectId::empty_tree(hash),
        }
    }

    pub fn diff(
        &mut self,
        objects: &impl Find,
        tree: ObjectId,
        parents: &[Option<ObjectId>],
        out: &mut Vec<Changed>,
    ) -> Result<(), DiffError> {
        if parents.contains(&Some(tree)) {
            return Ok(());
        }
        self.prefix.clear();
        self.level(objects, 0, Some(tree), parents, out)
    }

    fn level(
        &mut self,
        objects: &impl Find,
        depth: usize,
        tree: Option<ObjectId>,
        parents: &[Option<ObjectId>],
        out: &mut Vec<Changed>,
    ) -> Result<(), DiffError> {
        if self.buffers.len() <= depth {
            self.buffers.resize_with(depth + 1, Vec::new);
        }
        let mut bufs = self
            .buffers
            .get_mut(depth)
            .map(std::mem::take)
            .unwrap_or_default();
        bufs.resize_with(parents.len() + 1, Vec::new);

        let mut descend = Vec::new();
        let mut failure = None;
        {
            let ids = std::iter::once(tree).chain(parents.iter().copied());
            let mut lists = Vec::with_capacity(parents.len() + 1);
            for (buf, id) in bufs.iter_mut().zip(ids) {
                match read_entries(objects, id, self.empty_tree, buf) {
                    Ok(list) => lists.push(list),
                    Err(e) => {
                        failure = Some(e);
                        break;
                    }
                }
            }
            if failure.is_none() {
                compare(&lists, &self.prefix, &mut descend, out);
            }
        }
        if let Some(slot) = self.buffers.get_mut(depth) {
            *slot = bufs;
        }
        if let Some(e) = failure {
            return Err(e);
        }

        for d in descend {
            let len = self.prefix.len();
            self.prefix.extend_from_slice(&d.name);
            self.prefix.push(b'/');
            let result = self.level(objects, depth + 1, d.tree, &d.parents, out);
            self.prefix.truncate(len);
            result?;
        }
        Ok(())
    }
}

fn read_entries<'b>(
    objects: &impl Find,
    id: Option<ObjectId>,
    empty_tree: ObjectId,
    buf: &'b mut Vec<u8>,
) -> Result<Vec<Entry<'b>>, DiffError> {
    let Some(id) = id else {
        return Ok(Vec::new());
    };
    if id == empty_tree {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in objects.find_tree_iter(&id, buf)? {
        let entry = entry?;
        entries.push(Entry {
            name: entry.filename,
            mode: entry.mode,
            oid: entry.oid,
        });
    }
    Ok(entries)
}

fn compare(
    lists: &[Vec<Entry<'_>>],
    prefix: &[u8],
    descend: &mut Vec<Descend>,
    out: &mut Vec<Changed>,
) {
    let mut cursors = vec![0usize; lists.len()];
    let mut at: Vec<Option<Entry<'_>>> = vec![None; lists.len()];
    loop {
        let mut key: Option<Entry<'_>> = None;
        for (list, &cursor) in lists.iter().zip(&cursors) {
            if let Some(e) = list.get(cursor) {
                key = match key {
                    Some(k) if tree_order(&k, e) != Ordering::Greater => Some(k),
                    _ => Some(*e),
                };
            }
        }
        let Some(key) = key else {
            break;
        };

        for ((list, cursor), slot) in lists.iter().zip(cursors.iter_mut()).zip(at.iter_mut()) {
            *slot = match list.get(*cursor) {
                Some(e) if tree_order(e, &key) == Ordering::Equal => {
                    *cursor += 1;
                    Some(*e)
                }
                _ => None,
            };
        }
        let Some((this, parents)) = at.split_first() else {
            break;
        };
        if parents.iter().any(|p| same(p, this)) {
            continue;
        }

        if key.mode.is_tree() {
            descend.push(Descend {
                name: key.name.to_vec(),
                tree: this.map(|e| e.oid.to_owned()),
                parents: parents
                    .iter()
                    .map(|p| p.map(|e| e.oid.to_owned()))
                    .collect(),
            });
        } else if let Some(change) = file_change(prefix, key.name, this, parents) {
            out.push(change);
        }
    }
}

fn tree_order(a: &Entry<'_>, b: &Entry<'_>) -> Ordering {
    let common = a.name.len().min(b.name.len());
    match a.name.get(..common).cmp(&b.name.get(..common)) {
        Ordering::Equal => {}
        other => return other,
    }
    let next = |e: &Entry<'_>| {
        e.name
            .get(common)
            .copied()
            .unwrap_or(if e.mode.is_tree() { b'/' } else { 0 })
    };
    next(a).cmp(&next(b))
}

fn same(a: &Option<Entry<'_>>, b: &Option<Entry<'_>>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.oid == b.oid && a.mode.kind() == b.mode.kind(),
        _ => false,
    }
}

fn file_change(
    prefix: &[u8],
    name: &[u8],
    this: &Option<Entry<'_>>,
    parents: &[Option<Entry<'_>>],
) -> Option<Changed> {
    let is_file = |e: &&Entry<'_>| e.mode.is_blob_or_symlink();
    let path = || {
        let mut p = Vec::with_capacity(prefix.len() + name.len());
        p.extend_from_slice(prefix);
        p.extend_from_slice(name);
        p
    };
    match this {
        Some(e) if e.mode.is_blob_or_symlink() => {
            let kind = if parents.iter().flatten().any(|p| is_file(&p)) {
                RawChangeKind::Modified
            } else {
                RawChangeKind::Added
            };
            let before = match parents {
                [Some(p)] if is_file(&p) => Some(p.oid.to_owned()),
                _ => None,
            };
            Some(Changed {
                path: path(),
                kind,
                blob: e.oid.to_owned(),
                symlink: e.mode.is_link(),
                before,
            })
        }
        Some(_) => None,
        None => {
            let removed = parents.iter().flatten().find(is_file)?;
            Some(Changed {
                path: path(),
                kind: RawChangeKind::Deleted,
                blob: removed.oid.to_owned(),
                symlink: false,
                before: None,
            })
        }
    }
}
