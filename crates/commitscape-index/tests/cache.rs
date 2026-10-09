#![allow(clippy::expect_used)]

use std::path::Path;

use commitscape_core::{ChangeKind, Index, Oid};
use commitscape_index::source::RawChangeKind::{Added, Modified};
use commitscape_index::{
    index_from_scratch, load, CacheOptions, Freshness, Loaded, Mailmap, RebuildReason, ScriptedRepo,
};

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const ALICE_WORK: (&str, &str) = ("A. Example", "alice@work.example.org");
const BOB: (&str, &str) = ("Bob Example", "bob@example.com");

const JAN_2024: i64 = 1_704_067_200;
const DAY: i64 = 86_400;

fn blob(n: u8) -> Oid {
    let mut b = [0u8; 20];
    b[0] = n;
    Oid(b)
}

fn load_with(repo: &ScriptedRepo, root: Option<&Path>) -> Loaded {
    let options = CacheOptions {
        root: root.map(Path::to_path_buf),
    };
    match load(repo, &options, &mut |_| {}) {
        Ok(l) => l,
        Err(never) => match never {},
    }
}

fn load_all(repo: &ScriptedRepo, root: &Path) -> Loaded {
    load_with(repo, Some(root))
}

type Observed = Vec<(Oid, i64, String, String, Vec<(String, ChangeKind)>)>;

fn observe(idx: &Index) -> Observed {
    idx.commits
        .iter()
        .map(|c| {
            let author = idx
                .author_of(c)
                .and_then(|a| idx.authors.get(a))
                .map(|a| a.email.to_string())
                .unwrap_or_default();
            let mut changes: Vec<(String, ChangeKind)> = idx
                .changes_of(c)
                .iter()
                .map(|ch| (idx.paths.path_lossy(ch.file), ch.kind))
                .collect();
            changes.sort_by(|a, b| a.0.cmp(&b.0));
            (c.id, c.time, author, idx.subject_of(c).to_string(), changes)
        })
        .collect()
}

fn scratch(repo: &ScriptedRepo) -> Index {
    match index_from_scratch(repo) {
        Ok(i) => i,
        Err(never) => match never {},
    }
}

fn linear() -> ScriptedRepo {
    ScriptedRepo::new()
        .commit(JAN_2024, ALICE, &[(b"a.txt", Added, blob(1))])
        .said("feat: a\n\nThe first file.")
        .commit(JAN_2024 + DAY, BOB, &[(b"a.txt", Modified, blob(2))])
        .said("fix: a, again")
        .commit(JAN_2024 + 2 * DAY, ALICE, &[(b"b.txt", Added, blob(3))])
        .said("b")
}

#[test]
fn the_first_load_builds_and_the_second_is_warm() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = linear();

    let first = load_all(&repo, dir.path());
    assert_eq!(
        first.freshness,
        Freshness::Built {
            reason: RebuildReason::NoCache
        }
    );

    let second = load_all(&repo, dir.path());
    assert_eq!(second.freshness, Freshness::Warm);
    assert_eq!(observe(&second.index), observe(&first.index));
    assert_eq!(second.index.span, first.index.span);
}

#[test]
fn each_commit_keeps_its_subject_line_through_the_cache() {
    let dir = tempfile::tempdir().expect("temp dir");
    let built = load_all(&linear(), dir.path());
    let subjects = |i: &Index| -> Vec<String> {
        i.commits
            .iter()
            .map(|c| i.subject_of(c).to_string())
            .collect()
    };
    assert_eq!(subjects(&built.index), ["feat: a", "fix: a, again", "b"]);
    let warm = load_all(&linear(), dir.path());
    assert_eq!(warm.freshness, Freshness::Warm);
    assert_eq!(subjects(&warm.index), ["feat: a", "fix: a, again", "b"]);
}

