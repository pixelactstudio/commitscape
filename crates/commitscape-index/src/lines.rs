use commitscape_core::LineDelta;
use imara_diff::{Algorithm, Diff, InternedInput};

pub const MAX_BYTES: usize = 1 << 20;

pub(crate) fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8_000).any(|&b| b == 0)
}

pub fn line_delta(before: &[u8], after: &[u8]) -> Option<LineDelta> {
    if before.len() > MAX_BYTES || after.len() > MAX_BYTES || is_binary(before) || is_binary(after)
    {
        return None;
    }
    let lines = |b: &[u8]| {
        let n = b.iter().filter(|&&c| c == b'\n').count();
        (n + usize::from(b.last().is_some_and(|&c| c != b'\n'))) as u32
    };
    if before.is_empty() || after.is_empty() {
        return Some(LineDelta {
            added: lines(after),
            removed: lines(before),
        });
    }
    let (before, after) = differing_lines(before, after);
    let input = InternedInput::new(before, after);
    let diff = Diff::compute(Algorithm::Myers, &input);
    Some(LineDelta {
        added: diff.count_additions(),
        removed: diff.count_removals(),
    })
}

fn differing_lines<'a>(before: &'a [u8], after: &'a [u8]) -> (&'a [u8], &'a [u8]) {
    let same = common_prefix(before, after);
    if same == before.len() && same == after.len() {
        return (&[], &[]);
    }
    let start = before
        .get(..same)
        .and_then(|b| b.iter().rposition(|&c| c == b'\n'))
        .map_or(0, |i| i + 1);
    let (before, after) = (
        before.get(start..).unwrap_or_default(),
        after.get(start..).unwrap_or_default(),
    );
    let same = common_suffix(before, after);
    let region = before.get(before.len() - same..).unwrap_or_default();
    let starts_line = |b: &[u8]| b.len() == same || b.get(b.len() - same - 1) == Some(&b'\n');
    let tail = if starts_line(before) && starts_line(after) {
        same
    } else {
        region
            .iter()
            .position(|&c| c == b'\n')
            .map_or(0, |i| same - i - 1)
    };
    (
        before.get(..before.len() - tail).unwrap_or_default(),
        after.get(..after.len() - tail).unwrap_or_default(),
    )
}

fn common_prefix(a: &[u8], b: &[u8]) -> usize {
    const STEP: usize = 64;
    let n = a.len().min(b.len());
    let mut i = 0;
    while i + STEP <= n && a.get(i..i + STEP) == b.get(i..i + STEP) {
        i += STEP;
    }
    while i < n && a.get(i) == b.get(i) {
        i += 1;
    }
    i
}

fn common_suffix(a: &[u8], b: &[u8]) -> usize {
    const STEP: usize = 64;
    let n = a.len().min(b.len());
    let (la, lb) = (a.len(), b.len());
    let mut i = 0;
    while i + STEP <= n && a.get(la - i - STEP..la - i) == b.get(lb - i - STEP..lb - i) {
        i += STEP;
    }
    while i < n && a.get(la - i - 1) == b.get(lb - i - 1) {
        i += 1;
    }
    i
}

use std::borrow::Cow;
use std::cmp::Reverse;
use std::time::{Duration, Instant};

use commitscape_core::{CommitMeta, FileId, Index, LinePass, Oid};
use tracing::field::Empty;

use crate::build::{pair_exact_renames, Resolved};
use crate::cache::{Counted, LineStore};
use crate::mainline::{mainline, REACHABLE};
use crate::source::{LineWork, RawChange, RepoSource};

const FLUSH: usize = 512;

#[derive(Debug, Clone, Default)]
pub struct LinePlan {
    pub skip_commits: Vec<bool>,
    pub skip_files: Vec<bool>,
    pub mainline: Option<Vec<u8>>,
    pub budget: Option<Duration>,
}

impl LinePlan {
    fn skips_commit(&self, at: usize, c: &CommitMeta) -> bool {
        c.is_merge() || self.skip_commits.get(at).copied().unwrap_or(false)
    }

    fn skips_file(&self, file: FileId) -> bool {
        self.skip_files.get(file.idx()).copied().unwrap_or(false)
    }
}

