use std::path::{Path, PathBuf};

use commitscape_core::{Column, Index, Oid, Record};
use commitscape_map::Records;
use foldhash::{HashMap, HashMapExt, HashSet};
use tracing::field::Empty;
use xxhash_rust::xxh3::{xxh3_64, Xxh3};

use crate::cache::{repo_dir, CacheOptions};
use crate::commit_at::CommitAt;
use crate::mainline::{Mainline, FIRST_PARENT, REACHABLE};
use crate::source::RepoSource;

const FILE: &str = "graph";
const MAGIC: [u8; 8] = *b"CSGRAPH\x02";
const PAGE: u64 = 4096;
const HEADER: usize = 69;
const NONE: u32 = u32::MAX;
const UPDATE_MAX: usize = 50_000;

struct Line {
    head: Oid,
    bits: Column<u8>,
    by: Column<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kept {
    Same,
    Updated { added: usize },
    Made,
}

pub struct CommitGraph {
    lineage: u64,
    hashes: Column<u32>,
    ends: Column<u32>,
    parents: Column<u32>,
    line: Option<Line>,
    path: Option<PathBuf>,
    changed: bool,
    pub kept: Kept,
}

fn short(id: &Oid) -> u32 {
    xxh3_64(&id.0) as u32
}

fn ids_hash<'a>(ids: impl Iterator<Item = &'a Oid>) -> u64 {
    let mut h = Xxh3::new();
    for id in ids {
        h.update(&id.0);
    }
    h.digest()
}

fn place_of(index: &Index, id: Oid, time: i64) -> Option<u32> {
    let at = index
        .commits
        .partition_point(|c| (c.time, c.id.0) < (time, id.0));
    let c = index.commits.get(at)?;
    (c.id == id).then_some(at as u32)
}

fn places_of(index: &Index, ids: &[Oid]) -> Vec<Option<u32>> {
    let wanted: HashSet<Oid> = ids.iter().copied().collect();
    let mut found: HashMap<Oid, u32> = HashMap::with_capacity(ids.len());
    for (i, c) in index.commits.iter().enumerate() {
        if wanted.contains(&c.id) {
            found.insert(c.id, i as u32);
        }
    }
    ids.iter().map(|id| found.get(id).copied()).collect()
}

impl CommitGraph {
    /// The graph of `index` from the cache when it still lines up with the Index, brought up to date from the commits added since, or made again by walking git. A cut-short history is always walked again.
    pub fn of<S: RepoSource>(
        source: &S,
        options: &CacheOptions,
        index: &Index,
        lineage: u64,
    ) -> Result<CommitGraph, S::Error> {
        let span = tracing::info_span!("graph", kept = Empty, added = Empty);
        let _entered = span.enter();
        let path = repo_dir(options, &index.repo).map(|d| d.join(FILE));
        let read = path
            .as_deref()
            .filter(|_| !index.history_truncated)
            .and_then(read)
            .filter(|g| g.lineage == lineage);
        let lined = match read {
            Some(stored) => stored.lined_up(source, index)?,
            None => None,
        };
        let mut graph = match lined {
            Some(g) => g,
            None => Self::made(source, index, lineage)?,
        };
        graph.path = path.filter(|_| !index.history_truncated);
        match graph.kept {
            Kept::Same => span.record("kept", "same"),
            Kept::Updated { added } => {
                span.record("added", added);
                span.record("kept", "updated")
            }
            Kept::Made => span.record("kept", "made"),
        };
        Ok(graph)
    }

    fn made<S: RepoSource>(
        source: &S,
        index: &Index,
        lineage: u64,
    ) -> Result<CommitGraph, S::Error> {
        let n = index.commits.len();
        let at = CommitAt::of(index);
        let mut edges: Vec<(u32, u32)> = Vec::with_capacity(n + n / 8);
        source.history_parents(&mut |id, parents| {
            if let Some(child) = at.position(index, &id) {
                edges.extend(
                    parents
                        .iter()
                        .map(|p| (child, at.position(index, p).unwrap_or(NONE))),
                );
            }
        })?;
        drop(at);
        edges.sort_by_key(|&(child, _)| child);
        let mut ends = Vec::with_capacity(n);
        let mut parents = Vec::with_capacity(edges.len());
        let mut next = edges.iter().peekable();
        for i in 0..n as u32 {
            while let Some(&(_, parent)) = next.next_if(|&&(child, _)| child == i) {
                parents.push(parent);
            }
            ends.push(parents.len() as u32);
        }
        drop(edges);
        Ok(CommitGraph {
            lineage,
            hashes: index
                .commits
                .iter()
                .map(|c| short(&c.id))
                .collect::<Vec<_>>()
                .into(),
            ends: ends.into(),
            parents: parents.into(),
            line: None,
            path: None,
            changed: true,
            kept: Kept::Made,
        })
    }