#[test]
fn new_commits_are_added_without_a_rebuild() {
    let dir = tempfile::tempdir().expect("temp dir");
    load_all(&linear(), dir.path());

    let grown = linear()
        .commit(JAN_2024 + 3 * DAY, BOB, &[(b"b.txt", Modified, blob(4))])
        .said("b, later")
        .commit(JAN_2024 + 4 * DAY, ALICE, &[(b"c.txt", Added, blob(5))])
        .said("c");
    let updated = load_all(&grown, dir.path());
    assert_eq!(updated.freshness, Freshness::Updated { added: 2 });
    assert_eq!(observe(&updated.index), observe(&scratch(&grown)));
    assert_eq!(updated.index.span.commits, 5);

    let again = load_all(&grown, dir.path());
    assert_eq!(again.freshness, Freshness::Warm, "the update was saved");
    assert_eq!(observe(&again.index), observe(&scratch(&grown)));
}

fn branched() -> ScriptedRepo {
    ScriptedRepo::new()
        .commit(JAN_2024, ALICE, &[(b"main.txt", Added, blob(1))])
        .commit(JAN_2024 + DAY, ALICE, &[(b"main.txt", Modified, blob(2))])
        .commit(JAN_2024 + 2 * DAY, BOB, &[(b"side.txt", Added, blob(3))])
        .said("side one")
        .commit(JAN_2024 + 3 * DAY, BOB, &[(b"side.txt", Modified, blob(4))])
        .said("side two")
        .at(2)
        .commit(
            JAN_2024 + 4 * DAY,
            ALICE,
            &[(b"main.txt", Modified, blob(5))],
        )
        .commit(
            JAN_2024 + 5 * DAY,
            ALICE,
            &[(b"main.txt", Modified, blob(6))],
        )
        .merge(JAN_2024 + 6 * DAY, ALICE, 4, &[])
        .said("Merge branch 'side'")
}

#[test]
fn older_commits_a_merge_makes_reachable_are_added_on_the_next_load() {
    let dir = tempfile::tempdir().expect("temp dir");
    let before = load_all(&branched().only_tips(&[6]), dir.path());
    assert_eq!(before.index.commits.len(), 4);

    let after = load_all(&branched(), dir.path());
    assert_eq!(
        after.freshness,
        Freshness::Updated { added: 3 },
        "side 3, side 4 and the merge, although the side commits are older than the cached tip"
    );
    assert_eq!(observe(&after.index), observe(&scratch(&branched())));
    assert!(after.index.is_time_ordered());
}

#[test]
fn rewritten_history_is_rebuilt() {
    let dir = tempfile::tempdir().expect("temp dir");
    load_all(&linear(), dir.path());

    let rewritten = ScriptedRepo::new()
        .commit(JAN_2024 + 7, BOB, &[(b"z.txt", Added, blob(9))])
        .commit(JAN_2024 + 9, BOB, &[(b"z.txt", Modified, blob(8))]);
    let loaded = load_all(&rewritten, dir.path());
    assert_eq!(
        loaded.freshness,
        Freshness::Built {
            reason: RebuildReason::HistoryRewritten
        }
    );
    assert_eq!(observe(&loaded.index), observe(&scratch(&rewritten)));
}

#[test]
fn a_damaged_cache_is_rebuilt_and_never_reported_as_an_error() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = linear();
    load_all(&repo, dir.path());

    for file in cache_files(dir.path()) {
        let mut bytes = std::fs::read(&file).expect("reading cache file");
        let middle = bytes.len() / 2;
        if let Some(b) = bytes.get_mut(middle) {
            *b ^= 0xff;
        }
        std::fs::write(&file, &bytes).expect("damaging cache file");
    }
    let loaded = load_all(&repo, dir.path());
    assert_eq!(
        loaded.freshness,
        Freshness::Built {
            reason: RebuildReason::Unreadable
        }
    );
    assert_eq!(observe(&loaded.index), observe(&scratch(&repo)));

    for file in cache_files(dir.path()) {
        let bytes = std::fs::read(&file).expect("reading cache file");
        std::fs::write(&file, bytes.get(..bytes.len() / 3).unwrap_or(&[]))
            .expect("truncating cache file");
    }
    let loaded = load_all(&repo, dir.path());
    assert_eq!(
        loaded.freshness,
        Freshness::Built {
            reason: RebuildReason::Unreadable
        }
    );
}

