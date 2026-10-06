use std::collections::HashMap;

use commitscape_core::Oid;
use gix::objs::tree::EntryMode;
use gix::objs::FindExt;
use gix::ObjectId;

use super::tree_diff::TreeDiffer;
use super::walk::tree_of_commit;
use super::{GixError, GixRepo};
use crate::source::{BlameCommit, InParent, Moves, RawChangeKind};

const MAP_FROM: usize = 64;

type Entry<'b> = (&'b [u8], EntryMode, ObjectId);

pub(super) fn commit(source: &GixRepo, id: Oid) -> Result<Option<BlameCommit>, GixError> {
    let Some(oid) = GixRepo::to_gix(id) else {
        return Ok(None);
    };
    let mut buf = Vec::new();
    let found = gix::objs::Find::try_find(&source.repo.objects, &oid, &mut buf).map_err(|e| {
        GixError::Git {
            context: "reading a commit to blame",
            source: e,
        }
    })?;
    let Some(data) = found else {
        return Ok(None);
    };
    let decoded = git_ctx!(data.decode(), "decoding a commit to blame")?;
    let Some(commit) = decoded.as_commit() else {
        return Ok(None);
    };
    let time = git_ctx!(commit.time(), "reading a commit time")?.seconds;
    let parents = commit
        .parents()
        .map(|p| GixRepo::to_oid(p.as_ref()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(BlameCommit { time, parents }))
}

fn trees(
    source: &GixRepo,
    commit: Oid,
    parent: Oid,
) -> Result<Option<(ObjectId, ObjectId)>, GixError> {
    let (Some(c), Some(p)) = (GixRepo::to_gix(commit), GixRepo::to_gix(parent)) else {
        return Ok(None);
    };
    let Some(ct) = tree_of_commit(&source.repo, c)? else {
        return Ok(None);
    };
    let Some(pt) = tree_of_commit(&source.repo, p)? else {
        return Ok(None);
    };
    Ok(Some((ct, pt)))
}

pub(super) fn compare(
    source: &GixRepo,
    commit: Oid,
    parent: Oid,
    paths: &[&[u8]],
) -> Result<Vec<InParent>, GixError> {
    let mut out = vec![InParent::Absent; paths.len()];
    let Some((ct, pt)) = trees(source, commit, parent)? else {
        return Ok(out);
    };
    let all: Vec<usize> = (0..paths.len()).collect();
    level(&source.repo, Some(ct), pt, paths, &all, 0, &mut out)?;
    Ok(out)
}

fn level(
    repo: &gix::Repository,
    ours: Option<ObjectId>,
    theirs: ObjectId,
    paths: &[&[u8]],
    which: &[usize],
    offset: usize,
    out: &mut [InParent],
) -> Result<(), GixError> {
    if ours == Some(theirs) {
        for &i in which {
            if let Some(slot) = out.get_mut(i) {
                *slot = InParent::Same;
            }
        }
        return Ok(());
    }
    let mut groups: Vec<(&[u8], bool, Vec<usize>)> = Vec::new();
    let mut seen: HashMap<(&[u8], bool), usize> = HashMap::new();
    for &i in which {
        let Some(rest) = paths.get(i).and_then(|p| p.get(offset..)) else {
            continue;
        };
        let (name, last) = match rest.iter().position(|&b| b == b'/') {
            Some(n) => (rest.get(..n).unwrap_or(rest), false),
            None => (rest, true),
        };
        match seen.get(&(name, last)).and_then(|&g| groups.get_mut(g)) {
            Some(group) => group.2.push(i),
            None => {
                seen.insert((name, last), groups.len());
                groups.push((name, last, vec![i]));
            }
        }
    }

    let mut our_buf = Vec::new();
    let mut their_buf = Vec::new();
    let our_entries = match ours {
        Some(t) => entries(repo, t, &mut our_buf)?,
        None => Vec::new(),
    };
    let their_entries = entries(repo, theirs, &mut their_buf)?;
    let our_find = Finder::new(&our_entries);
    let their_find = Finder::new(&their_entries);

    for (name, last, idx) in groups {
        let theirs = their_find.get(name);
        let ours = our_find.get(name);
        if last {
            let state = match theirs {
                Some((_, mode, oid)) if mode.is_blob_or_symlink() => {
                    if ours.is_some_and(|o| o.2 == oid) {
                        InParent::Same
                    } else {
                        InParent::Changed(GixRepo::to_oid(oid.as_ref())?)
                    }
                }
                _ => InParent::Absent,
            };
            for i in idx {
                if let Some(slot) = out.get_mut(i) {
                    *slot = state;
                }
            }
        } else if let Some((_, mode, oid)) = theirs {
            if mode.is_tree() {
                let ours = ours.filter(|o| o.1.is_tree()).map(|o| o.2);
                level(repo, ours, oid, paths, &idx, offset + name.len() + 1, out)?;
            }
        }
    }
    Ok(())
}

struct Finder<'e, 'b> {
    list: &'e [Entry<'b>],
    map: Option<HashMap<&'b [u8], usize>>,
}

impl<'e, 'b> Finder<'e, 'b> {
    fn new(list: &'e [Entry<'b>]) -> Self {
        let map = (list.len() > MAP_FROM)
            .then(|| list.iter().enumerate().map(|(i, e)| (e.0, i)).collect());
        Finder { list, map }
    }

    fn get(&self, name: &[u8]) -> Option<Entry<'b>> {
        match &self.map {
            Some(map) => map.get(name).and_then(|&i| self.list.get(i)).copied(),
            None => self.list.iter().find(|e| e.0 == name).copied(),
        }
    }
}

fn entries<'b>(
    repo: &gix::Repository,
    id: ObjectId,
    buf: &'b mut Vec<u8>,
) -> Result<Vec<Entry<'b>>, GixError> {
    let iter = git_ctx!(
        repo.objects.find_tree_iter(&id, buf),
        "reading a tree to blame"
    )?;
    let mut out = Vec::new();
    for entry in iter {
        let entry = git_ctx!(entry, "decoding a tree to blame")?;
        let name: &[u8] = entry.filename.as_ref();
        out.push((name, entry.mode, entry.oid.to_owned()));
    }
    Ok(out)
}

pub(super) fn moves(source: &GixRepo, commit: Oid, parent: Oid) -> Result<Moves, GixError> {
    let Some((ct, pt)) = trees(source, commit, parent)? else {
        return Ok(Moves::default());
    };
    let mut differ = TreeDiffer::new(source.repo.object_hash());
    let mut changed = Vec::new();
    differ
        .diff(&source.repo.objects, ct, &[Some(pt)], &mut changed)
        .map_err(|e| GixError::Git {
            context: "looking for the file a commit renamed",
            source: e,
        })?;
    let mut moves = Moves::default();
    for c in changed {
        if c.symlink {
            continue;
        }
        let entry = (c.path, GixRepo::to_oid(c.blob.as_ref())?);
        match c.kind {
            RawChangeKind::Deleted => moves.deleted.push(entry),
            RawChangeKind::Added => moves.added.push(entry),
            RawChangeKind::Modified => {}
        }
    }
    Ok(moves)
}

pub(super) fn blob(source: &GixRepo, id: Oid) -> Result<Vec<u8>, GixError> {
    let oid = GixRepo::to_gix(id).ok_or(GixError::UnsupportedHash)?;
    let mut buf = Vec::new();
    let blob = git_ctx!(
        source.repo.objects.find_blob(&oid, &mut buf),
        "reading a file to blame"
    )?;
    Ok(blob.data.to_vec())
}
