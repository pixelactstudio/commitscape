use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};
use std::path::Path;
use std::rc::Rc;
use std::time::Instant;

use commitscape_core::Oid;
use imara_diff::{Algorithm, Diff, InternedInput};
use serde::{Deserialize, Serialize};

use crate::blame::{
    folder, ignored_map, line_count, line_map, spans_at, BlameFile, Gone, MayChange, Walked,
    UNMAPPED,
};
use crate::cache::Moved;
use crate::similarity::rename_source;
use crate::source::{BlameCommit, BlameSource, BlameThreads, InParent};

const MAX_THREADS: usize = 8;
const MAGIC: &[u8; 8] = b"CSOWNS\x00\x01";

type Seg = (u32, u32, u32);

/// One file at a head: its blob, and who owns its lines as runs of (commit, lines), the commit an index into the Ownership's commits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owned {
    pub blob: Oid,
    pub runs: Vec<(u32, u32)>,
}

/// Who owns every line of a head's files, as blame would say, kept per head so the next head only works out the files that changed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ownership {
    pub head: Option<Oid>,
    pub settings: u64,
    pub commits: Vec<Oid>,
    pub files: BTreeMap<Vec<u8>, Owned>,
    pub moves: HashMap<Oid, Moved>,
    pub complete: bool,
}

impl Ownership {
    /// Each owner of a file's lines with how many lines it owns.
    pub fn counts(&self, path: &[u8]) -> Vec<(Oid, u32)> {
        let Some(owned) = self.files.get(path) else {
            return Vec::new();
        };
        let mut counts: HashMap<Oid, u32> = HashMap::new();
        for &(c, n) in &owned.runs {
            if let Some(id) = self.commits.get(c as usize) {
                *counts.entry(*id).or_default() += n;
            }
        }
        let mut out: Vec<(Oid, u32)> = counts.into_iter().collect();
        out.sort_unstable();
        out
    }

    pub(crate) fn lines(&self, path: &[u8], blob: Oid) -> Option<Vec<Oid>> {
        let owned = self.files.get(path).filter(|o| o.blob == blob)?;
        let mut out = Vec::new();
        for &(c, n) in &owned.runs {
            let id = *self.commits.get(c as usize)?;
            out.extend(std::iter::repeat_n(id, n as usize));
        }
        Some(out)
    }

    /// Reads an Ownership written by `write`; None when there is none or it cannot be read.
    pub fn read(path: &Path) -> Option<Ownership> {
        let bytes = std::fs::read(path).ok()?;
        let body = bytes.strip_prefix(MAGIC)?;
        bincode::serde::decode_from_slice(body, bincode::config::standard())
            .ok()
            .map(|(o, _)| o)
    }

    /// Writes the Ownership beside the cache, whole, then moves it into place.
    pub fn write(&self, path: &Path) -> std::io::Result<()> {
        let mut out = MAGIC.to_vec();
        out.extend(
            bincode::serde::encode_to_vec(self, bincode::config::standard())
                .map_err(std::io::Error::other)?,
        );
        let temp = path.with_extension("writing");
        std::fs::write(&temp, out)?;
        std::fs::rename(temp, path)
    }

    pub(crate) fn add(
        &mut self,
        path: Vec<u8>,
        blob: Oid,
        owners: &[Oid],
        at: &mut HashMap<Oid, u32>,
    ) {
        let mut runs: Vec<(u32, u32)> = Vec::new();
        for id in owners {
            let c = *at.entry(*id).or_insert_with(|| {
                self.commits.push(*id);
                (self.commits.len() - 1) as u32
            });
            match runs.last_mut() {
                Some(last) if last.0 == c => last.1 += 1,
                _ => runs.push((c, 1)),
            }
        }
        self.files.insert(path, Owned { blob, runs });
    }
}

/// What the previous head's Ownership says, for blame walks that reach that head.
pub(crate) struct Known<'a> {
    pub(crate) head: Oid,
    pub(crate) ownership: &'a Ownership,
}

struct Item {
    file: usize,
    path: Rc<[u8]>,
    blob: Oid,
    text: Rc<Vec<u8>>,
    segs: Vec<Seg>,
}

struct Version {
    parent: Oid,
    blob: Oid,
    path: Rc<[u8]>,
    text: Option<Rc<Vec<u8>>>,
}