#[test]
fn a_head_whose_history_was_lost_reads_as_stale_rather_than_corrupt() {
    let dir = tempfile::tempdir().expect("temp dir");
    load_all(&linear(), dir.path());
    let data = data_file(dir.path());
    let before = std::fs::read(&data).expect("reading data");

    let grown = linear().commit(JAN_2024 + 40 * DAY, BOB, &[(b"b.txt", Modified, blob(4))]);
    load_all(&grown, dir.path());
    assert_eq!(data_file(dir.path()), data, "the update appended");
    std::fs::write(&data, before).expect("losing the appended bytes");

    let loaded = load_all(&grown, dir.path());
    assert_eq!(
        loaded.freshness,
        Freshness::Built {
            reason: RebuildReason::Unreadable
        }
    );
    assert_eq!(observe(&loaded.index), observe(&scratch(&grown)));
}

#[test]
fn a_writer_that_crashed_mid_append_leaves_the_cache_readable() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = linear();
    load_all(&repo, dir.path());
    let mut data = std::fs::OpenOptions::new()
        .append(true)
        .open(data_file(dir.path()))
        .expect("opening data");
    std::io::Write::write_all(&mut data, b"half of a block that never got a head")
        .expect("appending garbage");

    let loaded = load_all(&repo, dir.path());
    assert_eq!(loaded.freshness, Freshness::Warm);
    assert_eq!(observe(&loaded.index), observe(&scratch(&repo)));
}

fn four_months() -> ScriptedRepo {
    let mid = |month_start: i64| month_start + 9 * DAY;
    ScriptedRepo::new()
        .commit(mid(JAN_2024), ALICE, &[(b"a.txt", Added, blob(1))])
        .said("january")
        .commit(mid(1_706_745_600), BOB, &[(b"a.txt", Modified, blob(2))])
        .said("february")
        .commit(mid(1_709_251_200), ALICE, &[(b"b.txt", Added, blob(3))])
        .said("march")
        .commit(mid(1_711_929_600), BOB, &[(b"b.txt", Modified, blob(4))])
        .said("april")
}

#[test]
fn a_mailmap_edit_is_applied_without_walking_history() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = ScriptedRepo::new()
        .commit(JAN_2024, ALICE, &[(b"a.txt", Added, blob(1))])
        .commit(JAN_2024 + DAY, ALICE_WORK, &[(b"a.txt", Modified, blob(2))]);
    let before = load_all(&repo, dir.path());
    assert_eq!(before.index.authors.len(), 2);

    let mailmap = Mailmap::parse(b"Alice Example <alice@example.com> <alice@work.example.org>\n");
    let after = load_all(&repo.with_mailmap(mailmap), dir.path());
    assert_eq!(after.freshness, Freshness::Warm);
    assert_eq!(after.index.authors.len(), 1);
}

#[test]
fn a_stored_undone_merge_and_github_link_apply_on_the_next_warm_load() {
    const ALICE_NOREPLY: (&str, &str) = ("Alice Example", "7+alice@users.noreply.github.com");
    const ALI: (&str, &str) = ("ali", "ali@home.example");
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = ScriptedRepo::new()
        .commit(JAN_2024, ALICE, &[(b"a.txt", Added, blob(1))])
        .commit(
            JAN_2024 + DAY,
            ALICE_NOREPLY,
            &[(b"a.txt", Modified, blob(2))],
        )
        .commit(JAN_2024 + 2 * DAY, ALI, &[(b"a.txt", Modified, blob(3))]);
    let first = load_all(&repo, dir.path());
    assert_eq!(first.index.authors.len(), 2, "the same full name joins two");

    let stored = repo_cache(dir.path());
    std::fs::write(stored.join("kept-apart"), "alice@example.com github:7\n").expect("saved");
    let undone = load_all(&repo, dir.path());
    assert_eq!(undone.freshness, Freshness::Warm, "no history is read");
    assert_eq!(undone.index.authors.len(), 3);

    std::fs::write(stored.join("accounts"), "ali@home.example\t7\talice\n").expect("saved");
    let linked = load_all(&repo, dir.path());
    assert_eq!(linked.freshness, Freshness::Warm);
    assert_eq!(
        linked.index.authors.len(),
        2,
        "GitHub joins ali to the noreply account; the undone name merge stays undone"
    );
}

