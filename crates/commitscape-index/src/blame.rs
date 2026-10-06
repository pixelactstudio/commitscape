use std::collections::{BinaryHeap, HashMap, HashSet};
use std::rc::Rc;
use std::time::Instant;

use commitscape_core::Oid;
use imara_diff::{Algorithm, Diff, InternedInput};

use crate::similarity::{rename_source, spans, Spans};
use crate::source::{BlameCommit, BlameSource, BlameThreads, InParent};

const UNMAPPED: u32 = u32::MAX;

const MAX_THREADS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameFile {
    pub path: Vec<u8>,
    pub blob: Oid,
}

pub type Blamed = Vec<(Oid, u32)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Walked {
    Finished,
    OutOfTime,
}

type Seg = (u32, u32);

pub(crate) type Text = (Rc<Vec<u8>>, Rc<Spans>);

#[derive(Clone)]
struct Gone {
    deleted: Vec<(Vec<u8>, Oid)>,
    texts: Vec<Option<Text>>,
}

struct Version {
    parent: Oid,
    blob: Oid,
    path: Rc<[u8]>,
    text: Option<Rc<Vec<u8>>>,
}

struct Item {
    file: usize,
    path: Rc<[u8]>,
    blob: Oid,
    text: Rc<Vec<u8>>,
    segs: Vec<Seg>,
}

pub type MayChange<'a> = &'a dyn Fn(Oid, &[u8]) -> bool;

struct Walk<'a, S: BlameSource> {
    source: &'a S,
    may_change: MayChange<'a>,
    pass_through: &'a HashSet<Oid>,
    pending: HashMap<Oid, Vec<Item>>,
    heap: BinaryHeap<(i64, Oid)>,
    queued: HashSet<Oid>,
    commits: HashMap<Oid, Option<BlameCommit>>,
    left: Vec<u32>,
    counts: Vec<HashMap<Oid, u32>>,
}

/// Blames each file at `head`, passing the lines of `pass_through` commits to their parent, and hands each file's line count per commit to `finished` as soon as it is known. `may_change` says whether a one-parent commit may have changed a path; where it says no, the commit is passed over unread.
pub fn blame<S: BlameSource>(
    source: &S,
    head: Oid,
    files: &[BlameFile],
    pass_through: &HashSet<Oid>,
    may_change: MayChange<'_>,
    deadline: Option<Instant>,
    finished: &mut dyn FnMut(usize, Blamed),
) -> Result<Walked, S::Error> {
    let mut walk = Walk {
        source,
        may_change,
        pass_through,
        pending: HashMap::new(),
        heap: BinaryHeap::new(),
        queued: HashSet::new(),
        commits: HashMap::new(),
        left: vec![0; files.len()],
        counts: vec![HashMap::new(); files.len()],
    };
    let late = || deadline.is_some_and(|d| Instant::now() >= d);
    for (i, f) in files.iter().enumerate() {
        if late() {
            return Ok(Walked::OutOfTime);
        }
        let text = source.blame_blob(f.blob)?;
        let n = line_count(&text);
        if n == 0 {
            finished(i, Vec::new());
            continue;
        }
        if let Some(slot) = walk.left.get_mut(i) {
            *slot = n;
        }
        walk.push(
            head,
            Item {
                file: i,
                path: f.path.as_slice().into(),
                blob: f.blob,
                text: Rc::new(text),
                segs: vec![(0, n)],
            },
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

    fn push(&mut self, commit: Oid, item: Item) -> Result<(), S::Error> {
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

    fn attribute(
        &mut self,
        commit: Oid,
        file: usize,
        segs: &[Seg],
        finished: &mut dyn FnMut(usize, Blamed),
    ) {
        let n: u32 = segs.iter().map(|s| s.1).sum();
        if n == 0 {
            return;
        }
        let Some(counts) = self.counts.get_mut(file) else {
            return;
        };
        *counts.entry(commit).or_default() += n;
        let Some(left) = self.left.get_mut(file) else {
            return;
        };
        *left = left.saturating_sub(n);
        if *left == 0 {
            let mut blamed: Blamed = std::mem::take(counts).into_iter().collect();
            blamed.sort_unstable();
            finished(file, blamed);
        }
    }

    fn process(
        &mut self,
        id: Oid,
        items: Vec<Item>,
        finished: &mut dyn FnMut(usize, Blamed),
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
                    self.push(*parent, item)?;
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
                        self.push(*parent, item)?;
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
                                    self.push(*parent, Item { path, ..item })?;
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
                    )?;
                }
                remaining = kept;
            }
            self.attribute(id, item.file, &remaining, finished);
        }
        Ok(())
    }
}