struct Walk<'a, S: BlameSource> {
    source: &'a S,
    may_change: MayChange<'a>,
    pass_through: &'a HashSet<Oid>,
    known: Option<&'a Known<'a>>,
    pending: HashMap<Oid, Vec<Item>>,
    heap: BinaryHeap<(i64, Oid)>,
    queued: HashSet<Oid>,
    commits: HashMap<Oid, Option<BlameCommit>>,
    left: Vec<u32>,
    owners: Vec<Vec<Oid>>,
}

/// Works out who owns each line of the given files at `head`, walking back as `blame` does (the same diffs, renames, merges and lines passed through), and stopping wherever a walk reaches the known head with a file whose ownership is known there. Hands each file's owners, one per line, to `finished` as soon as they are known.
#[allow(clippy::too_many_arguments)]
pub(crate) fn own<S: BlameSource>(
    source: &S,
    head: Oid,
    files: &[BlameFile],
    pass_through: &HashSet<Oid>,
    may_change: MayChange<'_>,
    known: Option<&Known<'_>>,
    deadline: Option<Instant>,
    batch_bytes: usize,
    finished: &mut dyn FnMut(usize, Vec<Oid>),
) -> Result<Walked, S::Error> {
    let late = || deadline.is_some_and(|d| Instant::now() >= d);
    let mut next = 0;
    while next < files.len() {
        let mut walk = Walk {
            source,
            may_change,
            pass_through,
            known,
            pending: HashMap::new(),
            heap: BinaryHeap::new(),
            queued: HashSet::new(),
            commits: HashMap::new(),
            left: vec![0; files.len()],
            owners: vec![Vec::new(); files.len()],
        };
        let start = next;
        let mut held = 0usize;
        while let Some(f) = files.get(next) {
            if next > start && held >= batch_bytes {
                break;
            }
            if late() {
                return Ok(Walked::OutOfTime);
            }
            let i = next;
            next += 1;
            let text = source.blame_blob(f.blob)?;
            held += text.len();
            let n = line_count(&text);
            if n == 0 {
                finished(i, Vec::new());
                continue;
            }
            if let Some(slot) = walk.left.get_mut(i) {
                *slot = n;
            }
            if let Some(slot) = walk.owners.get_mut(i) {
                *slot = vec![head; n as usize];
            }
            walk.push(
                head,
                Item {
                    file: i,
                    path: f.path.as_slice().into(),
                    blob: f.blob,
                    text: Rc::new(text),
                    segs: vec![(0, n, 0)],
                },
                finished,
            )?;
        }
        while let Some((_, id)) = walk.heap.pop() {
            if late() {
                return Ok(Walked::OutOfTime);
            }
            walk.queued.remove(&id);
            let Some(items) = walk.pending.remove(&id) else {
                continue;
            };
            walk.process(id, items, finished)?;
        }
    }
    Ok(Walked::Finished)
}

