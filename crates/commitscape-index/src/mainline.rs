use commitscape_core::{Index, Oid};
use foldhash::{HashMap, HashMapExt};
use tracing::field::Empty;

use crate::source::RepoSource;

pub const REACHABLE: u8 = 8;

pub const FIRST_PARENT: u8 = 16;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Mainline {
    pub bits: Vec<u8>,
    pub arrival: Vec<Option<i64>>,
}

/// Works out the Mainline of an Index from its repository's HEAD: which commits HEAD reaches (bit 8), which are on its first-parent line (bit 16), and when each reached the default branch, aligned with `index.commits`.
pub fn mainline<S: RepoSource>(source: &S, index: &Index) -> Result<Mainline, S::Error> {
    Ok(mainline_since(source, index, None)?.0)
}

/// Works out the Mainline as `mainline` does, and which commits' Mainline moved since it was worked out from `before`, an earlier HEAD: `None` when `before` is not in HEAD's history.
pub fn mainline_since<S: RepoSource>(
    source: &S,
    index: &Index,
    before: Option<Oid>,
) -> Result<(Mainline, Option<Vec<bool>>), S::Error> {
    let span = tracing::info_span!("mainline", reachable = Empty, first_parent = Empty);
    let _entered = span.enter();
    let mut graph = Graph::default();
    let head = source.head_history(&mut |id, time, parents| graph.push(id, time, parents))?;
    let mut at: HashMap<Oid, usize> = HashMap::with_capacity(index.commits.len());
    for (i, c) in index.commits.iter().enumerate() {
        at.insert(c.id, i);
    }
    let (bits, arrival) = graph.mainline(head);
    let out = graph.place(&at, index.commits.len(), bits, arrival);
    span.record(
        "reachable",
        out.bits.iter().filter(|b| *b & REACHABLE != 0).count(),
    );
    span.record(
        "first_parent",
        out.bits.iter().filter(|b| *b & FIRST_PARENT != 0).count(),
    );
    let moved = before.and_then(|before| {
        if head == Some(before) {
            return Some(vec![false; index.commits.len()]);
        }
        let reached = graph.reached_from(before)?;
        let (bits, arrival) = graph.mainline(Some(before));
        let bits = bits
            .into_iter()
            .zip(reached)
            .map(|(b, r)| if r { b } else { 0 })
            .collect();
        let then = graph.place(&at, index.commits.len(), bits, arrival);
        Some(
            out.bits
                .iter()
                .zip(&then.bits)
                .zip(out.arrival.iter().zip(&then.arrival))
                .map(|((now, was), (came, had))| now != was || came != had)
                .collect(),
        )
    });
    Ok((out, moved))
}

#[derive(Default)]
struct Graph {
    ids: Vec<Oid>,
    times: Vec<i64>,
    parents: Vec<Oid>,
    ends: Vec<usize>,
}

impl Graph {
    fn push(&mut self, id: Oid, time: i64, parents: &[Oid]) {
        self.ids.push(id);
        self.times.push(time);
        self.parents.extend_from_slice(parents);
        self.ends.push(self.parents.len());
    }

    fn place(
        &self,
        at: &HashMap<Oid, usize>,
        len: usize,
        bits: Vec<u8>,
        arrival: Vec<Option<i64>>,
    ) -> Mainline {
        let mut out = Mainline {
            bits: vec![0; len],
            arrival: vec![None; len],
        };
        for ((id, b), a) in self.ids.iter().zip(bits).zip(arrival) {
            let Some(&i) = at.get(id) else {
                continue;
            };
            if let (Some(slot), Some(when)) = (out.bits.get_mut(i), out.arrival.get_mut(i)) {
                *slot = b;
                *when = a;
            }
        }
        out
    }

