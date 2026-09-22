//! Moving HEAD in a real repository: the updated HEAD table must match a
//! from-scratch one, whether the update diffed the two trees or listed HEAD
//! again.
//!
//! The repository is built with the `git` binary, under the same declared
//! exception to ADR-0001 as the fixture generator: test tooling writes
//! repositories, the product only reads them.

#![allow(clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use commitscape_core::{FileClass, Index};
use commitscape_index::{index_from_scratch, load, CacheOptions, Freshness, GixRepo, Since};

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .env("GIT_AUTHOR_NAME", "Alice Example")
        .env("GIT_AUTHOR_EMAIL", "alice@example.com")
        .env("GIT_COMMITTER_NAME", "Alice Example")
        .env("GIT_COMMITTER_EMAIL", "alice@example.com")
        .env("GIT_AUTHOR_DATE", "1704067200 +0000")
        .env("GIT_COMMITTER_DATE", "1704067200 +0000")
        .output()
        .expect("running git");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn write(dir: &Path, path: &str, contents: &str) {
    let p = dir.join(path);
    std::fs::create_dir_all(p.parent().expect("a parent")).expect("mkdir");
    std::fs::write(p, contents).expect("write");
}

fn commit(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// Every file at HEAD by path: lines, indentation, class.
fn table(idx: &Index) -> BTreeMap<String, (u32, u32, FileClass)> {
    idx.head
        .iter()
        .map(|h| {
            let path = idx
                .paths
                .path_name(h.path)
                .map(|p| String::from_utf8_lossy(p).into_owned())
                .unwrap_or_default();
            (path, (h.loc, h.indent_levels, h.class))
        })
        .collect()
}

fn cached(repo: &Path, cache: &Path) -> (Index, Freshness) {
    let source = GixRepo::open(repo).expect("open");
    let options = CacheOptions {
        root: Some(cache.to_path_buf()),
    };
    let loaded = load(&source, &options, Since::All, &mut |_| {}).expect("load");
    (loaded.index, loaded.freshness)
}

fn scratch(repo: &Path) -> Index {
    index_from_scratch(&GixRepo::open(repo).expect("open")).expect("index")
}

#[test]
fn moving_head_updates_the_head_table_to_match_a_full_build() {
    let repo = tempfile::tempdir().expect("repo dir");
    let cache = tempfile::tempdir().expect("cache dir");
    let dir = repo.path();
    git(dir, &["init", "-q"]);
    write(dir, "src/a.rs", "fn a() {\n    x();\n}\n");
    write(dir, "src/b.rs", "fn b() {}\n");
    write(dir, "src/d.rs", "fn d() {\n    y();\n}\n");
    write(dir, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    commit(dir, "first");
    let (first, _) = cached(dir, cache.path());
    assert_eq!(table(&first), table(&scratch(dir)));

    // A modification, a deletion, an addition and an exact rename.
    write(
        dir,
        "src/a.rs",
        "fn a() {\n    if x {\n        y();\n    }\n}\n",
    );
    std::fs::remove_file(dir.join("src/b.rs")).expect("rm");
    write(dir, "src/c.rs", "fn c() {}\n");
    git(dir, &["mv", "src/d.rs", "src/e.rs"]);
    commit(dir, "second");
    let (second, freshness) = cached(dir, cache.path());
    assert_eq!(freshness, Freshness::Updated { added: 1 });
    assert_eq!(table(&second), table(&scratch(dir)));
    assert_eq!(
        table(&second).get("src/a.rs"),
        Some(&(5, 4, FileClass::Source))
    );
    assert!(!table(&second).contains_key("src/b.rs"));
    assert!(!table(&second).contains_key("src/d.rs"));

    // A .gitattributes change reclassifies files that did not change.
    write(dir, ".gitattributes", "src/c.rs linguist-generated\n");
    commit(dir, "third");
    let (third, _) = cached(dir, cache.path());
    assert_eq!(table(&third), table(&scratch(dir)));
    assert_eq!(
        table(&third).get("src/c.rs").map(|t| t.2),
        Some(FileClass::Generated)
    );
}