#[test]
fn without_a_cache_directory_nothing_is_read_or_written() {
    let loaded = load_with(&linear(), None);
    assert_eq!(
        loaded.freshness,
        Freshness::Built {
            reason: RebuildReason::Disabled
        }
    );
    assert_eq!(observe(&loaded.index), observe(&scratch(&linear())));
}

fn repo_cache(root: &Path) -> std::path::PathBuf {
    std::fs::read_dir(root)
        .expect("cache root")
        .flatten()
        .next()
        .expect("one repository cache")
        .path()
}

fn live_head(root: &Path) -> std::path::PathBuf {
    let dir = repo_cache(root);
    let generation = std::fs::read_to_string(dir.join("index.current")).expect("pointer");
    dir.join(format!("{}.head", generation.trim()))
}

fn data_file(root: &Path) -> std::path::PathBuf {
    let mut data: Vec<_> = std::fs::read_dir(repo_cache(root))
        .expect("repo cache")
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".data"))
        .map(|e| e.path())
        .collect();
    data.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    data.pop().expect("a data file")
}

fn cache_files(root: &Path) -> Vec<std::path::PathBuf> {
    vec![live_head(root), data_file(root)]
}

#[test]
fn a_late_merge_of_old_commits_is_stored_among_the_months_it_landed_in() {
    const APR_1_2024: i64 = 1_711_929_600;
    let full = || {
        four_months()
            .at(1)
            .commit(JAN_2024 + 19 * DAY, BOB, &[(b"side.txt", Added, blob(7))])
            .at(4)
            .merge(APR_1_2024 + 19 * DAY, ALICE, 5, &[])
    };
    let dir = tempfile::tempdir().expect("temp dir");
    load_all(&full().only_tips(&[4]), dir.path());

    let updated = load_all(&full(), dir.path());
    assert_eq!(updated.freshness, Freshness::Updated { added: 2 });
    assert!(updated.index.is_time_ordered());
    assert_eq!(observe(&updated.index), observe(&scratch(&full())));

    let again = load_all(&full(), dir.path());
    assert_eq!(again.freshness, Freshness::Warm);
    assert_eq!(observe(&again.index), observe(&scratch(&full())));
}

#[test]
fn old_generations_are_removed_keeping_only_the_last_two() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut repo = linear();
    load_all(&repo, dir.path());
    for i in 0..4u8 {
        repo = repo.commit(
            JAN_2024 + (10 + i as i64) * DAY,
            BOB,
            &[(b"a.txt", Modified, blob(20 + i))],
        );
        load_all(&repo, dir.path());
    }
    let heads = std::fs::read_dir(repo_cache(dir.path()))
        .expect("repo cache")
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".head"))
        .count();
    assert_eq!(heads, 2, "the live generation and the one before it");
}

#[test]
fn repeated_updates_do_not_let_the_data_file_grow_without_bound() {
    let dir = tempfile::tempdir().expect("temp dir");
    let mut repo = linear();
    for i in 0..60u8 {
        repo = repo.commit(
            JAN_2024 + (10 + i as i64) * 3600,
            BOB,
            &[(b"a.txt", Modified, blob(i))],
        );
        load_all(&repo, dir.path());
    }
    let updated = std::fs::metadata(data_file(dir.path()))
        .expect("data")
        .len();

    let fresh_dir = tempfile::tempdir().expect("temp dir");
    load_all(&repo, fresh_dir.path());
    let fresh = std::fs::metadata(data_file(fresh_dir.path()))
        .expect("data")
        .len();

    assert!(
        updated <= 4 * fresh.max(1 << 20),
        "{updated} bytes after 60 updates against {fresh} for a fresh build"
    );
    let again = load_all(&repo, dir.path());
    assert_eq!(again.freshness, Freshness::Warm);
    assert_eq!(observe(&again.index), observe(&scratch(&repo)));
}
