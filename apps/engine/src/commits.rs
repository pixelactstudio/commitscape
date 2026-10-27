use std::collections::HashSet;

use commitscape_core::{AuthorId, CommitMeta, Index, Oid};
use serde::{Deserialize, Serialize};

use crate::loaded::LoadedPack;
use crate::view::{kind_code, DAY};

const UNKNOWN_PERSON: f64 = 4_294_967_295.0;
const COMMIT_PAGE: usize = 50;
const COMMIT_PAGE_MAX: f64 = 200.0;
const HOUR: i64 = 3600;
const SAFE: i128 = (1 << 53) - 1;

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct CommitQuery {
    #[serde(default)]
    pub person: Option<f64>,
    #[serde(default)]
    pub kind: Option<f64>,
    #[serde(default)]
    pub from: Option<f64>,
    #[serde(default)]
    pub to: Option<f64>,
    #[serde(default)]
    pub since: Option<f64>,
    #[serde(default)]
    pub until: Option<f64>,
    #[serde(default)]
    pub weekday: Option<f64>,
    #[serde(default)]
    pub hour: Option<f64>,
    #[serde(default)]
    pub limit: Option<f64>,
    #[serde(default)]
    pub merges: Option<f64>,
    #[serde(default)]
    pub q: Option<String>,
}

const WORDS_MAX: usize = 12;

/// The words of a search, as the Site's `wordsOf` splits them: lowercased, split at whitespace, at most twelve.
pub fn words_of(q: Option<&str>) -> Vec<String> {
    q.unwrap_or_default()
        .to_lowercase()
        .split_whitespace()
        .take(WORDS_MAX)
        .map(str::to_string)
        .collect()
}

fn contains(text: &str, word: &str) -> bool {
    if text.is_ascii() && word.is_ascii() {
        let (t, w) = (text.as_bytes(), word.as_bytes());
        return w.is_empty() || t.windows(w.len()).any(|x| x.eq_ignore_ascii_case(w));
    }
    text.to_lowercase().contains(word)
}

struct Words {
    words: Vec<String>,
    people: Vec<HashSet<AuthorId>>,
    unknown: Vec<bool>,
}

impl Words {
    fn of(held: &LoadedPack, q: Option<&str>) -> Words {
        let words = words_of(q);
        let index = &held.pack.index;
        let named: Vec<(AuthorId, String)> = index
            .authors
            .iter()
            .map(|(id, a)| {
                let login = held.person(id).login.unwrap_or_default();
                (id, format!("{} {login}", a.name).to_lowercase())
            })
            .collect();
        Words {
            people: words
                .iter()
                .map(|w| {
                    named
                        .iter()
                        .filter(|(_, n)| n.contains(w.as_str()))
                        .map(|(id, _)| *id)
                        .collect()
                })
                .collect(),
            unknown: words
                .iter()
                .map(|w| "someone unknown ".contains(w.as_str()))
                .collect(),
            words,
        }
    }

