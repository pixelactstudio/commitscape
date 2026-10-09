#![allow(clippy::expect_used)]

use commitscape_core::{LineDelta, Oid};
use commitscape_index::source::RawChangeKind::{Added, Deleted, Modified};
use commitscape_index::{index_from_scratch, line_pass, CacheOptions, LineStore, ScriptedRepo};

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const DAY: i64 = 86_400;

fn blob(n: u8) -> Oid {
    Oid([n; 20])
}

fn d(added: u32, removed: u32) -> Option<LineDelta> {
    Some(LineDelta { added, removed })
}

fn repo() -> ScriptedRepo {
    ScriptedRepo::new()
        .commit(0, ALICE, &[(b"a.rs", Added, blob(1))])
        .commit(
            DAY,
            ALICE,
            &[(b"a.rs", Modified, blob(2)), (b"b.rs", Added, blob(3))],
        )
        .commit(
            2 * DAY,
            ALICE,
            &[
                (b"a.rs", Deleted, blob(2)),
                (b"c.rs", Added, blob(2)),
                (b"b.rs", Deleted, blob(3)),
            ],
        )
        .blob(blob(1), "1\n2\n3\n")
        .blob(blob(2), "1\ntwo\n3\n4\n")
}

#[test]
fn counts_line_up_with_the_changes_and_are_counted_once() {
    let repo = repo();
    let idx = index_from_scratch(&repo).expect("indexing");
    let dir = tempfile::tempdir().expect("temp dir");
    let store = LineStore::for_repo(
        &CacheOptions {
            root: Some(dir.path().to_path_buf()),
        },
        &idx.repo,
    )
    .expect("a store");

    let mut asked = Vec::new();
    let first = line_pass(&repo, &idx, Some(&store), &mut |done, total| {
        asked.push((done, total))
    })
    .expect("counting");
    let by_commit: Vec<Vec<Option<LineDelta>>> = idx
        .commits
        .iter()
        .map(|c| {
            let start = c.changes_start as usize;
            first
                .lines
                .get(start..start + c.changes_len as usize)
                .expect("in range")
                .to_vec()
        })
        .collect();
    assert_eq!(
        by_commit,
        vec![vec![d(3, 0)], vec![d(2, 1), None], vec![d(0, 0), None]]
    );
    assert_eq!(asked.last(), Some(&(3, 3)));

    let mut again = Vec::new();
    let second = line_pass(&repo, &idx, Some(&store), &mut |done, total| {
        again.push((done, total))
    })
    .expect("counting");
    assert_eq!(again, vec![(0, 0)], "everything was kept");
    assert_eq!(second, first);
}

#[test]
fn a_store_cut_short_keeps_what_it_had() {
    let repo = repo();
    let idx = index_from_scratch(&repo).expect("indexing");
    let dir = tempfile::tempdir().expect("temp dir");
    let options = CacheOptions {
        root: Some(dir.path().to_path_buf()),
    };
    let store = LineStore::for_repo(&options, &idx.repo).expect("a store");
    let first = line_pass(&repo, &idx, Some(&store), &mut |_, _| {}).expect("counting");

    let file = dir.path().join(idx.repo.cache_key()).join("lines");
    let bytes = std::fs::read(&file).expect("the store was written");
    let cut = bytes.get(..bytes.len() - 3).expect("a record");
    std::fs::write(&file, cut).expect("cutting it short");

    let mut asked = Vec::new();
    let resumed = line_pass(&repo, &idx, Some(&store), &mut |done, total| {
        asked.push((done, total))
    })
    .expect("counting");
    assert_eq!(asked.last(), Some(&(1, 1)), "only the commit cut short");
    assert_eq!(resumed, first);
}

fn whole_file_delta(before: &[u8], after: &[u8]) -> (u32, u32) {
    let input = imara_diff::InternedInput::new(before, after);
    let diff = imara_diff::Diff::compute(imara_diff::Algorithm::Myers, &input);
    (diff.count_additions(), diff.count_removals())
}

fn text(seed: &mut u64, lines: usize) -> Vec<u8> {
    let mut out = Vec::new();
    for _ in 0..lines {
        *seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let pick = (*seed >> 33) % 7;
        out.extend_from_slice(match pick {
            0 => b"{\n".as_slice(),
            1 => b"}\n",
            2 => b"\n",
            3 => b"let a = 1;\n",
            4 => b"let b = 2;",
            5 => b"x",
            _ => b"return a + b;\n",
        });
    }
    out
}

fn edited(seed: &mut u64, from: &[u8]) -> Vec<u8> {
    let mut out = from.to_vec();
    for _ in 0..3 {
        *seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let at = usize::try_from(*seed >> 33).unwrap_or(0) % (out.len() + 1);
        let inserted = text(seed, 2);
        let cut = (at + usize::try_from(*seed >> 60).unwrap_or(0)).min(out.len());
        out.splice(at..cut, inserted);
    }
    out
}

#[test]
fn trimming_the_shared_lines_counts_what_the_whole_files_count() {
    let mut seed = 7u64;
    let mut cases = vec![
        (b"a\nb".to_vec(), b"a\nb\nc\n".to_vec()),
        (b"a\n".to_vec(), b"a\nb\n".to_vec()),
        (b"x\na\n".to_vec(), b"a\n".to_vec()),
        (b"c\nd".to_vec(), b"b\nc\nd".to_vec()),
        (b"same\n".to_vec(), b"same\n".to_vec()),
        (b"a\nb\n".to_vec(), b"a\nb".to_vec()),
    ];
    for n in 0..2_000 {
        let before = text(&mut seed, 1 + n % 40);
        let after = edited(&mut seed, &before);
        cases.push((before, after));
    }
    for (before, after) in cases {
        let got = commitscape_index::lines::line_delta(&before, &after).expect("text");
        let want = whole_file_delta(&before, &after);
        assert_eq!((got.added, got.removed), want, "{before:?} -> {after:?}");
    }
}