impl<S: BlameSource> Walk<'_, S> {
    fn commit(&mut self, id: Oid) -> Result<&Option<BlameCommit>, S::Error> {
        if !self.commits.contains_key(&id) {
            let found = self.source.blame_commit(id)?;
            self.commits.insert(id, found);
        }
        Ok(self.commits.get(&id).unwrap_or(&None))
    }

    fn push(
        &mut self,
        commit: Oid,
        item: Item,
        finished: &mut dyn FnMut(usize, Vec<Oid>),
    ) -> Result<(), S::Error> {
        if let Some(known) = self.known.filter(|k| k.head == commit) {
            if let Some(lines) = known.ownership.lines(&item.path, item.blob) {
                if lines.len() == line_count(&item.text) as usize {
                    self.resolve(item.file, &item.segs, &lines, finished);
                    return Ok(());
                }
            }
        }
        if self.queued.insert(commit) {
            let time = self.commit(commit)?.as_ref().map_or(i64::MIN, |c| c.time);
            self.heap.push((time, commit));
        }
        let items = self.pending.entry(commit).or_default();
        match items
            .iter_mut()
            .find(|i| i.file == item.file && i.blob == item.blob && i.path == item.path)
        {
            Some(same) => same.segs.extend(item.segs),
            None => items.push(item),
        }
        Ok(())
    }

    fn resolve(
        &mut self,
        file: usize,
        segs: &[Seg],
        lines: &[Oid],
        finished: &mut dyn FnMut(usize, Vec<Oid>),
    ) {
        let mut n = 0;
        if let Some(owners) = self.owners.get_mut(file) {
            for &(start, len, origin) in segs {
                for k in 0..len {
                    if let (Some(slot), Some(id)) = (
                        owners.get_mut((origin + k) as usize),
                        lines.get((start + k) as usize),
                    ) {
                        *slot = *id;
                    }
                }
                n += len;
            }
        }
        self.settle(file, n, finished);
    }

    fn attribute(
        &mut self,
        commit: Oid,
        file: usize,
        segs: &[Seg],
        finished: &mut dyn FnMut(usize, Vec<Oid>),
    ) {
        let mut n = 0;
        if let Some(owners) = self.owners.get_mut(file) {
            for &(_, len, origin) in segs {
                for slot in owners
                    .get_mut(origin as usize..(origin + len) as usize)
                    .unwrap_or(&mut [])
                {
                    *slot = commit;
                }
                n += len;
            }
        }
        self.settle(file, n, finished);
    }

    fn settle(&mut self, file: usize, n: u32, finished: &mut dyn FnMut(usize, Vec<Oid>)) {
        if n == 0 {
            return;
        }
        let Some(left) = self.left.get_mut(file) else {
            return;
        };
        *left = left.saturating_sub(n);
        if *left == 0 {
            if let Some(owners) = self.owners.get_mut(file) {
                finished(file, std::mem::take(owners));
            }
        }
    }

    fn process(
        &mut self,
        id: Oid,
        items: Vec<Item>,
        finished: &mut dyn FnMut(usize, Vec<Oid>),
    ) -> Result<(), S::Error> {
        self.commit(id)?;
        let parents = match self.commits.remove(&id).flatten() {
            Some(c) if !c.parents.is_empty() => c.parents,
            _ => {
                for item in items {
                    self.attribute(id, item.file, &item.segs, finished);
                }
                return Ok(());
            }
        };
        let items = match parents.as_slice() {
            [parent] => {
                let (check, same): (Vec<Item>, Vec<Item>) = items
                    .into_iter()
                    .partition(|i| (self.may_change)(id, &i.path));
                for item in same {
                    self.push(*parent, item, finished)?;
                }
                if check.is_empty() {
                    return Ok(());
                }
                check
            }
            _ => items,
        };
        let pass = parents.len() == 1 && self.pass_through.contains(&id);
        let mut open: Vec<(Item, Vec<Version>)> =
            items.into_iter().map(|i| (i, Vec::new())).collect();
        for parent in &parents {
            if open.is_empty() {
                break;
            }
            let paths: Vec<&[u8]> = open.iter().map(|(i, _)| &*i.path).collect();
            let states = self.source.blame_compare(id, *parent, &paths)?;
            drop(paths);
            let mut moved: Option<Gone> = None;
            let mut still = Vec::with_capacity(open.len());
            for ((item, mut versions), state) in open.into_iter().zip(
                states
                    .into_iter()
                    .chain(std::iter::repeat(InParent::Absent)),
            ) {
                match state {
                    InParent::Same => {
                        self.push(*parent, item, finished)?;
                        continue;
                    }
                    InParent::Changed(blob) => versions.push(Version {
                        parent: *parent,
                        blob,
                        path: item.path.clone(),
                        text: None,
                    }),
                    InParent::Absent => {
                        if moved.is_none() {
                            let deleted = self.source.blame_moves(id, *parent)?.deleted;
                            moved = Some(Gone {
                                texts: vec![None; deleted.len()],
                                deleted,
                            });
                        }
                        if let Some(Gone { deleted, texts }) = moved.as_mut() {
                            let source = self.source;
                            let found = rename_source(
                                (&item.path, item.blob, &item.text),
                                deleted,
                                &mut |i| spans_at(source, deleted, texts, i),
                            )?;
                            if let Some((from, blob)) = found.and_then(|j| deleted.get(j)) {
                                if *blob == item.blob {
                                    let path: Rc<[u8]> = from.as_slice().into();
                                    self.push(*parent, Item { path, ..item }, finished)?;
                                    continue;
                                }
                                versions.push(Version {
                                    parent: *parent,
                                    blob: *blob,
                                    path: from.as_slice().into(),
                                    text: found
                                        .and_then(|j| texts.get(j).cloned().flatten())
                                        .map(|t| t.0),
                                });
                            }
                        }
                    }
                }
                still.push((item, versions));
            }
            open = still;
        }

        for (item, versions) in open {
            let mut remaining = item.segs;
            for Version {
                parent,
                blob,
                path,
                text,
            } in versions
            {
                if remaining.is_empty() {
                    break;
                }
                let before = match text {
                    Some(text) => text,
                    None => Rc::new(self.source.blame_blob(blob)?),
                };
                let input = InternedInput::new(before.as_slice(), item.text.as_slice());
                let mut diff = Diff::compute(Algorithm::Myers, &input);
                diff.postprocess_lines(&input);
                let map = line_map(&diff, input.before.len(), input.after.len());
                let (mut passed, mut kept) = split(&remaining, &map);
                if pass && !kept.is_empty() {
                    let map = ignored_map(&before, &item.text, &diff);
                    let (more, still) = split(&kept, &map);
                    passed.extend(more);
                    kept = still;
                }
                if !passed.is_empty() {
                    self.push(
                        parent,
                        Item {
                            file: item.file,
                            path,
                            blob,
                            text: before,
                            segs: passed,
                        },
                        finished,
                    )?;
                }
                remaining = kept;
            }
            self.attribute(id, item.file, &remaining, finished);
        }
        Ok(())
    }
}