    fn parents(&self, i: u32) -> &[u32] {
        let i = i as usize;
        let start = if i == 0 {
            0
        } else {
            self.ends.get(i - 1).copied().unwrap_or(0) as usize
        };
        let end = self.ends.get(i).copied().unwrap_or(0) as usize;
        self.parents.get(start..end).unwrap_or(&[])
    }

    fn first_parent(&self, i: u32) -> Option<u32> {
        self.parents(i).first().copied().filter(|&p| p != NONE)
    }

    fn extend(&self, line: &[u32], bits: &mut [u8], by: &mut [u32], touched: &mut Vec<u32>) {
        let mut stack: Vec<u32> = Vec::new();
        for &f in line.iter().rev() {
            if let (Some(b), Some(w)) = (bits.get_mut(f as usize), by.get_mut(f as usize)) {
                *b |= REACHABLE | FIRST_PARENT;
                *w = f;
                touched.push(f);
            }
            stack.extend(self.parents(f).iter().filter(|&&p| p != NONE).skip(1));
            while let Some(c) = stack.pop() {
                match bits.get_mut(c as usize) {
                    Some(b) if *b & REACHABLE == 0 => *b |= REACHABLE,
                    _ => continue,
                }
                if let Some(w) = by.get_mut(c as usize) {
                    *w = f;
                }
                touched.push(c);
                for &p in self.parents(c) {
                    if p != NONE && bits.get(p as usize).is_some_and(|b| b & REACHABLE == 0) {
                        stack.push(p);
                    }
                }
            }
        }
    }

    fn line_from(&self, head: u32, stop: Option<u32>) -> Option<Vec<u32>> {
        let mut line = Vec::new();
        let mut seen = vec![false; self.hashes.len()];
        let mut next = Some(head);
        while let Some(i) = next {
            if Some(i) == stop {
                return Some(line);
            }
            match seen.get_mut(i as usize) {
                Some(s) if !*s => *s = true,
                _ => break,
            }
            line.push(i);
            next = self.first_parent(i);
        }
        stop.is_none().then_some(line)
    }

    fn whole_line(&self, head: u32) -> (Vec<u8>, Vec<u32>) {
        let n = self.hashes.len();
        let mut bits = vec![0u8; n];
        let mut by = vec![NONE; n];
        let line = self.line_from(head, None).unwrap_or_default();
        self.extend(&line, &mut bits, &mut by, &mut Vec::new());
        (bits, by)
    }

    fn mainline_of(index: &Index, bits: &[u8], by: &[u32]) -> Mainline {
        Mainline {
            bits: bits.to_vec(),
            arrival: by
                .iter()
                .map(|&f| {
                    (f != NONE)
                        .then(|| index.commits.get(f as usize).map(|c| c.time))
                        .flatten()
                })
                .collect(),
        }
    }

