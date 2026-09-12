//! Builds the synthetic repositories that metric tests assert against.
//!
//! Every fixture is constructed so that its metric values can be worked out by
//! hand from the shape of the history. `docs/fixtures.md` records those worked
//! values; tests assert the literals from that document. A test that recomputes
//! its expected value the way the code does tests nothing.
//!
//! These repositories are built by shelling out to the `git` binary. That is a
//! deliberate and declared exception to ADR-0001, which governs how the
//! *product* reads repositories, not how the test suite writes them. No product
//! code path reaches this module.
//!
//! Everything is deterministic: fixed authors, fixed commit timestamps derived
//! from a fixed epoch, fixed branch names. Rebuilding a fixture produces
//! identical object ids.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 2024-01-01T00:00:00Z. Commit `n` of a fixture is stamped `EPOCH + n days`,
/// which makes every time-window boundary in the tests exactly computable.
const EPOCH: i64 = 1_704_067_200;
const DAY: i64 = 86_400;

#[derive(Clone, Copy)]
struct Author {
    name: &'static str,
    email: &'static str,
}

const ALICE: Author = Author {
    name: "Alice Example",
    email: "alice@example.com",
};
/// Same person as [`ALICE`], differing only in email case. Resolved by ADR-0006
/// rule 2 without any configuration.
const ALICE_UPPER: Author = Author {
    name: "Alice Example",
    email: "Alice@Example.COM",
};
/// Same person as [`ALICE`] once a `.mailmap` maps this address. Not resolvable
/// by rules 2 or 3 — it exists to prove the mailmap path is load-bearing.
const ALICE_WORK: Author = Author {
    name: "A. Example",
    email: "alice@work.example.org",
};
const BOB: Author = Author {
    name: "Bob Example",
    email: "bob@example.com",
};
/// GitHub's numeric noreply form. ADR-0006 rule 3 folds this onto
/// `carol@users.noreply.github.com`.
const CAROL_NUMERIC: Author = Author {
    name: "Carol",
    email: "90210+carol@users.noreply.github.com",
};
const CAROL_PLAIN: Author = Author {
    name: "Carol",
    email: "carol@users.noreply.github.com",
};

/// A fixture repository under construction.
struct Fx {
    root: PathBuf,
    /// Number of commits made so far; also the day offset of the next commit.
    day: i64,
}

impl Fx {
    fn init(root: PathBuf) -> Result<Self> {
        if root.exists() {
            std::fs::remove_dir_all(&root)
                .with_context(|| format!("clearing {}", root.display()))?;
        }
        std::fs::create_dir_all(&root).with_context(|| format!("creating {}", root.display()))?;
        let fx = Fx { root, day: 0 };
        fx.git(&["init", "-q", "-b", "main"])?;
        // Keep the fixture independent of whatever the host's git config says.
        fx.git(&["config", "commit.gpgsign", "false"])?;
        fx.git(&["config", "core.autocrlf", "false"])?;
        fx.git(&["config", "gc.auto", "0"])?;
        Ok(fx)
    }

    fn git(&self, args: &[&str]) -> Result<String> {
        self.git_env(args, &[])
    }

