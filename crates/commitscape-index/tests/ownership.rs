#![allow(clippy::expect_used, clippy::indexing_slicing)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use commitscape_core::Index;
use commitscape_index::{
    index_from_scratch, load, CacheOptions, GixRepo, RepoSource, Survival, Survived,
};

const BULK: u32 = 50;
const BUDGET: Duration = Duration::from_secs(3600);

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

fn compare(repo: &GixRepo, index: &Index) -> (usize, u64) {
    let ignored = repo.blame_ignore_revs().expect("ignored revisions");
    let threads = repo.threads();
    let mut survival =
        Survival::new(index, &ignored, BULK, &CacheOptions::default()).expect("a head");
    let mut ownership = survival.own(&threads, None, None).expect("ownership");
    assert!(ownership.complete);
    let everyone = survival
        .everyone(repo, &mut ownership)
        .expect("everyone")
        .expect("a complete ownership");
    let mut oracle =
        Survival::new(index, &ignored, BULK, &CacheOptions::default()).expect("a head");
    let mut lines = 0;
    for (person, found) in &everyone {
        let want = oracle
            .person(&threads, *person, BUDGET)
            .expect("blame for one person");
        assert_eq!(&want, found, "{person:?}");
        if let Survived::Counted { lines: n, .. } = found {
            lines += n;
        }
    }
    (everyone.len(), lines)
}

#[test]
fn everyones_surviving_lines_from_the_ownership_match_blame_person_by_person_on_every_fixture() {
    let mut people = 0;
    let mut lines = 0;
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
        "tags",
        "crafted",
        "bare.git",
    ] {
        let repo = GixRepo::open(&fixture(name)).expect("opening fixture");
        let index = index_from_scratch(&repo).expect("indexing fixture");
        let (p, l) = compare(&repo, &index);
        people += p;
        lines += l;
    }
    assert!(people > 10, "{people}");
    assert!(lines > 50, "{lines}");
}

#[test]
#[ignore = "set COMMITSCAPE_ORACLE_REPO to a clone, and COMMITSCAPE_ORACLE_CACHE to its cache folder"]
fn everyones_surviving_lines_match_blame_person_by_person_on_a_real_repository() {
    let path = std::env::var("COMMITSCAPE_ORACLE_REPO").expect("COMMITSCAPE_ORACLE_REPO");
    let repo = GixRepo::open(Path::new(&path)).expect("opening the repository");
    let options = CacheOptions {
        root: std::env::var("COMMITSCAPE_ORACLE_CACHE")
            .ok()
            .map(PathBuf::from),
        key: std::env::var("COMMITSCAPE_ORACLE_KEY").ok(),
    };
    let index = load(&repo, &options, &mut |_| {})
        .expect("loading the Index")
        .index;
    let (people, lines) = compare(&repo, &index);
    eprintln!("{people} people, {lines} surviving lines, the same as blame person by person");
}
