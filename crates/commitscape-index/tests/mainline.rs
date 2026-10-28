#![allow(clippy::expect_used, clippy::indexing_slicing)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use commitscape_core::{Index, Oid};
use commitscape_index::mainline::mainline_since;
use commitscape_index::mainline::{FIRST_PARENT, REACHABLE};
use commitscape_index::{index_from_scratch, mainline, GixRepo, ScriptedRepo};

const A: (&str, &str) = ("Ada", "ada@example.com");

fn marks(repo: &ScriptedRepo, n: u32) -> HashMap<u32, (u8, Option<i64>)> {
    let index = index_from_scratch(repo).expect("indexing");
    let m = mainline(repo, &index).expect("working out the mainline");
    (1..=n)
        .map(|k| {
            let at = index
                .commits
                .iter()
                .position(|c| c.id == repo.commit_id(k))
                .expect("indexed");
            (k, (m.bits[at], m.arrival[at]))
        })
        .collect()
}

#[test]
fn a_merge_brings_in_what_its_other_parents_reach_at_the_merges_time() {
    let repo = ScriptedRepo::new()
        .commit(10, A, &[])
        .commit(20, A, &[])
        .commit(40, A, &[])
        .at(1)
        .commit(30, A, &[])
        .merge(50, A, 3, &[]);
    let m = marks(&repo, 5);
    let line = REACHABLE | FIRST_PARENT;
    assert_eq!(m[&5], (line, Some(50)), "m3");
    assert_eq!(m[&4], (line, Some(30)), "m2");
    assert_eq!(m[&1], (line, Some(10)), "m1");
    assert_eq!(m[&3], (REACHABLE, Some(50)), "f2");
    assert_eq!(m[&2], (REACHABLE, Some(50)), "f1");
}

#[test]
fn a_branch_merged_twice_arrives_with_the_first_merge_and_its_later_work_with_the_second() {
    let repo = ScriptedRepo::new()
        .commit(10, A, &[])
        .commit(30, A, &[])
        .commit(50, A, &[])
        .commit(80, A, &[])
        .at(1)
        .commit(40, A, &[])
        .merge(60, A, 3, &[])
        .commit(70, A, &[])
        .merge(90, A, 4, &[]);
    let m = marks(&repo, 8);
    assert_eq!(
        [m[&2], m[&3], m[&4]],
        [
            (REACHABLE, Some(60)),
            (REACHABLE, Some(60)),
            (REACHABLE, Some(90))
        ]
    );
    assert_eq!(m[&6], (REACHABLE | FIRST_PARENT, Some(60)));
}

#[test]
fn work_only_another_branch_holds_never_reached_the_default_branch() {
    let repo = ScriptedRepo::new()
        .commit(0, A, &[])
        .commit(1, A, &[])
        .at(1)
        .commit(2, A, &[])
        .merge(3, A, 2, &[])
        .commit(4, A, &[])
        .at(4);
    let m = marks(&repo, 5);
    let line = REACHABLE | FIRST_PARENT;
    assert_eq!(m[&1], (line, Some(0)));
    assert_eq!(m[&2], (REACHABLE, Some(3)));
    assert_eq!(m[&3], (line, Some(2)));
    assert_eq!(m[&4], (line, Some(3)));
    assert_eq!(m[&5], (0, None));
}

fn fixture(name: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("fixtures").join(name))
        .expect("workspace root");
    assert!(
        root.exists(),
        "fixture {name} is missing — run `cargo xtask fixtures --force`"
    );
    root
}

fn mainline_of(rev_list: &str, head: &str) -> HashMap<String, (u8, i64)> {
    let rows: Vec<Vec<&str>> = rev_list
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.split(' ').collect())
        .collect();
    let n = rows.len();
    let at: HashMap<&str, usize> = rows.iter().enumerate().map(|(i, r)| (r[1], i)).collect();
    let time: Vec<i64> = rows.iter().map(|r| r[0].parse().unwrap_or(0)).collect();
    let parents: Vec<Vec<usize>> = rows
        .iter()
        .map(|r| r[2..].iter().filter_map(|p| at.get(p).copied()).collect())
        .collect();
    let first_parent = |i: usize| rows[i].get(2).and_then(|p| at.get(p).copied());
    let mut on_line = vec![false; n];
    let mut line = Vec::new();
    let mut i = at.get(head).copied();
    while let Some(k) = i {
        if on_line[k] {
            break;
        }
        on_line[k] = true;
        line.push(k);
        i = first_parent(k);
    }
    let mut seen = vec![false; n];
    let mut arrival = vec![0i64; n];
    let mut stack: Vec<usize> = Vec::new();
    for &f in line.iter().rev() {
        let when = time[f];
        seen[f] = true;
        arrival[f] = when;
        stack.extend(parents[f].iter().skip(1));
        while let Some(c) = stack.pop() {
            if seen[c] {
                continue;
            }
            seen[c] = true;
            arrival[c] = when;
            let unseen: Vec<usize> = parents[c].iter().copied().filter(|&p| !seen[p]).collect();
            stack.extend(unseen);
        }
    }
    rows.iter()
        .enumerate()
        .map(|(i, r)| {
            let bits = REACHABLE | if on_line[i] { FIRST_PARENT } else { 0 };
            (r[1].to_string(), (bits, arrival[i]))
        })
        .collect()
}