    fn reached_from(&self, from: Oid) -> Option<Vec<bool>> {
        let at: HashMap<Oid, usize> = self
            .ids
            .iter()
            .enumerate()
            .map(|(i, id)| (*id, i))
            .collect();
        let mut reached = vec![false; self.ids.len()];
        let mut stack = vec![*at.get(&from)?];
        while let Some(i) = stack.pop() {
            match reached.get_mut(i) {
                Some(r) if !*r => *r = true,
                _ => continue,
            }
            stack.extend(self.parents_of(i).iter().filter_map(|p| at.get(p).copied()));
        }
        Some(reached)
    }

    fn parents_of(&self, i: usize) -> &[Oid] {
        let start = match i {
            0 => 0,
            i => self.ends.get(i - 1).copied().unwrap_or(0),
        };
        let end = self.ends.get(i).copied().unwrap_or(start);
        self.parents.get(start..end).unwrap_or(&[])
    }

    fn mainline(&self, head: Option<Oid>) -> (Vec<u8>, Vec<Option<i64>>) {
        let n = self.ids.len();
        let mut at: HashMap<Oid, usize> = HashMap::with_capacity(n);
        for (i, id) in self.ids.iter().enumerate() {
            at.insert(*id, i);
        }
        let known: Vec<Vec<usize>> = (0..n)
            .map(|i| {
                self.parents_of(i)
                    .iter()
                    .filter_map(|p| at.get(p).copied())
                    .collect()
            })
            .collect();
        let first_parent = |i: usize| self.parents_of(i).first().and_then(|p| at.get(p).copied());

        let mut on_line = vec![false; n];
        let mut line = Vec::new();
        let mut next = head.and_then(|h| at.get(&h).copied());
        while let Some(i) = next {
            match on_line.get_mut(i) {
                Some(seen) if !*seen => *seen = true,
                _ => break,
            }
            line.push(i);
            next = first_parent(i);
        }

        let mut seen = vec![false; n];
        let mut arrival: Vec<Option<i64>> = vec![None; n];
        let mut stack: Vec<usize> = Vec::new();
        for &f in line.iter().rev() {
            let when = self.times.get(f).copied().unwrap_or(0);
            if let (Some(s), Some(a)) = (seen.get_mut(f), arrival.get_mut(f)) {
                *s = true;
                *a = Some(when);
            }
            stack.extend(known.get(f).into_iter().flatten().skip(1));
            while let Some(c) = stack.pop() {
                match seen.get_mut(c) {
                    Some(s) if !*s => *s = true,
                    _ => continue,
                }
                if let Some(a) = arrival.get_mut(c) {
                    *a = Some(when);
                }
                for &p in known.get(c).into_iter().flatten() {
                    if !seen.get(p).copied().unwrap_or(true) {
                        stack.push(p);
                    }
                }
            }
        }

        let bits = on_line
            .iter()
            .map(|&first| REACHABLE | if first { FIRST_PARENT } else { 0 })
            .collect();
        (bits, arrival)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(n: u8) -> Oid {
        Oid([n; 20])
    }

    fn graph(rows: &[(i64, u8, &[u8])]) -> Graph {
        let mut g = Graph::default();
        for (time, id, parents) in rows {
            let parents: Vec<Oid> = parents.iter().map(|p| oid(*p)).collect();
            g.push(oid(*id), *time, &parents);
        }
        g
    }

    #[test]
    fn a_commit_whose_first_parent_is_missing_arrives_by_itself_and_ends_the_line() {
        let g = graph(&[(30, 3, &[2]), (20, 2, &[9, 1]), (10, 1, &[])]);
        let (bits, arrival) = g.mainline(Some(oid(3)));
        assert_eq!(
            bits,
            vec![
                REACHABLE | FIRST_PARENT,
                REACHABLE | FIRST_PARENT,
                REACHABLE
            ]
        );
        assert_eq!(arrival, vec![Some(30), Some(20), None]);
    }

    #[test]
    fn without_a_head_every_commit_is_reachable_and_none_arrives() {
        let g = graph(&[(10, 1, &[])]);
        assert_eq!(g.mainline(None), (vec![REACHABLE], vec![None]));
    }
}