    fn git_env(&self, args: &[&str], env: &[(&str, String)]) -> Result<String> {
        let mut cmd = Command::new("git");
        cmd.current_dir(&self.root).args(args);
        for (k, v) in env {
            cmd.env(k, v);
        }
        let out = cmd
            .output()
            .with_context(|| format!("running git {}", args.join(" ")))?;
        if !out.status.success() {
            bail!(
                "git {} failed in {}: {}",
                args.join(" "),
                self.root.display(),
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        String::from_utf8(out.stdout).context("git output was not UTF-8")
    }

    fn write(&self, rel: &str, contents: &str) -> Result<()> {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        std::fs::write(&path, contents).with_context(|| format!("writing {}", path.display()))
    }

    /// Stages everything and commits as `author`, stamped at the next day slot.
    fn commit(&mut self, author: Author, message: &str) -> Result<()> {
        self.git(&["add", "-A"])?;
        let stamp = format!("{} +0000", EPOCH + self.day * DAY);
        self.git_env(
            &["commit", "-q", "--allow-empty", "-m", message],
            &[
                ("GIT_AUTHOR_NAME", author.name.to_string()),
                ("GIT_AUTHOR_EMAIL", author.email.to_string()),
                ("GIT_AUTHOR_DATE", stamp.clone()),
                ("GIT_COMMITTER_NAME", author.name.to_string()),
                ("GIT_COMMITTER_EMAIL", author.email.to_string()),
                ("GIT_COMMITTER_DATE", stamp),
            ],
        )?;
        self.day += 1;
        Ok(())
    }

    /// Writes each `(path, contents)` then makes one commit touching all of them.
    fn commit_touching(
        &mut self,
        author: Author,
        message: &str,
        files: &[(&str, &str)],
    ) -> Result<()> {
        for (path, contents) in files {
            self.write(path, contents)?;
        }
        self.commit(author, message)
    }
}

pub fn build(force: bool) -> Result<()> {
    let dir = crate::workspace_root().join("fixtures");
    if dir.exists() && !force {
        println!(
            "fixtures already exist at {} (use --force to rebuild)",
            dir.display()
        );
        return Ok(());
    }
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;

    linear(&dir)?;
    coupling(&dir)?;
    ownership(&dir)?;
    renames(&dir)?;
    bulk(&dir)?;
    merges(&dir)?;
    empty(&dir)?;
    detached(&dir)?;
    bare(&dir)?;
    shallow(&dir)?;

    println!("fixtures built at {}", dir.display());
    println!("expected values are recorded in docs/fixtures.md");
    Ok(())
}

/// `linear` — five commits, no branches, no merges.
///
/// Churn: `a.txt` 5, `b.txt` 2, `c.txt` 1.
/// Last touched: a.txt day 4, b.txt day 3, c.txt day 2.
fn linear(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("linear"))?;
    fx.commit_touching(ALICE, "add a", &[("a.txt", "1\n")])?;
    fx.commit_touching(ALICE, "edit a", &[("a.txt", "1\n2\n")])?;
    fx.commit_touching(
        ALICE,
        "edit a, add c",
        &[("a.txt", "1\n2\n3\n"), ("c.txt", "c\n")],
    )?;
    fx.commit_touching(
        ALICE,
        "edit a, add b",
        &[("a.txt", "1\n2\n3\n4\n"), ("b.txt", "b\n")],
    )?;
    fx.commit_touching(
        ALICE,
        "edit a and b",
        &[("a.txt", "1\n2\n3\n4\n5\n"), ("b.txt", "b\nb\n")],
    )?;
    Ok(())
}

/// `coupling` — built so the Jaccard degrees are exact, small fractions.
///
/// `src/a.txt` appears in commits 1,2,3,4,5            -> 5
/// `src/b.txt` appears in commits 1,2,3,6              -> 4
/// `pkg/c.txt` appears in commits 7,8,9,10,11          -> 5
/// `other/d.txt` appears in commits 7,8,9,10,12        -> 5
///
/// (a,b): both 3, either 5+4-3=6, Jaccard 3/6 = 1/2. P(a|b)=3/4, P(b|a)=3/5.
/// (c,d): both 4, either 5+5-4=6, Jaccard 4/6 = 2/3. Cross-directory.
/// With a support threshold of 5, `b` is pruned and only (c,d) survives.
fn coupling(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("coupling"))?;
    let ab: &[(&str, &str)] = &[("src/a.txt", "a1\n"), ("src/b.txt", "b1\n")];
    fx.commit_touching(ALICE, "ab 1", ab)?;
    fx.commit_touching(
        ALICE,
        "ab 2",
        &[("src/a.txt", "a2\n"), ("src/b.txt", "b2\n")],
    )?;
    fx.commit_touching(
        ALICE,
        "ab 3",
        &[("src/a.txt", "a3\n"), ("src/b.txt", "b3\n")],
    )?;
    fx.commit_touching(ALICE, "a only 4", &[("src/a.txt", "a4\n")])?;
    fx.commit_touching(ALICE, "a only 5", &[("src/a.txt", "a5\n")])?;
    fx.commit_touching(ALICE, "b only 6", &[("src/b.txt", "b6\n")])?;
    fx.commit_touching(
        ALICE,
        "cd 7",
        &[("pkg/c.txt", "c7\n"), ("other/d.txt", "d7\n")],
    )?;
    fx.commit_touching(
        ALICE,
        "cd 8",
        &[("pkg/c.txt", "c8\n"), ("other/d.txt", "d8\n")],
    )?;
    fx.commit_touching(
        ALICE,
        "cd 9",
        &[("pkg/c.txt", "c9\n"), ("other/d.txt", "d9\n")],
    )?;
    fx.commit_touching(
        ALICE,
        "cd 10",
        &[("pkg/c.txt", "c10\n"), ("other/d.txt", "d10\n")],
    )?;
    fx.commit_touching(ALICE, "c only 11", &[("pkg/c.txt", "c11\n")])?;
    fx.commit_touching(ALICE, "d only 12", &[("other/d.txt", "d12\n")])?;
    Ok(())
}