fn git(dir: &PathBuf, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("running git");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).expect("UTF-8")
}

fn check(name: &str) -> usize {
    let dir = fixture(name);
    let repo = GixRepo::open(&dir).expect("opening fixture");
    let index: Index = index_from_scratch(&repo).expect("indexing fixture");
    let found = mainline(&repo, &index).expect("working out the mainline");
    let head = git(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let expected = mainline_of(
        &git(&dir, &["rev-list", "--timestamp", "--parents", "HEAD"]),
        &head,
    );
    for (i, c) in index.commits.iter().enumerate() {
        let want = expected
            .get(&Oid::to_hex(c.id))
            .map_or((0, None), |&(bits, arrival)| (bits, Some(arrival)));
        assert_eq!(
            (found.bits[i], found.arrival[i]),
            want,
            "{name}: commit {}",
            c.id.to_hex()
        );
    }
    found.bits.iter().filter(|b| *b & REACHABLE != 0).count()
}

#[test]
fn the_mainline_of_every_fixture_is_what_the_builder_worked_out_from_git() {
    let mut reachable = 0;
    for name in [
        "linear",
        "coupling",
        "ownership",
        "renames",
        "bulk",
        "merges",
        "conflict",
        "rhythm",
        "lines",
        "survival",
        "detached",
        "shallow",
        "bare.git",
    ] {
        reachable += check(name);
    }
    assert!(reachable > 50);
}

fn moved(build: fn() -> ScriptedRepo, before: u32, after: u32) -> Option<Vec<bool>> {
    let now = build().at(after);
    let index = index_from_scratch(&build()).expect("indexing");
    let then = mainline(&build().at(before), &index).expect("the earlier mainline");
    let (found, moved) =
        mainline_since(&now, &index, Some(now.commit_id(before))).expect("the mainline since");
    let by_hand = mainline(&now, &index).expect("the mainline");
    assert_eq!(found, by_hand);
    let expected: Vec<bool> = (0..index.commits.len())
        .map(|i| (by_hand.bits[i], by_hand.arrival[i]) != (then.bits[i], then.arrival[i]))
        .collect();
    if let Some(m) = &moved {
        assert_eq!(m, &expected);
    }
    moved
}

fn twice_merged() -> ScriptedRepo {
    ScriptedRepo::new()
        .commit(10, A, &[])
        .commit(30, A, &[])
        .commit(50, A, &[])
        .commit(80, A, &[])
        .at(1)
        .commit(40, A, &[])
        .merge(60, A, 3, &[])
        .commit(70, A, &[])
        .merge(90, A, 4, &[])
        .commit(100, A, &[])
        .at(9)
        .commit(110, A, &[])
}

#[test]
fn the_mainline_since_an_earlier_head_names_the_commits_a_later_merge_moved_and_no_others() {
    let moved = moved(twice_merged, 6, 8).expect("the earlier head is in the history");
    assert_eq!(moved.iter().filter(|m| **m).count(), 3);
    assert_eq!(
        self::moved(twice_merged, 8, 8).expect("the same head"),
        vec![false; moved.len()]
    );
}

#[test]
fn a_head_whose_first_parent_line_changed_moves_the_commits_that_left_the_line() {
    let moved = moved(twice_merged, 3, 6).expect("the earlier head is in the history");
    assert_eq!(moved.iter().filter(|m| **m).count(), 4);
}

#[test]
fn an_earlier_head_the_history_no_longer_holds_moves_everything() {
    assert_eq!(moved(twice_merged, 10, 9), None);
}
