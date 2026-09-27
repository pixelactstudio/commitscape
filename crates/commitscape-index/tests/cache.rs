//! The cache, driven through the scripted adapter and a temporary directory.
//!
//! ADR-0002 is the specification: a warm load reads the cache and walks
//! nothing; new commits are added without a rebuild, including older-dated
//! ones a merge made reachable; rewritten history, damage and torn writes all
//! degrade to a rebuild and never to an error.
//!
//! Loads are compared by what a user could observe: each commit's changes by
//! path, and each commit's author. Internal ids may legitimately differ
//! between an incremental load and a full build.

#![allow(clippy::expect_used)]

use std::path::Path;

use commitscape_core::{ChangeKind, Index, Oid};
use commitscape_index::source::RawChangeKind::{Added, Modified};
use commitscape_index::{
    index_from_scratch, load, CacheOptions, Freshness, Loaded, Mailmap, RebuildReason,
    ScriptedRepo, Since,
};

const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
const ALICE_WORK: (&str, &str) = ("A. Example", "alice@work.example.org");
const BOB: (&str, &str) = ("Bob Example", "bob@example.com");

/// 2024-01-01T00:00:00Z.
const JAN_2024: i64 = 1_704_067_200;
const DAY: i64 = 86_400;

fn blob(n: u8) -> Oid {
    let mut b = [0u8; 20];
    b[0] = n;
    Oid(b)
}

fn load_with(repo: &ScriptedRepo, root: Option<&Path>, since: Since) -> Loaded {
    let options = CacheOptions {
        root: root.map(Path::to_path_buf),
    };
    match load(repo, &options, since, &mut |_| {}) {
        Ok(l) => l,
        Err(never) => match never {},
    }
}

fn load_all(repo: &ScriptedRepo, root: &Path) -> Loaded {
    load_with(repo, Some(root), Since::All)
}

type Observed = Vec<(Oid, i64, String, String, Vec<(String, ChangeKind)>)>;

/// What a user could observe of an index.
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

/// main: 1 (Jan 1), 2 (Jan 2); side from 2: 3 (Jan 3), 4 (Jan 4);
/// main again: 5 (Jan 5), 6 (Jan 6); merge of 6 and 4: 7 (Jan 7).
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
    // ADR-0002's frontier case, through the cache. The first load sees main
    // up to commit 6 and never sees the side branch.
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

    // Same repository path, different history: a force-push that replaced
    // every commit.
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
    // An update appends to the data file and then writes a new head. If the
    // appended bytes are lost (a crash before they reached the disk), the
    // head names months that are not there.
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

/// Commits on the 10th of January, February, March and April 2024.
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
fn a_recent_window_reads_only_the_months_it_needs_and_the_rest_later() {
    const MAR_1_2024: i64 = 1_709_251_200;
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = four_months();
    load_all(&repo, dir.path());

    // Anything in March: the March and April months are read, whole.
    let mut recent = load_with(&repo, Some(dir.path()), Since::Time(MAR_1_2024 + 20 * DAY));
    assert_eq!(recent.freshness, Freshness::Warm);
    assert_eq!(recent.index.loaded_from, Some(MAR_1_2024));
    assert_eq!(recent.index.commits.len(), 2);
    assert_eq!(recent.index.span.commits, 4, "totals cover all history");

    let rest = recent.take_rest().expect("older months remain");
    let older = rest.load().expect("loading the older months");
    older.prepend_to(&mut recent.index);
    assert_eq!(recent.index.loaded_from, None);
    assert_eq!(observe(&recent.index), observe(&scratch(&repo)));
}

#[test]
fn the_rest_completes_a_copy_while_the_recent_index_stays_in_use() {
    const MAR_1_2024: i64 = 1_709_251_200;
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = four_months();
    load_all(&repo, dir.path());

    let mut recent = load_with(&repo, Some(dir.path()), Since::Time(MAR_1_2024 + 20 * DAY));
    let rest = recent.take_rest().expect("older months remain");
    let full = rest
        .complete(&recent.index)
        .expect("reading the older months");
    assert_eq!(observe(&full), observe(&scratch(&repo)));
    assert_eq!(
        recent.index.commits.len(),
        2,
        "the recent index is untouched"
    );
}

#[test]
fn a_window_relative_to_the_newest_commit_resolves_against_the_cache() {
    const APR_1_2024: i64 = 1_711_929_600;
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = four_months();
    load_all(&repo, dir.path());

    // The newest commit is 10 April. Five days back is still April.
    let recent = load_with(&repo, Some(dir.path()), Since::BeforeNewest(5 * DAY));
    assert_eq!(recent.index.loaded_from, Some(APR_1_2024));
    assert_eq!(recent.index.commits.len(), 1);
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
fn an_undone_merge_and_a_github_link_apply_on_the_next_warm_load() {
    use commitscape_index::identity::{keys_of, Account};
    use commitscape_index::IdentityStore;
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

    let options = CacheOptions {
        root: Some(dir.path().to_path_buf()),
    };
    let store = IdentityStore::for_repo(&options, &first.index.repo).expect("a store");
    let rules = store.rules(Mailmap::default());
    let alice = first
        .index
        .author_of(first.index.commits.first().expect("a commit"))
        .expect("alice");
    store
        .keep_apart(&keys_of(&first.index.authors, alice, &rules))
        .expect("saved");
    let undone = load_all(&repo, dir.path());
    assert_eq!(undone.freshness, Freshness::Warm, "no history is read");
    assert_eq!(undone.index.authors.len(), 3);

    store
        .save_accounts(&[(
            "ali@home.example".to_string(),
            Some(Account {
                id: 7,
                login: "alice".to_string(),
            }),
        )])
        .expect("saved");
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
    let loaded = load_with(&linear(), None, Since::All);
    assert_eq!(
        loaded.freshness,
        Freshness::Built {
            reason: RebuildReason::Disabled
        }
    );
    assert_eq!(observe(&loaded.index), observe(&scratch(&linear())));
}

/// The repository's cache directory: the one subdirectory of the root.
fn repo_cache(root: &Path) -> std::path::PathBuf {
    std::fs::read_dir(root)
        .expect("cache root")
        .flatten()
        .next()
        .expect("one repository cache")
        .path()
}

/// The live head file.
fn live_head(root: &Path) -> std::path::PathBuf {
    let dir = repo_cache(root);
    let generation = std::fs::read_to_string(dir.join("index.current")).expect("pointer");
    dir.join(format!("{}.head", generation.trim()))
}

/// The data file. After a write there is exactly one the live head uses;
/// this finds the newest.
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

/// Every file a load reads.
fn cache_files(root: &Path) -> Vec<std::path::PathBuf> {
    vec![live_head(root), data_file(root)]
}

#[test]
fn a_late_merge_of_old_commits_reaches_back_past_a_partial_load() {
    // Main: the four monthly commits. A side branch from the January commit
    // gets one commit on 20 January and is merged on 20 April. The first load
    // never sees the side branch; the second loads only April onward, so the
    // January commit lands in a month it did not read.
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

    let recent = load_with(&full(), Some(dir.path()), Since::Time(APR_1_2024));
    assert_eq!(recent.freshness, Freshness::Updated { added: 2 });
    assert!(
        recent.index.covers(JAN_2024 + 19 * DAY),
        "the months the new commits landed in were read"
    );
    assert!(recent.index.is_time_ordered());

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
    // Every update re-encodes the current month and appends it, leaving the
    // old copy behind. Compaction must keep the file within a small multiple
    // of what a fresh build writes.
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