pub(crate) fn spans_at<S: BlameSource>(
    source: &S,
    deleted: &[(Vec<u8>, Oid)],
    texts: &mut [Option<Text>],
    i: usize,
) -> Result<Rc<Spans>, S::Error> {
    if let Some(Some((_, found))) = texts.get(i) {
        return Ok(found.clone());
    }
    let data = match deleted.get(i) {
        Some((_, blob)) => Rc::new(source.blame_blob(*blob)?),
        None => Rc::new(Vec::new()),
    };
    let found = Rc::new(spans(&data));
    if let Some(slot) = texts.get_mut(i) {
        *slot = Some((data, found.clone()));
    }
    Ok(found)
}

/// Blames the files on several threads at once, each with its own handle on the repository and a share of the files grouped by folder, handing every file's result to `finished` on the calling thread.
pub fn blame_in_threads<T: BlameThreads>(
    threads: &T,
    head: Oid,
    files: &[BlameFile],
    pass_through: &HashSet<Oid>,
    may_change: &(dyn Fn(Oid, &[u8]) -> bool + Sync),
    deadline: Option<Instant>,
    finished: &mut dyn FnMut(usize, Blamed),
) -> Result<Walked, <T::Local as BlameSource>::Error> {
    let count = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .clamp(1, MAX_THREADS)
        .min(files.len());
    if count <= 1 {
        return blame(
            &threads.local(),
            head,
            files,
            pass_through,
            may_change,
            deadline,
            finished,
        );
    }
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
        let (sent, received) = std::sync::mpsc::channel::<(usize, Blamed)>();
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
                    blame(
                        &local,
                        head,
                        &mine,
                        pass_through,
                        may_change,
                        deadline,
                        &mut |j, blamed| {
                            if let Some(&i) = shard.get(j) {
                                let _ = sent.send((i, blamed));
                            }
                        },
                    )
                })
            })
            .collect();
        drop(sent);
        for (i, blamed) in received {
            finished(i, blamed);
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

fn folder(path: &[u8]) -> &[u8] {
    let mut slashes = path
        .iter()
        .enumerate()
        .filter(|(_, &b)| b == b'/')
        .map(|(i, _)| i);
    match (slashes.next(), slashes.next()) {
        (_, Some(second)) => path.get(..second).unwrap_or(path),
        (Some(first), None) => path.get(..first).unwrap_or(path),
        _ => b"",
    }
}

fn line_count(text: &[u8]) -> u32 {
    let n = text.iter().filter(|&&c| c == b'\n').count();
    (n + usize::from(text.last().is_some_and(|&c| c != b'\n'))) as u32
}

fn line_map(diff: &Diff, before: usize, after: usize) -> Vec<u32> {
    let mut map = vec![UNMAPPED; after];
    let mut b = 0u32;
    for (a, slot) in map.iter_mut().enumerate() {
        if diff.is_added(a as u32) {
            continue;
        }
        while (b as usize) < before && diff.is_removed(b) {
            b += 1;
        }
        *slot = b;
        b += 1;
    }
    map
}

fn split(segs: &[Seg], map: &[u32]) -> (Vec<Seg>, Vec<Seg>) {
    let mut passed = Vec::new();
    let mut kept = Vec::new();
    for &(start, len) in segs {
        for line in start..start + len {
            match map.get(line as usize).copied().filter(|&p| p != UNMAPPED) {
                Some(p) => extend(&mut passed, p),
                None => extend(&mut kept, line),
            }
        }
    }
    (passed, kept)
}

fn extend(runs: &mut Vec<Seg>, line: u32) {
    if let Some(last) = runs.last_mut() {
        if last.0 + last.1 == line {
            last.1 += 1;
            return;
        }
    }
    runs.push((line, 1));
}

fn lines_of(text: &[u8]) -> Vec<&[u8]> {
    text.split_inclusive(|&c| c == b'\n').collect()
}

fn squeezed(line: &[u8]) -> Vec<u8> {
    line.iter()
        .copied()
        .filter(|c| !c.is_ascii_whitespace())
        .collect()
}

fn ignored_map(before: &[u8], after: &[u8], diff: &Diff) -> Vec<u32> {
    let old = lines_of(before);
    let new = lines_of(after);
    let mut map = vec![UNMAPPED; new.len()];
    for hunk in diff.hunks() {
        let from = old
            .get(hunk.before.start as usize..hunk.before.end as usize)
            .unwrap_or(&[]);
        let to = new
            .get(hunk.after.start as usize..hunk.after.end as usize)
            .unwrap_or(&[]);
        let mut input: InternedInput<Vec<u8>> = InternedInput::default();
        input.update_before(from.iter().map(|l| squeezed(l)));
        input.update_after(to.iter().map(|l| squeezed(l)));
        let inner = Diff::compute(Algorithm::Myers, &input);
        let matched = line_map(&inner, from.len(), to.len());
        let slots = map
            .get_mut(hunk.after.start as usize..hunk.after.end as usize)
            .unwrap_or(&mut []);
        for (slot, m) in slots.iter_mut().zip(matched) {
            if m != UNMAPPED {
                *slot = hunk.before.start + m;
            }
        }
    }
    map
}