    fn keep(&self, index: &Index, c: &CommitMeta) -> bool {
        if self.words.is_empty() {
            return true;
        }
        let subject = index
            .subjects
            .get(c.subject())
            .map(String::from_utf8_lossy)
            .unwrap_or_default();
        let author = index.author_of(c);
        self.words.iter().enumerate().all(|(i, w)| {
            contains(&subject, w)
                || match author {
                    Some(a) => self.people.get(i).is_some_and(|p| p.contains(&a)),
                    None => self.unknown.get(i).copied().unwrap_or(false),
                }
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Under {
    pub shas: Vec<String>,
    pub total: usize,
    pub next: Option<String>,
}

fn keeps(index: &Index, q: &CommitQuery, c: &CommitMeta) -> bool {
    let time = c.time + i64::from(c.author_delta);
    let local = time + i64::from(c.offset_minutes) * 60;
    let day = local.div_euclid(DAY);
    let person = index.author_of(c).map_or(-1.0, |p| f64::from(p.0));
    let tests = [
        q.person.is_none_or(|want| {
            if want == UNKNOWN_PERSON {
                person < 0.0
            } else {
                person == want
            }
        }),
        q.kind.is_none_or(|k| f64::from(kind_code(c)) == k),
        q.from.is_none_or(|f| time as f64 >= f),
        q.to.is_none_or(|t| time as f64 <= t),
        q.since.is_none_or(|s| day as f64 >= s),
        q.until.is_none_or(|u| day as f64 <= u),
        q.weekday.is_none_or(|w| ((day + 3) % 7) as f64 == w),
        q.hour
            .is_none_or(|h| (local % DAY).div_euclid(HOUR) as f64 == h),
        q.merges.is_none_or(|m| m != 0.0 || !c.is_merge()),
    ];
    tests.iter().all(|&t| t)
}

/// How many commits a page holds when `limit` asks for some: 50 unless a number, then 1 to 200.
pub fn page_limit(limit: Option<f64>) -> usize {
    match limit {
        Some(l) if l.is_finite() => l.floor().clamp(1.0, COMMIT_PAGE_MAX) as usize,
        _ => COMMIT_PAGE,
    }
}

fn base36(n: i64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut left = n.unsigned_abs();
    let mut out = Vec::new();
    loop {
        out.push(DIGITS.get((left % 36) as usize).copied().unwrap_or(b'0'));
        left /= 36;
        if left == 0 {
            break;
        }
    }
    if n < 0 {
        out.push(b'-');
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// The cursor of the page after a commit: its time in base 36 and its sha.
pub fn after_commit(at: i64, sha: &str) -> String {
    format!("{}.{sha}", base36(at))
}

/// The commit a cursor from `after_commit` names, or None when it is not one.
pub fn after_of(cursor: &str) -> Option<(i64, String)> {
    let (at, sha) = cursor.split_once('.')?;
    let digits = at.strip_prefix('-').unwrap_or(at);
    let at_ok = (1..=12).contains(&digits.len())
        && digits
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'z'));
    let sha_ok = (40..=64).contains(&sha.len())
        && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !at_ok || !sha_ok || sha.len() % 2 != 0 {
        return None;
    }
    let mut n: i128 = 0;
    for b in digits.bytes() {
        let d = char::from(b).to_digit(36)?;
        n = n * 36 + i128::from(d);
    }
    if at.starts_with('-') {
        n = -n;
    }
    (n.abs() <= SAFE).then(|| (n as i64, sha.to_string()))
}

fn unbase64url(text: &str) -> Option<Vec<u8>> {
    let body = text.trim_end_matches('=');
    if body.contains('=') || body.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    let mut bits = 0u32;
    let mut held = 0u32;
    for b in body.bytes() {
        let v = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(v);
        held += 6;
        if held >= 8 {
            held -= 8;
            out.push((bits >> held) as u8);
            bits &= (1 << held) - 1;
        }
    }
    Some(out)
}

/// The position a cursor of seq numbers stands for, or None when there is none or it is not one.
pub fn seq_of(cursor: Option<&str>) -> Option<usize> {
    let cursor = cursor.filter(|c| !c.is_empty())?;
    let bytes = unbase64url(cursor)?;
    let text = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes);
    let digits = (1..=10).contains(&text.len()) && text.iter().all(u8::is_ascii_digit);
    if !digits {
        return None;
    }
    std::str::from_utf8(text).ok()?.parse().ok()
}

fn oid_of(sha: &str) -> Option<Oid> {
    let hex = sha.len() == 40 && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if hex {
        Oid::from_hex(sha)
    } else {
        None
    }
}

/// One page of the commits under a path, as the Site's `pageUnder` picked them before it read their rows: the commits that match the query and, when given, are among the commits whose words matched (`said`), newest first, from the cursor on, with how many matched and the cursor of the next page.
pub fn under(
    held: &LoadedPack,
    path: &str,
    query: &CommitQuery,
    cursor: Option<&str>,
    said: Option<&[String]>,
) -> Under {
    let index = &held.pack.index;
    let said: Option<HashSet<Oid>> = said.map(|s| s.iter().filter_map(|x| oid_of(x)).collect());
    let words = Words::of(
        held,
        if said.is_some() {
            None
        } else {
            query.q.as_deref()
        },
    );
    let matched: Vec<&CommitMeta> = held
        .under(path)
        .iter()
        .filter_map(|&c| index.commits.get(c as usize))
        .filter(|c| keeps(index, query, c) && words.keep(index, c))
        .filter(|c| said.as_ref().is_none_or(|s| s.contains(&c.id)))
        .collect();
    paged(matched, query, cursor)
}

/// One page of every commit that matches the query, words and all, newest first, from the cursor on, with how many matched and the cursor of the next page, as the Site's Commit List finds them in Postgres.
pub fn search(held: &LoadedPack, query: &CommitQuery, cursor: Option<&str>) -> Under {
    let index = &held.pack.index;
    let words = Words::of(held, query.q.as_deref());
    let matched: Vec<&CommitMeta> = index
        .commits
        .iter()
        .rev()
        .filter(|c| keeps(index, query, c) && words.keep(index, c))
        .collect();
    paged(matched, query, cursor)
}

fn paged(matched: Vec<&CommitMeta>, query: &CommitQuery, cursor: Option<&str>) -> Under {
    let limit = page_limit(query.limit);
    let start = match cursor.and_then(after_of) {
        Some((at, sha)) => matched.partition_point(|c| {
            !(c.time < at || (c.time == at && c.id.to_hex().as_str() < sha.as_str()))
        }),
        None => seq_of(cursor).unwrap_or(0),
    };
    let shown: Vec<&CommitMeta> = matched.iter().skip(start).take(limit).copied().collect();
    let next = match shown.last() {
        Some(last) if start.saturating_add(limit) < matched.len() => {
            Some(after_commit(last.time, &last.id.to_hex()))
        }
        _ => None,
    };
    Under {
        shas: shown.iter().map(|c| c.id.to_hex()).collect(),
        total: matched.len(),
        next,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursors_read_as_the_site_writes_them() {
        let sha = "ab".repeat(20);
        assert_eq!(
            after_of(&after_commit(1_700_000_000, &sha)),
            Some((1_700_000_000, sha.clone()))
        );
        assert_eq!(after_of(&after_commit(-75, &sha)), Some((-75, sha.clone())));
        assert_eq!(after_commit(-75, "x"), "-23.x");
        assert_eq!(after_of(&format!("zzzzzzzzzzzz.{sha}")), None);
        assert_eq!(after_of(&format!("1.{}", "a".repeat(41))), None);
        assert_eq!(after_of("1.xyz"), None);
        assert_eq!(seq_of(Some("MTI")), Some(12));
        assert_eq!(seq_of(Some("MTI=")), Some(12));
        assert_eq!(seq_of(Some("77u_MTI")), Some(12));
        assert_eq!(seq_of(Some("77u/MTI")), None);
        assert_eq!(seq_of(Some("77u_")), None);
        assert_eq!(seq_of(Some("eA")), None);
        assert_eq!(seq_of(Some("")), None);
        assert_eq!(seq_of(None), None);
    }

    #[test]
    fn a_page_holds_one_to_two_hundred() {
        assert_eq!(page_limit(None), 50);
        assert_eq!(page_limit(Some(f64::NAN)), 50);
        assert_eq!(page_limit(Some(0.0)), 1);
        assert_eq!(page_limit(Some(7.9)), 7);
        assert_eq!(page_limit(Some(1000.0)), 200);
    }
}
