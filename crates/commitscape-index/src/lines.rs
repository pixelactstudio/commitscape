//! How many lines a change added and removed: the line pass (ADR-0012).
//!
//! Counted as `git diff --numstat` counts them, with the Myers algorithm
//! git uses by default, so the numbers can be checked against git. Binary
//! files, and files too large to be worth diffing, are not counted, which
//! is a different answer from zero.

use commitscape_core::LineDelta;
use imara_diff::{Algorithm, Diff, InternedInput};

/// Files larger than this, before or after, are not counted: a megabyte of
/// text is generated, and diffing it would cost more than it tells.
pub const MAX_BYTES: usize = 1 << 20;

/// Git's test for binary contents: a NUL byte in the first 8,000 bytes.
fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8_000).any(|&b| b == 0)
}

/// The lines `after` added to `before` and removed from it. An addition is
/// `before` empty, a deletion `after` empty. `None` for binary contents or
/// either side over [`MAX_BYTES`].
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
    let input = InternedInput::new(before, after);
    let diff = Diff::compute(Algorithm::Myers, &input);
    Some(LineDelta {
        added: diff.count_additions(),
        removed: diff.count_removals(),
    })
}

use std::sync::Mutex;

use commitscape_core::{Index, LinePass, Oid};

use crate::build::{pair_exact_renames, Resolved};
use crate::cache::LineStore;
use crate::source::{RawChange, RepoSource};

/// Commits counted between saves, so a long first pass can stop and pick
/// up where it left off.
const CHUNK: usize = 4_096;

/// Counts the lines of every non-merge commit in `index` that `store` has
/// not counted yet, saving as it goes, and returns every change's lines.
/// `progress` hears how many commits have been counted of how many need it.
pub fn line_pass<S: RepoSource>(
    source: &S,
    index: &Index,
    store: Option<&LineStore>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<LinePass, S::Error> {
    line_pass_where(source, index, store, &|_| true, progress)
}

/// [`line_pass`] for only the commits `wanted` keeps: one person's year,
/// say. The others keep what the store already knows of them.
pub fn line_pass_where<S: RepoSource>(
    source: &S,
    index: &Index,
    store: Option<&LineStore>,
    wanted: &dyn Fn(&commitscape_core::CommitMeta) -> bool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<LinePass, S::Error> {
    let mut known = store.map(LineStore::read).unwrap_or_default();
    let todo: Vec<Oid> = index
        .commits
        .iter()
        .filter(|c| !c.is_merge() && wanted(c) && !known.contains_key(&c.id))
        .map(|c| c.id)
        .collect();
    let total = todo.len() as u64;
    let mut done = 0u64;
    progress(done, total);
    for chunk in todo.chunks(CHUNK) {
        let found = Mutex::new(Vec::with_capacity(chunk.len()));
        source.count_lines(chunk, &|id, raws, deltas| {
            if let Ok(mut f) = found.lock() {
                f.push((id, aligned(raws, deltas)));
            }
        })?;
        let found = found.into_inner().unwrap_or_default();
        if let Some(store) = store {
            // A store that cannot be written is a slower next run.
            let _ = store.append(&found);
        }
        known.extend(found);
        done += chunk.len() as u64;
        progress(done, total);
    }

    let mut lines = vec![None; index.changes.len()];
    for c in &index.commits {
        let Some(deltas) = known.get(&c.id) else {
            continue;
        };
        let start = c.changes_start as usize;
        if let Some(slots) = lines.get_mut(start..start + c.changes_len as usize) {
            if slots.len() == deltas.len() {
                slots.copy_from_slice(deltas);
            }
        }
    }
    Ok(LinePass {
        lines,
        ignored: source.blame_ignore_revs()?,
    })
}

/// A commit's counts in the order the index records its changes: renames
/// paired as the builder pairs them, each an unchanged move of no lines.
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

/// The commit ids in a `.git-blame-ignore-revs` file: one per line, `#`
/// starting a comment.
pub fn parse_ignore_revs(text: &[u8]) -> Vec<Oid> {
    String::from_utf8_lossy(text)
        .lines()
        .filter_map(|l| {
            let l = l.split('#').next().unwrap_or("").trim();
            Oid::from_hex(l)
        })
        .collect()
}