    /// The Mainline of the Index's HEAD, aligned with `index.commits`, and which commits' Mainline moved since it was worked out from `before`: `None` when `before` is not in HEAD's history. When HEAD went forward along its first-parent line from the head the graph kept the Mainline of, only the new part is walked; otherwise the whole line, in memory.
    pub fn mainline_since(
        &mut self,
        index: &Index,
        before: Option<Oid>,
    ) -> (Mainline, Option<Vec<bool>>) {
        let span = tracing::info_span!(
            "mainline",
            reachable = Empty,
            first_parent = Empty,
            walked = Empty
        );
        let _entered = span.enter();
        let n = self.hashes.len();
        let empty = || Mainline {
            bits: vec![0; n],
            arrival: vec![None; n],
        };
        let Some(head) = index.head_commit else {
            return (empty(), None);
        };
        let kept = self.line.take();
        let wanted: Vec<Oid> = [Some(head), before, kept.as_ref().map(|l| l.head)]
            .into_iter()
            .flatten()
            .collect();
        let places: HashMap<Oid, Option<u32>> = wanted
            .iter()
            .copied()
            .zip(places_of(index, &wanted))
            .collect();
        let at = |id: Oid| places.get(&id).copied().flatten();
        let Some(h) = at(head) else {
            return (empty(), None);
        };
        let mut touched = Vec::new();
        let forward = kept.and_then(|l| {
            if l.head == head {
                return Some(l);
            }
            let line = self.line_from(h, Some(at(l.head)?))?;
            let Line {
                head: was,
                mut bits,
                mut by,
            } = l;
            self.extend(&line, &mut bits, &mut by, &mut touched);
            Some(Line {
                head: was,
                bits,
                by,
            })
        });
        let (bits, by, from) = match forward {
            Some(l) => (l.bits, l.by, Some(l.head)),
            None => {
                touched.clear();
                let (bits, by) = self.whole_line(h);
                (bits.into(), by.into(), None)
            }
        };
        span.record("walked", touched.len());
        span.record(
            "reachable",
            bits.iter().filter(|b| *b & REACHABLE != 0).count(),
        );
        span.record(
            "first_parent",
            bits.iter().filter(|b| *b & FIRST_PARENT != 0).count(),
        );
        let out = Self::mainline_of(index, &bits, &by);
        let moved = before.and_then(|before| {
            if before == head {
                return Some(vec![false; n]);
            }
            let b = at(before)?;
            if bits.get(b as usize).is_none_or(|x| x & REACHABLE == 0) {
                return None;
            }
            if from == Some(before) {
                let mut moved = vec![false; n];
                for &t in &touched {
                    if let Some(m) = moved.get_mut(t as usize) {
                        *m = true;
                    }
                }
                return Some(moved);
            }
            let (then_bits, then_by) = self.whole_line(b);
            let then = Self::mainline_of(index, &then_bits, &then_by);
            Some(
                out.bits
                    .iter()
                    .zip(&then.bits)
                    .zip(out.arrival.iter().zip(&then.arrival))
                    .map(|((now, was), (came, had))| now != was || came != had)
                    .collect(),
            )
        });
        if from != Some(head) {
            self.changed = true;
        }
        self.line = Some(Line { head, bits, by });
        (out, moved)
    }

    /// Which commits of the Index the given ones reach, aligned with `index.commits`; None when one of them is not in the Index.
    pub fn reached_from(&self, index: &Index, from: &[Oid]) -> Option<Vec<bool>> {
        let span = tracing::info_span!("reached", from = from.len(), reached = Empty);
        let _entered = span.enter();
        let mut reached = vec![false; self.hashes.len()];
        let mut stack: Vec<u32> = Vec::with_capacity(from.len());
        for p in places_of(index, from) {
            stack.push(p?);
        }
        let mut count = 0usize;
        while let Some(i) = stack.pop() {
            match reached.get_mut(i as usize) {
                Some(r) if !*r => *r = true,
                _ => continue,
            }
            count += 1;
            stack.extend(
                self.parents(i)
                    .iter()
                    .filter(|&&p| p != NONE && !reached.get(p as usize).copied().unwrap_or(true)),
            );
        }
        span.record("reached", count);
        Some(reached)
    }

    /// Writes the graph and its Mainline to the cache when either changed; a graph that cannot be written is made again next time.
    pub fn keep(&mut self, index: &Index) {
        let Some(path) = self.path.as_deref() else {
            return;
        };
        if !self.changed {
            return;
        }
        if write(path, self, index).is_ok() {
            self.changed = false;
        }
    }
}

struct Stored {
    lineage: u64,
    ids: u64,
    hashes: Column<u32>,
    ends: Column<u32>,
    parents: Column<u32>,
    line: Option<Line>,
}

