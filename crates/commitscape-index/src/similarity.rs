use std::collections::HashMap;
use std::rc::Rc;

use commitscape_core::Oid;

const MAX_SCORE: u64 = 60_000;
const RENAME_SCORE: u64 = 30_000;
const BASENAME_SCORE: u64 = RENAME_SCORE + (MAX_SCORE - RENAME_SCORE) / 2;
const HASHBASE: u32 = 107_927;
const FIRST_FEW_BYTES: usize = 8_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spans {
    size: u64,
    counts: Vec<(u32, u32)>,
}

/// Cuts a file into the chunks git's rename detection compares: lines, or 64 bytes where a line is longer.
pub fn spans(data: &[u8]) -> Spans {
    let text = !data.iter().take(FIRST_FEW_BYTES).any(|&b| b == 0);
    let mut counts: HashMap<u32, u32> = HashMap::new();
    let (mut accum1, mut accum2, mut n) = (0u32, 0u32, 0u32);
    let mut bytes = data.iter().copied().peekable();
    while let Some(c) = bytes.next() {
        if text && c == b'\r' && bytes.peek() == Some(&b'\n') {
            continue;
        }
        let old = accum1;
        accum1 = (accum1 << 7) ^ (accum2 >> 25);
        accum2 = (accum2 << 7) ^ (old >> 25);
        accum1 = accum1.wrapping_add(u32::from(c));
        n += 1;
        if n < 64 && c != b'\n' {
            continue;
        }
        *counts.entry(hash(accum1, accum2)).or_default() += n;
        n = 0;
        accum1 = 0;
        accum2 = 0;
    }
    if n > 0 {
        *counts.entry(hash(accum1, accum2)).or_default() += n;
    }
    let mut counts: Vec<(u32, u32)> = counts.into_iter().collect();
    counts.sort_unstable();
    Spans {
        size: data.len() as u64,
        counts,
    }
}

fn hash(accum1: u32, accum2: u32) -> u32 {
    accum1.wrapping_add(accum2.wrapping_mul(0x61)) % HASHBASE
}

fn sizes_allow(src: u64, dst: u64, minimum: u64) -> bool {
    let max = src.max(dst);
    let delta = max - src.min(dst);
    max * (MAX_SCORE - minimum) >= delta * MAX_SCORE
}

fn score(src: &Spans, dst: &Spans, minimum: u64) -> u64 {
    if !sizes_allow(src.size, dst.size, minimum) || dst.size == 0 {
        return 0;
    }
    let mut copied = 0u64;
    let mut d = dst.counts.iter().peekable();
    for &(hash, count) in &src.counts {
        while d.peek().is_some_and(|&&(h, _)| h < hash) {
            d.next();
        }
        if let Some(&&(h, other)) = d.peek() {
            if h == hash {
                copied += u64::from(count.min(other));
                d.next();
            }
        }
    }
    copied * MAX_SCORE / src.size.max(dst.size)
}

fn basename(path: &[u8]) -> &[u8] {
    path.rsplit(|&b| b == b'/').next().unwrap_or(path)
}

/// Picks the deleted file git's rename detection would say `target` came from: the same contents first, then the one deleted file with its name if 75% similar, then the most similar of at least 50%.
pub fn rename_source<E>(
    target: (&[u8], Oid, &[u8]),
    deleted: &[(Vec<u8>, Oid)],
    spans_of: &mut dyn FnMut(usize) -> Result<Rc<Spans>, E>,
) -> Result<Option<usize>, E> {
    let (path, blob, data) = target;
    let name = basename(path);
    let same_name = |i: usize| deleted.get(i).is_some_and(|(p, _)| basename(p) == name);
    let exact: Vec<usize> = (0..deleted.len())
        .filter(|&i| deleted.get(i).is_some_and(|(_, b)| *b == blob))
        .collect();
    if let Some(&first) = exact.first() {
        return Ok(Some(
            exact
                .iter()
                .copied()
                .find(|&i| same_name(i))
                .unwrap_or(first),
        ));
    }
    if deleted.is_empty() {
        return Ok(None);
    }
    let ours = spans(data);

    let named: Vec<usize> = (0..deleted.len()).filter(|&i| same_name(i)).collect();
    if let [only] = named.as_slice() {
        if score(&*spans_of(*only)?, &ours, BASENAME_SCORE) >= BASENAME_SCORE {
            return Ok(Some(*only));
        }
    }

    let mut best: Option<(u64, bool, usize)> = None;
    for i in 0..deleted.len() {
        let s = score(&*spans_of(i)?, &ours, RENAME_SCORE);
        if s < RENAME_SCORE {
            continue;
        }
        let candidate = (s, same_name(i), i);
        best = match best {
            Some(b) if (b.0, b.1) >= (candidate.0, candidate.1) => Some(b),
            _ => Some(candidate),
        };
    }
    Ok(best.map(|b| b.2))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_files_score_the_maximum_and_crlf_counts_as_lf() {
        let a = spans(b"one\ntwo\nthree\n");
        assert_eq!(score(&a, &a, RENAME_SCORE), MAX_SCORE);
        let crlf = spans(b"one\r\ntwo\r\nthree\r\n");
        assert_eq!(crlf.counts, a.counts);
    }

    #[test]
    fn the_score_is_the_share_of_the_larger_file_copied() {
        let src = spans(b"aaaa\nbbbb\ncccc\ndddd\n");
        let dst = spans(b"aaaa\nbbbb\ncccc\neeee\n");
        assert_eq!(score(&src, &dst, RENAME_SCORE), 45_000);
        let small = spans(b"aaaa\n");
        assert_eq!(score(&src, &small, RENAME_SCORE), 0);
    }

    fn oid(n: u8) -> Oid {
        Oid([n; 20])
    }

    fn pick(target: (&str, u8, &str), deleted: &[(&str, u8, &str)]) -> Option<usize> {
        let list: Vec<(Vec<u8>, Oid)> = deleted
            .iter()
            .map(|(p, b, _)| (p.as_bytes().to_vec(), oid(*b)))
            .collect();
        let data: Vec<&[u8]> = deleted.iter().map(|(_, _, d)| d.as_bytes()).collect();
        rename_source::<()>(
            (target.0.as_bytes(), oid(target.1), target.2.as_bytes()),
            &list,
            &mut |i| Ok(Rc::new(spans(data.get(i).copied().unwrap_or_default()))),
        )
        .unwrap()
    }

    #[test]
    fn renames_prefer_the_same_contents_then_the_same_name_then_the_most_similar() {
        let body = "aaaa\nbbbb\ncccc\ndddd\n";
        let edited = "aaaa\nbbbb\ncccc\neeee\n";
        assert_eq!(
            pick(
                ("new/x.rs", 1, body),
                &[("old/y.rs", 2, body), ("old/x.rs", 1, body)]
            ),
            Some(1)
        );
        assert_eq!(
            pick(
                ("new/x.rs", 1, edited),
                &[("old/y.rs", 2, body), ("old/x.rs", 3, body)]
            ),
            Some(1)
        );
        assert_eq!(
            pick(
                ("new/z.rs", 1, edited),
                &[("old/y.rs", 2, "zzzz\n"), ("old/w.rs", 3, body)]
            ),
            Some(1)
        );
        assert_eq!(
            pick(("new/z.rs", 1, edited), &[("old/y.rs", 2, "zzzz\nyyyy\n")]),
            None
        );
    }
}