/// `ownership` — known author distributions, plus every identity form ADR-0006
/// has to resolve.
///
/// `alpha/`: 9 Alice commits (3 as ALICE, 3 as ALICE_UPPER, 3 as ALICE_WORK)
///           and 1 Bob commit. After resolution Alice holds 9/10 = 90%,
///           which is over the 80% line, so alpha has a bus factor of 1.
///           Without mailmap, ALICE_WORK stays separate and Alice holds only
///           6/10 = 60%, so the mailmap is what moves the number.
/// `beta/`:  3 Carol commits as CAROL_NUMERIC and 2 as CAROL_PLAIN — one
///           person, 5/5, resolved by rule 3 alone. Plus 5 Bob commits.
///           Carol 5/10, Bob 5/10, bus factor 2.
fn ownership(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("ownership"))?;
    fx.write(
        ".mailmap",
        "Alice Example <alice@example.com> <alice@work.example.org>\n",
    )?;
    fx.commit(ALICE, "add mailmap")?;

    for i in 0..3 {
        fx.commit_touching(ALICE, "alpha alice", &[("alpha/f.txt", &format!("a{i}\n"))])?;
    }
    for i in 0..3 {
        fx.commit_touching(
            ALICE_UPPER,
            "alpha alice upper",
            &[("alpha/f.txt", &format!("u{i}\n"))],
        )?;
    }
    for i in 0..3 {
        fx.commit_touching(
            ALICE_WORK,
            "alpha alice work",
            &[("alpha/f.txt", &format!("w{i}\n"))],
        )?;
    }
    fx.commit_touching(BOB, "alpha bob", &[("alpha/f.txt", "bob\n")])?;

    for i in 0..3 {
        fx.commit_touching(
            CAROL_NUMERIC,
            "beta carol numeric",
            &[("beta/g.txt", &format!("cn{i}\n"))],
        )?;
    }
    for i in 0..2 {
        fx.commit_touching(
            CAROL_PLAIN,
            "beta carol plain",
            &[("beta/g.txt", &format!("cp{i}\n"))],
        )?;
    }
    for i in 0..5 {
        fx.commit_touching(BOB, "beta bob", &[("beta/g.txt", &format!("b{i}\n"))])?;
    }
    Ok(())
}

/// `renames` — an exact rename in the middle of a file's life.
///
/// `old/path.txt` is created and edited twice (commits 1,2,3), then moved to
/// `new/path.txt` with identical content (commit 4), then edited twice more
/// (commits 5,6).
///
/// With rename following, one FileId with churn 6. Without it, two files with
/// churn 3 each — and the moved file looks new, which is the failure ADR-0004
/// exists to avoid.
fn renames(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("renames"))?;
    fx.commit_touching(ALICE, "create", &[("old/path.txt", "one\n")])?;
    fx.commit_touching(ALICE, "edit 1", &[("old/path.txt", "one\ntwo\n")])?;
    fx.commit_touching(ALICE, "edit 2", &[("old/path.txt", "one\ntwo\nthree\n")])?;
    // Exact rename: content byte-identical, so the blob id is unchanged.
    // `git mv` will not create the destination directory itself.
    std::fs::create_dir_all(fx.root.join("new")).context("creating rename destination")?;
    fx.git(&["mv", "old/path.txt", "new/path.txt"])?;
    fx.commit(ALICE, "move without editing")?;
    fx.commit_touching(
        ALICE,
        "edit 3",
        &[("new/path.txt", "one\ntwo\nthree\nfour\n")],
    )?;
    fx.commit_touching(
        ALICE,
        "edit 4",
        &[("new/path.txt", "one\ntwo\nthree\nfour\nfive\n")],
    )?;
    Ok(())
}