impl Stored {
    fn lined_up<S: RepoSource>(
        self,
        source: &S,
        index: &Index,
    ) -> Result<Option<CommitGraph>, S::Error> {
        let n = index.commits.len();
        let old = self.hashes.len();
        let mut new_of_old: Vec<u32> = Vec::with_capacity(old);
        let mut added: Vec<usize> = Vec::new();
        for (p, c) in index.commits.iter().enumerate() {
            if self.hashes.get(new_of_old.len()) == Some(&short(&c.id)) {
                new_of_old.push(p as u32);
            } else {
                added.push(p);
            }
        }
        if new_of_old.len() != old || added.len() > UPDATE_MAX {
            return Ok(None);
        }
        let ids = new_of_old
            .iter()
            .filter_map(|&p| index.commits.get(p as usize).map(|c| &c.id));
        if ids_hash(ids) != self.ids {
            return Ok(None);
        }
        if added.is_empty() {
            return Ok(Some(CommitGraph {
                lineage: self.lineage,
                hashes: self.hashes,
                ends: self.ends,
                parents: self.parents,
                line: self.line,
                path: None,
                changed: false,
                kept: Kept::Same,
            }));
        }
        let added_ids: Vec<Oid> = added
            .iter()
            .filter_map(|&p| index.commits.get(p).map(|c| c.id))
            .collect();
        let asked = source.parents_of(&added_ids)?;
        let mut new_parents: HashMap<u32, Vec<u32>> = HashMap::with_capacity(added.len());
        for (&p, found) in added.iter().zip(asked) {
            let Some(found) = found else {
                return Ok(None);
            };
            let mut places = Vec::with_capacity(found.len());
            for (id, time) in found {
                let Some(at) = place_of(index, id, time) else {
                    return Ok(None);
                };
                places.push(at);
            }
            new_parents.insert(p as u32, places);
        }
        let move_place = |q: u32| {
            if q == NONE {
                NONE
            } else {
                new_of_old.get(q as usize).copied().unwrap_or(NONE)
            }
        };
        let mut ends = Vec::with_capacity(n);
        let mut parents = Vec::with_capacity(self.parents.len() + added.len() * 2);
        let mut o = 0usize;
        for p in 0..n as u32 {
            match new_parents.get(&p) {
                Some(found) => parents.extend_from_slice(found),
                None => {
                    let start = o
                        .checked_sub(1)
                        .and_then(|i| self.ends.get(i))
                        .copied()
                        .unwrap_or(0) as usize;
                    let end = self.ends.get(o).copied().unwrap_or(0) as usize;
                    parents.extend(
                        self.parents
                            .get(start..end)
                            .unwrap_or(&[])
                            .iter()
                            .map(|&q| move_place(q)),
                    );
                    o += 1;
                }
            }
            ends.push(parents.len() as u32);
        }
        let line = self.line.map(|l| {
            let mut bits = vec![0u8; n];
            let mut by = vec![NONE; n];
            for (o, (&b, &f)) in l.bits.iter().zip(&l.by).enumerate() {
                if let Some(&p) = new_of_old.get(o) {
                    if let (Some(slot), Some(from)) =
                        (bits.get_mut(p as usize), by.get_mut(p as usize))
                    {
                        *slot = b;
                        *from = move_place(f);
                    }
                }
            }
            Line {
                head: l.head,
                bits: bits.into(),
                by: by.into(),
            }
        });
        Ok(Some(CommitGraph {
            lineage: self.lineage,
            hashes: index
                .commits
                .iter()
                .map(|c| short(&c.id))
                .collect::<Vec<_>>()
                .into(),
            ends: ends.into(),
            parents: parents.into(),
            line,
            path: None,
            changed: true,
            kept: Kept::Updated { added: added.len() },
        }))
    }
}

fn aligned(at: u64) -> u64 {
    at.div_ceil(PAGE) * PAGE
}

fn layout(n: u64, m: u64, line: bool) -> [(u64, u64, u64); 5] {
    let mut at = PAGE;
    let mut out = [(0, 0, 0); 5];
    let line = u64::from(line);
    for (slot, (count, size)) in
        out.iter_mut()
            .zip([(n, 4), (n, 4), (m, 4), (n * line, 1), (n * line, 4)])
    {
        *slot = (at, count, size);
        at = aligned(at + count * size);
    }
    out
}

fn summed<T: Record>(h: &mut Xxh3, values: &[T]) {
    let mut buf = vec![0u8; T::SIZE * 16_384];
    for chunk in values.chunks(16_384) {
        for (v, slot) in chunk.iter().zip(buf.chunks_mut(T::SIZE)) {
            v.write_to(slot);
        }
        h.update(buf.get(..chunk.len() * T::SIZE).unwrap_or(&[]));
    }
}

fn checksum(hashes: &[u32], ends: &[u32], parents: &[u32], line: Option<&Line>) -> u64 {
    let mut h = Xxh3::new();
    summed(&mut h, hashes);
    summed(&mut h, ends);
    summed(&mut h, parents);
    if let Some(l) = line {
        h.update(&l.head.0);
        h.update(&l.bits);
        summed(&mut h, &l.by);
    }
    h.digest()
}