fn split(segs: &[Seg], map: &[u32]) -> (Vec<Seg>, Vec<Seg>) {
    let mut passed = Vec::new();
    let mut kept = Vec::new();
    for &(start, len, origin) in segs {
        for k in 0..len {
            let line = start + k;
            match map.get(line as usize).copied().filter(|&p| p != UNMAPPED) {
                Some(p) => extend(&mut passed, p, origin + k),
                None => extend(&mut kept, line, origin + k),
            }
        }
    }
    (passed, kept)
}

fn extend(runs: &mut Vec<Seg>, line: u32, origin: u32) {
    if let Some(last) = runs.last_mut() {
        if last.0 + last.1 == line && last.2 + last.1 == origin {
            last.1 += 1;
            return;
        }
    }
    runs.push((line, 1, origin));
}

/// Works out ownership as `own` does on several threads at once, each with its own handle on the repository and a share of the files grouped by folder, handing every file's owners to `finished` on the calling thread.
#[allow(clippy::too_many_arguments)]
pub(crate) fn own_in_threads<T: BlameThreads>(
    threads: &T,
    head: Oid,
    files: &[BlameFile],
    pass_through: &HashSet<Oid>,
    may_change: &(dyn Fn(Oid, &[u8]) -> bool + Sync),
    known: Option<&Known<'_>>,
    deadline: Option<Instant>,
    batch_bytes: usize,
    finished: &mut dyn FnMut(usize, Vec<Oid>),
) -> Result<Walked, <T::Local as BlameSource>::Error> {
    let count = crate::threads::threads(files.len())
        .min(MAX_THREADS)
        .min(files.len());
    if count <= 1 {
        return own(
            &threads.local(),
            head,
            files,
            pass_through,
            may_change,
            known,
            deadline,
            batch_bytes,
            finished,
        );
    }
    let per_thread = (batch_bytes / count).max(1);
    let mut folders: HashMap<&[u8], Vec<usize>> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        folders.entry(folder(&f.path)).or_default().push(i);
    }
    let mut folders: Vec<(&[u8], Vec<usize>)> = folders.into_iter().collect();
    folders.sort_unstable_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(b.0)));
    let mut shards: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (_, members) in folders {
        if let Some(smallest) = shards.iter_mut().min_by_key(|s| s.len()) {
            smallest.extend(members);
        }
    }

    std::thread::scope(|scope| {
        let (sent, received) = std::sync::mpsc::channel::<(usize, Vec<Oid>)>();
        let workers: Vec<_> = shards
            .into_iter()
            .filter(|s| !s.is_empty())
            .map(|shard| {
                let sent = sent.clone();
                scope.spawn(move || {
                    let local = threads.local();
                    let mine: Vec<BlameFile> = shard
                        .iter()
                        .filter_map(|&i| files.get(i).cloned())
                        .collect();
                    own(
                        &local,
                        head,
                        &mine,
                        pass_through,
                        may_change,
                        known,
                        deadline,
                        per_thread,
                        &mut |j, owners| {
                            if let Some(&i) = shard.get(j) {
                                let _ = sent.send((i, owners));
                            }
                        },
                    )
                })
            })
            .collect();
        drop(sent);
        for (i, owners) in received {
            finished(i, owners);
        }
        let mut walked = Walked::Finished;
        for worker in workers {
            match worker.join() {
                Ok(Ok(Walked::Finished)) => {}
                Ok(Ok(Walked::OutOfTime)) => walked = Walked::OutOfTime,
                Ok(Err(e)) => return Err(e),
                Err(panic) => std::panic::resume_unwind(panic),
            }
        }
        Ok(walked)
    })
}