/// Counts the lines each change added and removed, the Mainline first and newest first, leaving out what the plan skips, keeping what it counted in the line store as it goes, and stopping when the plan's budget runs out.
pub fn line_pass<S: RepoSource>(
    source: &S,
    index: &Index,
    plan: &LinePlan,
    store: Option<&LineStore>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<LinePass, S::Error> {
    let span = tracing::info_span!(
        "line_pass",
        commits = Empty,
        mainline = Empty,
        counted = Empty,
        left = Empty
    );
    let _entered = span.enter();
    let until = plan.budget.and_then(|b| Instant::now().checked_add(b));
    let mut known = store.map(LineStore::read).unwrap_or_default();
    let todo: Vec<usize> = index
        .commits
        .iter()
        .enumerate()
        .filter(|(i, c)| !plan.skips_commit(*i, c) && !known.contains_key(&c.id))
        .map(|(i, _)| i)
        .collect();
    span.record("commits", todo.len());
    let mainline_count = count_into(
        source, index, plan, store, &mut known, todo, until, progress,
    )?;
    span.record("mainline", mainline_count);

    let mut lines = vec![None; index.changes.len()];
    let mut settled = vec![true; index.commits.len()];
    let (mut counted, mut left) = (0u64, 0u64);
    for (i, c) in index.commits.iter().enumerate() {
        if plan.skips_commit(i, c) {
            continue;
        }
        let Some(deltas) = known.get(&c.id) else {
            left += 1;
            if let Some(s) = settled.get_mut(i) {
                *s = false;
            }
            continue;
        };
        counted += 1;
        if let Some(slots) = lines.get_mut(c.changes()) {
            if slots.len() == deltas.len() {
                for ((slot, delta), change) in slots.iter_mut().zip(deltas).zip(index.changes_of(c))
                {
                    *slot = if plan.skips_file(change.file) {
                        None
                    } else {
                        *delta
                    };
                }
            }
        }
    }
    span.record("counted", counted);
    span.record("left", left);
    Ok(LinePass {
        lines,
        ignored: source.blame_ignore_revs()?,
        counted,
        left,
        settled,
    })
}

#[allow(clippy::too_many_arguments)]
fn count_into<S: RepoSource>(
    source: &S,
    index: &Index,
    plan: &LinePlan,
    store: Option<&LineStore>,
    known: &mut Counted,
    mut todo: Vec<usize>,
    until: Option<Instant>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<usize, S::Error> {
    let bits = match (&plan.mainline, todo.is_empty()) {
        (Some(bits), _) => Cow::Borrowed(bits.as_slice()),
        (None, false) => Cow::Owned(mainline(source, index)?.bits),
        (None, true) => Cow::Borrowed(&[][..]),
    };
    let on_mainline = |i: usize| bits.get(i).is_some_and(|b| b & REACHABLE != 0);
    order(&mut todo, &bits);
    let on_line = todo.iter().filter(|&&i| on_mainline(i)).count();

    let mut skips: Vec<bool> = Vec::new();
    let mut ends: Vec<usize> = Vec::with_capacity(todo.len());
    for &i in &todo {
        if let Some(c) = index.commits.get(i) {
            skips.extend(
                index
                    .changes_of(c)
                    .iter()
                    .map(|ch| plan.skips_file(ch.file)),
            );
        }
        ends.push(skips.len());
    }

    let counting = {
        let mut kept = Kept {
            store,
            known,
            fresh: Vec::new(),
            done: 0,
            total: todo.len() as u64,
            progress,
        };
        (kept.progress)(0, kept.total);
        let mut work = Vec::with_capacity(todo.len());
        let mut start = 0;
        for (&i, &end) in todo.iter().zip(&ends) {
            let Some(c) = index.commits.get(i) else {
                continue;
            };
            let skip = skips.get(start..end).unwrap_or(&[]);
            start = end;
            if !skip.is_empty() && skip.iter().all(|&s| s) {
                kept.add(c.id, vec![None; skip.len()]);
                continue;
            }
            work.push(LineWork {
                id: c.id,
                time: c.time,
                mainline: on_mainline(i),
                skip,
            });
        }
        let counting = source.count_lines(&work, until, &mut |id, raws, deltas| {
            kept.add(id, aligned(raws, deltas))
        });
        kept.flush();
        counting
    };
    counting?;
    Ok(on_line)
}

fn masked(
    plan: &LinePlan,
    index: &Index,
    c: &CommitMeta,
    deltas: &[Option<LineDelta>],
) -> Option<Vec<Option<LineDelta>>> {
    let changes = index.changes_of(c);
    (changes.len() == deltas.len()).then(|| {
        changes
            .iter()
            .zip(deltas)
            .map(|(change, delta)| {
                if plan.skips_file(change.file) {
                    None
                } else {
                    *delta
                }
            })
            .collect()
    })
}

/// Brings the settled lines in the Index's changes, masked when the files in `flipped` were kept or left out the other way, to `plan`'s masking: changes of files now left out lose their lines, and changes of files now kept get theirs from the store. Returns the commits whose changes it rewrote.
pub fn remask(
    index: &mut Index,
    plan: &LinePlan,
    store: Option<&LineStore>,
    flipped: &[usize],
    settled: &[u8],
) -> Vec<usize> {
    if flipped.is_empty() {
        return Vec::new();
    }
    let mut flips = vec![false; index.paths.len()];
    for &f in flipped {
        if let Some(slot) = flips.get_mut(f) {
            *slot = true;
        }
    }
    let flips_file = |file: FileId| flips.get(file.idx()).copied().unwrap_or(false);
    let mut rewritten = Vec::new();
    let mut wanted = std::collections::HashSet::new();
    for i in 0..index.commits.len() {
        let Some(c) = index.commits.get(i).copied() else {
            continue;
        };
        if settled.get(i).copied().unwrap_or(0) == 0 || plan.skips_commit(i, &c) {
            continue;
        }
        let Some(slots) = index.changes.get(c.changes()) else {
            continue;
        };
        let mut cleared = false;
        let mut restore = false;
        for change in slots.iter().filter(|ch| flips_file(ch.file)) {
            if plan.skips_file(change.file) {
                cleared |= change.lines().is_some();
            } else {
                restore = true;
            }
        }
        if cleared {
            if let Some(slots) = index.changes.get_mut(c.changes()) {
                for slot in slots.iter_mut().filter(|ch| flips_file(ch.file)) {
                    if plan.skips_file(slot.file) {
                        slot.set_lines(None);
                    }
                }
            }
            rewritten.push(i);
        }
        if restore {
            wanted.insert(c.id);
        }
    }
    let known = match (store, wanted.is_empty()) {
        (Some(store), false) => store.read_some(&wanted),
        _ => Counted::default(),
    };
    for i in 0..index.commits.len() {
        let Some(c) = index.commits.get(i).copied() else {
            continue;
        };
        let Some(deltas) = known.get(&c.id) else {
            continue;
        };
        let Some(slots) = index.changes.get_mut(c.changes()) else {
            continue;
        };
        if slots.len() != deltas.len() {
            continue;
        }
        for (slot, delta) in slots.iter_mut().zip(deltas) {
            if flips_file(slot.file) && !plan.skips_file(slot.file) {
                slot.set_lines(*delta);
            }
        }
        rewritten.push(i);
    }
    rewritten.sort_unstable();
    rewritten.dedup();
    rewritten
}

/// Counts the lines of the commits the kept columns do not hold settled, as `line_pass` does, writing them into the Index's changes and marking them settled there; every other commit's lines are already in the Index. Returns the pass and the commits it settled, for the columns to keep.
pub fn line_pass_kept<S: RepoSource>(
    source: &S,
    index: &mut Index,
    plan: &LinePlan,
    store: Option<&LineStore>,
    settled: &mut [u8],
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(LinePass, Vec<usize>), S::Error> {
    let span = tracing::info_span!(
        "line_pass",
        commits = Empty,
        mainline = Empty,
        counted = Empty,
        left = Empty,
        kept = true
    );
    let _entered = span.enter();
    let until = plan.budget.and_then(|b| Instant::now().checked_add(b));
    let open: Vec<usize> = index
        .commits
        .iter()
        .enumerate()
        .filter(|(i, c)| !plan.skips_commit(*i, c) && settled.get(*i).copied().unwrap_or(0) == 0)
        .map(|(i, _)| i)
        .collect();
    let wanted: std::collections::HashSet<Oid> = open
        .iter()
        .filter_map(|&i| index.commits.get(i).map(|c| c.id))
        .collect();
    let mut known = store.map(|s| s.read_some(&wanted)).unwrap_or_default();
    let todo: Vec<usize> = open
        .iter()
        .copied()
        .filter(|&i| {
            index
                .commits
                .get(i)
                .is_some_and(|c| !known.contains_key(&c.id))
        })
        .collect();
    span.record("commits", todo.len());
    let mainline_count = count_into(
        source, index, plan, store, &mut known, todo, until, progress,
    )?;
    span.record("mainline", mainline_count);

    let mut newly = Vec::new();
    for &i in &open {
        let Some(c) = index.commits.get(i).copied() else {
            continue;
        };
        let Some(lines) = known.get(&c.id).and_then(|d| masked(plan, index, &c, d)) else {
            continue;
        };
        if let Some(slots) = index.changes.get_mut(c.changes()) {
            for (slot, delta) in slots.iter_mut().zip(lines) {
                slot.set_lines(delta);
            }
        }
        if let Some(s) = settled.get_mut(i) {
            *s = 1;
        }
        newly.push(i);
    }
    let mut marks = vec![true; index.commits.len()];
    let (mut counted, mut left) = (0u64, 0u64);
    for (i, c) in index.commits.iter().enumerate() {
        if plan.skips_commit(i, c) {
            continue;
        }
        if settled.get(i).copied().unwrap_or(0) == 0 {
            left += 1;
            if let Some(m) = marks.get_mut(i) {
                *m = false;
            }
        } else {
            counted += 1;
        }
    }
    span.record("counted", counted);
    span.record("left", left);
    Ok((
        LinePass {
            lines: Vec::new(),
            ignored: source.blame_ignore_revs()?,
            counted,
            left,
            settled: marks,
        },
        newly,
    ))
}

fn order(todo: &mut [usize], mainline: &[u8]) {
    todo.sort_unstable_by_key(|&i| {
        let on_mainline = mainline.get(i).is_some_and(|b| b & REACHABLE != 0);
        (!on_mainline, Reverse(i))
    });
}

struct Kept<'a> {
    store: Option<&'a LineStore>,
    known: &'a mut Counted,
    fresh: Vec<(Oid, Vec<Option<LineDelta>>)>,
    done: u64,
    total: u64,
    progress: &'a mut dyn FnMut(u64, u64),
}

impl Kept<'_> {
    fn add(&mut self, id: Oid, deltas: Vec<Option<LineDelta>>) {
        self.fresh.push((id, deltas));
        if self.fresh.len() >= FLUSH {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.fresh.is_empty() {
            return;
        }
        if let Some(store) = self.store {
            let _ = store.append(&self.fresh);
        }
        self.done += self.fresh.len() as u64;
        self.known.extend(self.fresh.drain(..));
        (self.progress)(self.done, self.total);
    }
}

fn aligned(raws: &[RawChange<'_>], deltas: &[Option<LineDelta>]) -> Vec<Option<LineDelta>> {
    pair_exact_renames(raws)
        .into_iter()
        .map(|r| match r {
            Resolved::Rename { .. } => Some(LineDelta {
                added: 0,
                removed: 0,
            }),
            Resolved::Plain { raw, .. } => deltas.get(raw).copied().flatten(),
        })
        .collect()
}

pub fn ignore_rev_names(text: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(text)
        .lines()
        .filter_map(|l| {
            let l = l.split('#').next().unwrap_or("").trim();
            (l.len() >= 4 && l.len() <= 40 && l.bytes().all(|b| b.is_ascii_hexdigit()))
                .then(|| l.to_ascii_lowercase())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mainline::FIRST_PARENT;

    #[test]
    fn the_mainline_comes_first_and_each_part_newest_first() {
        let mut todo = vec![0, 1, 2, 3, 4];
        let bits = [REACHABLE | FIRST_PARENT, 0, REACHABLE, 0, REACHABLE];
        order(&mut todo, &bits);
        assert_eq!(todo, vec![4, 2, 0, 3, 1]);
    }

    #[test]
    fn without_a_mainline_everything_is_newest_first() {
        let mut todo = vec![0, 2, 1];
        order(&mut todo, &[]);
        assert_eq!(todo, vec![2, 1, 0]);
    }
}