/// `bulk` — one oversized commit among small ones.
///
/// `a.txt` is touched by 3 small commits and by 1 commit that touches 60 files.
/// At a bulk threshold of 50: churn(a.txt) = 3, and exactly 1 commit is
/// excluded. Staleness still reports the bulk commit's day, because a file that
/// was touched was touched.
fn bulk(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("bulk"))?;
    fx.commit_touching(ALICE, "small 1", &[("a.txt", "1\n")])?;
    fx.commit_touching(ALICE, "small 2", &[("a.txt", "2\n")])?;
    fx.commit_touching(ALICE, "small 3", &[("a.txt", "3\n")])?;
    let mut files: Vec<(String, String)> = Vec::new();
    files.push(("a.txt".to_string(), "bulk\n".to_string()));
    for i in 0..59 {
        files.push((format!("gen/f{i:03}.txt"), format!("{i}\n")));
    }
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, c)| (p.as_str(), c.as_str()))
        .collect();
    fx.commit_touching(ALICE, "the bulk commit (60 files)", &refs)?;
    Ok(())
}

/// `merges` — a long-lived branch whose commits are older than the tip it is
/// merged into.
///
/// This is the fixture for the frontier bug in ADR-0002. `side` is branched at
/// day 1 and committed on at days 2 and 3. `main` continues to day 5. The merge
/// lands at day 6. An incremental index that resumed from "the last indexed
/// sha" or from a timestamp would miss the two `side` commits entirely, because
/// they are older than main's tip at the time of the first index.
fn merges(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("merges"))?;
    fx.commit_touching(ALICE, "main 0", &[("main.txt", "0\n")])?;
    fx.commit_touching(ALICE, "main 1", &[("main.txt", "1\n")])?;
    let base = fx.git(&["rev-parse", "HEAD"])?.trim().to_string();

    fx.git(&["checkout", "-q", "-b", "side", &base])?;
    fx.commit_touching(BOB, "side 2", &[("side.txt", "2\n")])?;
    fx.commit_touching(BOB, "side 3", &[("side.txt", "3\n")])?;

    fx.git(&["checkout", "-q", "main"])?;
    fx.commit_touching(ALICE, "main 4", &[("main.txt", "4\n")])?;
    fx.commit_touching(ALICE, "main 5", &[("main.txt", "5\n")])?;

    let stamp = format!("{} +0000", EPOCH + fx.day * DAY);
    fx.git_env(
        &[
            "merge",
            "--no-ff",
            "-q",
            "-m",
            "merge side into main",
            "side",
        ],
        &[
            ("GIT_AUTHOR_NAME", ALICE.name.to_string()),
            ("GIT_AUTHOR_EMAIL", ALICE.email.to_string()),
            ("GIT_AUTHOR_DATE", stamp.clone()),
            ("GIT_COMMITTER_NAME", ALICE.name.to_string()),
            ("GIT_COMMITTER_EMAIL", ALICE.email.to_string()),
            ("GIT_COMMITTER_DATE", stamp),
        ],
    )?;
    Ok(())
}

/// `empty` — initialised, zero commits. Must produce a clear message, not a panic.
fn empty(dir: &Path) -> Result<()> {
    Fx::init(dir.join("empty"))?;
    Ok(())
}

/// `detached` — HEAD detached onto the first commit.
fn detached(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("detached"))?;
    fx.commit_touching(ALICE, "one", &[("a.txt", "1\n")])?;
    let first = fx.git(&["rev-parse", "HEAD"])?.trim().to_string();
    fx.commit_touching(ALICE, "two", &[("a.txt", "2\n")])?;
    fx.git(&["checkout", "-q", "--detach", &first])?;
    Ok(())
}

/// `bare` — a bare clone of `linear`, so there is no worktree to read HEAD from.
fn bare(dir: &Path) -> Result<()> {
    let src = dir.join("linear");
    let dst = dir.join("bare.git");
    if dst.exists() {
        std::fs::remove_dir_all(&dst)?;
    }
    let out = Command::new("git")
        .args(["clone", "-q", "--bare"])
        .arg(&src)
        .arg(&dst)
        .output()
        .context("cloning bare fixture")?;
    if !out.status.success() {
        bail!(
            "bare clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

/// `shallow` — depth-1 clone of `linear`. Commit counts are truncated and the
/// tool must say so rather than reporting the truncated number as real.
fn shallow(dir: &Path) -> Result<()> {
    let src = dir.join("linear");
    let dst = dir.join("shallow");
    if dst.exists() {
        std::fs::remove_dir_all(&dst)?;
    }
    let url = format!("file://{}", src.display());
    let out = Command::new("git")
        .args(["clone", "-q", "--depth", "1", &url])
        .arg(&dst)
        .output()
        .context("cloning shallow fixture")?;
    if !out.status.success() {
        bail!(
            "shallow clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}