fn header_u64(header: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(header.get(at..at + 8)?.try_into().ok()?))
}

fn read(path: &Path) -> Option<Stored> {
    use std::io::Read as _;
    let mut file = std::fs::File::open(path).ok()?;
    let mut header = [0u8; HEADER];
    file.read_exact(&mut header).ok()?;
    if header.get(..8)? != MAGIC {
        return None;
    }
    let lineage = header_u64(&header, 8)?;
    let ids = header_u64(&header, 16)?;
    let n = header_u64(&header, 24)?;
    let m = header_u64(&header, 32)?;
    let sum = header_u64(&header, 40)?;
    let has_line = *header.get(48)? == 1;
    let head = Oid::from_bytes(header.get(49..69)?)?;
    let [h, e, p, b, y] = layout(n, m, has_line);
    let size = |x: u64| usize::try_from(x).ok();
    let hashes = Column::mapped(Box::new(Records::<u32>::open(&file, h.0, size(h.1)?).ok()?));
    let ends = Column::mapped(Box::new(Records::<u32>::open(&file, e.0, size(e.1)?).ok()?));
    let parents = Column::mapped(Box::new(Records::<u32>::open(&file, p.0, size(p.1)?).ok()?));
    let line = has_line
        .then(|| {
            Some(Line {
                head,
                bits: Column::mapped(Box::new(Records::<u8>::open(&file, b.0, size(b.1)?).ok()?)),
                by: Column::mapped(Box::new(Records::<u32>::open(&file, y.0, size(y.1)?).ok()?)),
            })
        })
        .flatten();
    if has_line && line.is_none() {
        return None;
    }
    if ends.last().is_some_and(|&x| u64::from(x) != m)
        || checksum(&hashes, &ends, &parents, line.as_ref()) != sum
    {
        return None;
    }
    Some(Stored {
        lineage,
        ids,
        hashes,
        ends,
        parents,
        line,
    })
}

fn put<T: Record>(file: &std::fs::File, at: u64, values: &[T]) -> std::io::Result<()> {
    let mut buf = vec![0u8; T::SIZE * 65_536];
    let mut offset = at;
    for chunk in values.chunks(65_536) {
        for (v, slot) in chunk.iter().zip(buf.chunks_mut(T::SIZE)) {
            v.write_to(slot);
        }
        let bytes = buf.get(..chunk.len() * T::SIZE).unwrap_or(&[]);
        commitscape_map::write_all_at(file, bytes, offset)?;
        offset += bytes.len() as u64;
    }
    Ok(())
}

fn write(path: &Path, graph: &CommitGraph, index: &Index) -> std::io::Result<()> {
    let n = graph.hashes.len() as u64;
    let m = graph.parents.len() as u64;
    let line = graph.line.as_ref();
    let [h, e, p, b, y] = layout(n, m, line.is_some());
    let temp = path.with_extension("writing");
    let file = std::fs::File::create(&temp)?;
    put(&file, h.0, &graph.hashes)?;
    put(&file, e.0, &graph.ends)?;
    put(&file, p.0, &graph.parents)?;
    let mut end = aligned(p.0 + m * 4);
    if let Some(l) = line {
        put(&file, b.0, &l.bits)?;
        put(&file, y.0, &l.by)?;
        end = aligned(y.0 + n * 4);
    }
    let mut header = Vec::with_capacity(HEADER);
    header.extend_from_slice(&MAGIC);
    header.extend_from_slice(&graph.lineage.to_le_bytes());
    header.extend_from_slice(&ids_hash(index.commits.iter().map(|c| &c.id)).to_le_bytes());
    header.extend_from_slice(&n.to_le_bytes());
    header.extend_from_slice(&m.to_le_bytes());
    header.extend_from_slice(
        &checksum(&graph.hashes, &graph.ends, &graph.parents, line).to_le_bytes(),
    );
    header.push(u8::from(line.is_some()));
    header.extend_from_slice(&line.map_or([0; 20], |l| l.head.0));
    commitscape_map::write_all_at(&file, &header, 0)?;
    file.set_len(end.max(PAGE))?;
    file.sync_data()?;
    drop(file);
    std::fs::rename(&temp, path)
}
