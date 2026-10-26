use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

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
const ALICE_UPPER: Author = Author {
    name: "Alice Example",
    email: "Alice@Example.COM",
};
const ALICE_WORK: Author = Author {
    name: "A. Example",
    email: "alice@work.example.org",
};
const BOB: Author = Author {
    name: "Bob Example",
    email: "bob@example.com",
};
const CAROL_NUMERIC: Author = Author {
    name: "Carol",
    email: "90210+carol@users.noreply.github.com",
};
const CAROL_PLAIN: Author = Author {
    name: "Carol",
    email: "carol@users.noreply.github.com",
};

struct Fx {
    root: PathBuf,
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

    fn commit_dated(
        &mut self,
        author: Author,
        message: &[&str],
        authored: &str,
        committed: &str,
    ) -> Result<()> {
        self.git(&["add", "-A"])?;
        let mut args = vec!["commit", "-q", "--allow-empty"];
        for paragraph in message {
            args.push("-m");
            args.push(paragraph);
        }
        self.git_env(
            &args,
            &[
                ("GIT_AUTHOR_NAME", author.name.to_string()),
                ("GIT_AUTHOR_EMAIL", author.email.to_string()),
                ("GIT_AUTHOR_DATE", authored.to_string()),
                ("GIT_COMMITTER_NAME", author.name.to_string()),
                ("GIT_COMMITTER_EMAIL", author.email.to_string()),
                ("GIT_COMMITTER_DATE", committed.to_string()),
            ],
        )?;
        Ok(())
    }

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
    conflict(&dir)?;
    rhythm(&dir)?;
    lines(&dir)?;
    survival(&dir)?;
    empty(&dir)?;
    detached(&dir)?;
    bare(&dir)?;
    shallow(&dir)?;
    tags(&dir)?;
    crafted(&dir)?;

    println!("fixtures built at {}", dir.display());
    println!("expected values are recorded in docs/fixtures.md");
    Ok(())
}

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

fn renames(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("renames"))?;
    fx.commit_touching(ALICE, "create", &[("old/path.txt", "one\n")])?;
    fx.commit_touching(ALICE, "edit 1", &[("old/path.txt", "one\ntwo\n")])?;
    fx.commit_touching(ALICE, "edit 2", &[("old/path.txt", "one\ntwo\nthree\n")])?;
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

fn conflict(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("conflict"))?;
    fx.commit_touching(
        ALICE,
        "base",
        &[("shared.txt", "base\n"), ("other.txt", "o\n")],
    )?;
    let base = fx.git(&["rev-parse", "HEAD"])?.trim().to_string();

    fx.git(&["checkout", "-q", "-b", "topic", &base])?;
    fx.commit_touching(BOB, "topic edit", &[("shared.txt", "topic\n")])?;

    fx.git(&["checkout", "-q", "main"])?;
    fx.commit_touching(ALICE, "main edit", &[("shared.txt", "main\n")])?;

    fx.write("shared.txt", "resolved\n")?;
    fx.write("evil.txt", "evil\n")?;
    fx.git(&["add", "-A"])?;
    let tree = fx.git(&["write-tree"])?.trim().to_string();
    let stamp = format!("{} +0000", EPOCH + fx.day * DAY);
    let merge = fx
        .git_env(
            &[
                "commit-tree",
                &tree,
                "-p",
                "HEAD",
                "-p",
                "topic",
                "-m",
                "merge topic, resolving shared.txt",
            ],
            &[
                ("GIT_AUTHOR_NAME", ALICE.name.to_string()),
                ("GIT_AUTHOR_EMAIL", ALICE.email.to_string()),
                ("GIT_AUTHOR_DATE", stamp.clone()),
                ("GIT_COMMITTER_NAME", ALICE.name.to_string()),
                ("GIT_COMMITTER_EMAIL", ALICE.email.to_string()),
                ("GIT_COMMITTER_DATE", stamp),
            ],
        )?
        .trim()
        .to_string();
    fx.git(&["reset", "-q", "--hard", &merge])?;
    fx.day += 1;
    Ok(())
}

fn lines(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("lines"))?;
    let numbered = |lines: &[String]| lines.iter().map(|l| format!("{l}\n")).collect::<String>();
    let mut app: Vec<String> = (1..=10).map(|n| format!("line {n}")).collect();
    let lock = |version: &str, changed: usize| {
        (1..=100)
            .map(|n| {
                let v = if n <= changed { version } else { "1.0" };
                format!("dep-{n} = {v}\n")
            })
            .collect::<String>()
    };

    fx.write("src/app.rs", &numbered(&app))?;
    fx.write("Cargo.lock", &lock("1.0", 0))?;
    fx.write("logo.png", "\u{89}PNG\r\n\u{1a}\n\u{0}\u{0}\u{0}\rIHDR")?;
    fx.commit(ALICE, "add the app")?;

    app.splice(2..4, ["new a".to_string(), "new b".to_string()]);
    app.extend((1..=3).map(|n| format!("added {n}")));
    fx.write("src/app.rs", &numbered(&app))?;
    fx.commit(BOB, "rework the middle")?;

    app.retain(|l| l != "line 9" && l != "line 10");
    fx.write("src/app.rs", &numbered(&app))?;
    fx.write("Cargo.lock", &lock("2.0", 20))?;
    fx.commit(ALICE, "trim and bump")?;

    fx.write("docs/guide.md", "# Guide\n\nOne.\nTwo.\nThree.\nFour.\n")?;
    fx.git(&["mv", "src/app.rs", "src/main.rs"])?;
    fx.commit(BOB, "guide, and a better name")?;

    let formatted: Vec<String> = app.iter().map(|l| format!("{l};")).collect();
    fx.write("src/main.rs", &numbered(&formatted))?;
    fx.commit(ALICE, "reformat")?;
    let reformat = fx.git(&["rev-parse", "HEAD"])?.trim().to_string();

    fx.write(
        ".git-blame-ignore-revs",
        &format!("# the reformat\n{reformat}\n"),
    )?;
    fx.commit(BOB, "ignore the reformat in blame")?;

    for n in 0..60 {
        fx.write(&format!("gen/f{n:02}.txt"), "generated\n")?;
    }
    fx.commit(ALICE, "add sixty files")?;
    Ok(())
}

fn survival(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("survival"))?;
    let text = |lines: &[&str]| lines.iter().map(|l| format!("{l}\n")).collect::<String>();
    let indented = |lines: &[&str]| {
        lines
            .iter()
            .map(|l| format!("    {l}\n"))
            .collect::<String>()
    };
    let lock = |bumped: usize| {
        (1..=5)
            .map(|n| format!("dep-{n} = {}\n", if n <= bumped { "2.0" } else { "1.0" }))
            .collect::<String>()
    };

    let core = [
        "fn alpha() {}",
        "fn beta() {}",
        "fn gamma() {}",
        "fn delta() {}",
        "fn epsilon() {}",
        "fn zeta() {}",
    ];
    fx.write("src/core.rs", &text(&core))?;
    fx.write("README.md", "# Survival\n\nA fixture.\nFor blame.\n")?;
    fx.write("Cargo.lock", &lock(0))?;
    fx.commit(ALICE, "add core, readme and lockfile")?;

    let core = [
        "fn alpha() {}",
        "fn beta() {}",
        "fn bob_one() {}",
        "fn bob_two() {}",
        "fn epsilon() {}",
        "fn zeta() {}",
        "fn bob_three() {}",
    ];
    let util = [
        "pub fn u1() {}",
        "pub fn u2() {}",
        "pub fn u3() {}",
        "pub fn u4() {}",
    ];
    fx.write("src/core.rs", &text(&core))?;
    fx.write("src/util.rs", &text(&util))?;
    fx.commit(BOB, "rework core, add util")?;

    let extra = ["fn k1() {}", "fn k2() {}", "fn k3() {}"];
    fx.write("src/extra.rs", &text(&extra))?;
    fx.write(
        "README.md",
        "# Survival\n\nA fixture.\nFor blame.\nMore.\nAnd more.\n",
    )?;
    fx.write("Cargo.lock", &lock(3))?;
    fx.commit(CAROL_PLAIN, "extra, docs and a bump")?;

    std::fs::create_dir_all(fx.root.join("lib")).context("creating lib")?;
    fx.git(&["mv", "src/util.rs", "lib/util.rs"])?;
    fx.commit(ALICE_UPPER, "move util")?;

    let util = [
        "pub fn u1() {}",
        "pub fn carol_two() {}",
        "pub fn u3() {}",
        "pub fn u4() {}",
    ];
    fx.write("lib/util.rs", &text(&util))?;
    fx.commit(CAROL_PLAIN, "rework util")?;

    let mut core_formatted: Vec<&str> = core.to_vec();
    core_formatted.push("fn bob_four() {}");
    fx.write("src/core.rs", &indented(&core_formatted))?;
    fx.write("lib/util.rs", &indented(&util))?;
    fx.write("src/extra.rs", &indented(&extra))?;
    fx.write(
        "README.md",
        "# Survival\n\nA fixture.\nFor blame.\nMore.\nAnd more.\nFormatted.\n",
    )?;
    fx.commit(BOB, "reformat")?;

    let mut tabbed = indented(&core_formatted);
    tabbed = tabbed.replacen(
        "    fn alpha() {}\n    fn beta() {}\n",
        "\tfn alpha() {}\n\tfn beta() {}\n\t// tabs from here on\n",
        1,
    );
    fx.write("src/core.rs", &tabbed)?;
    fx.commit(CAROL_PLAIN, "style: tabs in the header")?;
    let rename = fx
        .git(&["rev-parse", "--short=12", "HEAD"])?
        .trim()
        .to_string();

    fx.write(".git-blame-ignore-revs", &format!("# tabs\n{rename}\n"))?;
    fx.commit(BOB, "ignore the tabs in blame")?;
    let base = fx.git(&["rev-parse", "HEAD"])?.trim().to_string();

    fx.git(&["checkout", "-q", "-b", "side", &base])?;
    let extra = ["fn k1() {}", "fn k2() {}", "fn k3() {}", "fn k4() {}"];
    fx.write("src/extra.rs", &indented(&extra))?;
    fx.commit(CAROL_PLAIN, "extend extra")?;

    fx.git(&["checkout", "-q", "main"])?;
    let util = [
        "pub fn u1() {}",
        "pub fn carol_two() {}",
        "pub fn u3() {}",
        "pub fn u4() {}",
        "pub fn u5() {}",
    ];
    fx.write("lib/util.rs", &indented(&util))?;
    fx.commit(ALICE, "extend util")?;

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
    fx.day += 1;

    std::fs::remove_file(fx.root.join("src/extra.rs")).context("moving src/extra.rs")?;
    let moved = ["fn k1() {}", "fn bob_k2() {}", "fn k3() {}", "fn k4() {}"];
    fx.write("lib/extra.rs", &indented(&moved))?;
    fx.commit(BOB, "move extra into lib, rename k2")?;
    Ok(())
}

fn rhythm(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("rhythm"))?;
    let commits: [(Author, &[&str], &str, &str); 6] = [
        (
            ALICE,
            &["feat: first page"],
            "1704080700 +0530",
            "1704080700 +0530",
        ),
        (
            ALICE,
            &["fix(page): typo"],
            "1704219000 +0530",
            "1704219000 +0530",
        ),
        (
            BOB,
            &["docs: readme"],
            "1704531900 -0700",
            "1704531900 -0700",
        ),
        (
            ALICE,
            &["refactor!: split page"],
            "1704290400 +0000",
            "1704621600 +0000",
        ),
        (
            BOB,
            &["Revert \"docs: readme\""],
            "1704628800 +0000",
            "1704628800 +0000",
        ),
        (
            CAROL_PLAIN,
            &["WIP"],
            "1704697200 +0100",
            "1704697200 +0100",
        ),
    ];
    for (n, (author, message, authored, committed)) in commits.iter().enumerate() {
        fx.write("page.txt", &format!("{n}\n"))?;
        fx.commit_dated(*author, message, authored, committed)?;
    }
    Ok(())
}

fn empty(dir: &Path) -> Result<()> {
    Fx::init(dir.join("empty"))?;
    Ok(())
}

fn detached(dir: &Path) -> Result<()> {
    let mut fx = Fx::init(dir.join("detached"))?;
    fx.commit_touching(ALICE, "one", &[("a.txt", "1\n")])?;
    let first = fx.git(&["rev-parse", "HEAD"])?.trim().to_string();
    fx.commit_touching(ALICE, "two", &[("a.txt", "2\n")])?;
    fx.git(&["checkout", "-q", "--detach", &first])?;
    Ok(())
}

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

fn tags(dir: &Path) -> Result<()> {
    let src = dir.join("merges");
    let dst = dir.join("tags");
    if dst.exists() {
        std::fs::remove_dir_all(&dst)?;
    }
    let out = Command::new("git")
        .args(["clone", "-q"])
        .arg(&src)
        .arg(&dst)
        .output()
        .context("cloning the tags fixture")?;
    if !out.status.success() {
        bail!(
            "tags clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let fx = Fx { root: dst, day: 0 };
    fx.git(&["remote", "remove", "origin"])?;
    fx.git(&["tag", "v1.0.0", "HEAD~2"])?;
    fx.git_env(
        &["tag", "-a", "v1.1.0", "-m", "v1.1.0", "HEAD"],
        &[
            ("GIT_COMMITTER_NAME", ALICE.name.to_string()),
            ("GIT_COMMITTER_EMAIL", ALICE.email.to_string()),
            ("GIT_COMMITTER_DATE", format!("{} +0000", EPOCH + 30 * DAY)),
        ],
    )?;
    fx.git(&["tag", "tools-0.1.0", "HEAD~1"])?;
    Ok(())
}

struct Crafted {
    fx: Fx,
    at: i64,
}

const CRAFTED_PEOPLE: &[(&str, &str, &str)] = &[
    ("ada", "Ada Lovelace", "ada@example.com"),
    ("ada2", "Ada Lovelace", "ada@work.example"),
    ("bob", "Bob", "12+bob@users.noreply.github.com"),
    (
        "bot",
        "dependabot[bot]",
        "49699333+dependabot[bot]@users.noreply.github.com",
    ),
    ("cara", "Cara", "cara@example.com"),
];

enum Content {
    Text(String),
    Bytes(&'static [u8]),
    Gone,
}

fn numbered(n: usize, word: &str) -> String {
    (0..n).map(|i| format!("{word} {i}\n")).collect()
}

impl Crafted {
    fn env(by: &str, at: i64, zone: &str) -> Result<Vec<(&'static str, String)>> {
        let Some((_, name, email)) = CRAFTED_PEOPLE.iter().find(|(k, _, _)| *k == by) else {
            bail!("no one called {by}");
        };
        let stamp = format!("{at} {zone}");
        Ok(vec![
            ("GIT_AUTHOR_NAME", name.to_string()),
            ("GIT_AUTHOR_EMAIL", email.to_string()),
            ("GIT_AUTHOR_DATE", stamp.clone()),
            ("GIT_COMMITTER_NAME", name.to_string()),
            ("GIT_COMMITTER_EMAIL", email.to_string()),
            ("GIT_COMMITTER_DATE", stamp),
        ])
    }

    fn commit(
        &mut self,
        by: &str,
        subject: &str,
        files: Vec<(String, Content)>,
        step: i64,
        zone: &str,
    ) -> Result<()> {
        for (path, content) in files {
            let at = self.fx.root.join(&path);
            match content {
                Content::Gone => {
                    if at.exists() {
                        std::fs::remove_file(&at)?;
                    }
                }
                Content::Text(text) => self.fx.write(&path, &text)?,
                Content::Bytes(bytes) => {
                    if let Some(parent) = at.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&at, bytes)?;
                }
            }
        }
        self.at += step;
        self.fx.git(&["add", "-A"])?;
        self.fx.git_env(
            &["commit", "-q", "--allow-empty", "-m", subject],
            &Self::env(by, self.at, zone)?,
        )?;
        Ok(())
    }
}

fn text(path: &str, body: String) -> (String, Content) {
    (path.to_string(), Content::Text(body))
}

fn gone(path: &str) -> (String, Content) {
    (path.to_string(), Content::Gone)
}

fn crafted(dir: &Path) -> Result<()> {
    const HOUR: i64 = 3600;
    let fx = Fx::init(dir.join("crafted"))?;
    let mut c = Crafted {
        fx,
        at: 1_650_000_000,
    };
    c.commit(
        "ada",
        "feat: start (#1)",
        vec![
            text("src/app.ts", numbered(20, "app")),
            text("src/util.ts", numbered(12, "util")),
            text("docs/README.md", numbered(5, "read")),
            text("package-lock.json", "{}\n".into()),
            (
                "logo.png".into(),
                Content::Bytes(&[137, 80, 78, 71, 0, 0, 1, 2]),
            ),
            text("constructor.js", numbered(3, "c")),
        ],
        0,
        "+0000",
    )?;
    c.commit(
        "cara",
        "docs: an old note",
        vec![text("docs/old.md", numbered(2, "old"))],
        200 * DAY,
        "+0000",
    )?;
    c.commit(
        "bob",
        "fix: bug in app (#12)",
        vec![
            text("src/app.ts", numbered(22, "app")),
            text("src/util.ts", numbered(13, "util")),
        ],
        150 * DAY,
        "+0000",
    )?;
    c.commit(
        "ada",
        "feat: names from far away",
        vec![
            text("src/é.ts", numbered(4, "e")),
            text("src/𝒜.ts", numbered(4, "a")),
            text("src/｡.ts", numbered(4, "dot")),
            text("src/Z.ts", numbered(1, "z")),
        ],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "cara",
        "docs: words",
        vec![text("docs/README.md", numbered(9, "read"))],
        HOUR,
        "+0530",
    )?;
    c.commit(
        "bot",
        "chore(deps): bump the lock (#14)",
        vec![text("package-lock.json", "{\"a\":1}\n".into())],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "ada",
        "refactor: move util (#7) and (#8)",
        vec![
            gone("src/util.ts"),
            text("lib/util.ts", numbered(13, "util")),
            text("src/app.ts", numbered(23, "app")),
        ],
        HOUR,
        "+0000",
    )?;
    for i in 0..7usize {
        let by = ["ada", "bob", "cara"].get(i % 3).copied().unwrap_or("ada");
        let mut files = vec![
            text("src/app.ts", numbered(24 + i, "app")),
            text("lib/util.ts", numbered(14 + i, "util")),
        ];
        if i % 2 == 0 {
            files.push(text("src/é.ts", numbered(5 + i, "e")));
        }
        if i % 3 == 0 {
            files.push(text("docs/README.md", numbered(10 + i, "read")));
        }
        let subject = if i == 4 {
            "feat: pair with a pull (#21) at the end  ".to_string()
        } else {
            format!("feat: pair {i}")
        };
        let zone = if i % 2 == 1 { "-0800" } else { "+0100" };
        c.commit(by, &subject, files, 1800 + i as i64 * 600, zone)?;
    }
    c.commit(
        "ada",
        "feat: a big file",
        vec![
            text("big.txt", numbered(30_000, "big")),
            text("dist/bundle.min.js", numbered(2, "min")),
        ],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "bob",
        "fix: same second a",
        vec![text("src/Z.ts", numbered(2, "z"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "cara",
        "fix: same second b",
        vec![text("docs/README.md", numbered(20, "read"))],
        0,
        "+0000",
    )?;
    c.commit(
        "ada",
        "chore: vendor drop",
        (0..60)
            .map(|i| text(&format!("vendor/x/f{i}.js"), numbered(2, &format!("v{i}"))))
            .collect(),
        HOUR,
        "+0000",
    )?;
    c.commit(
        "cara",
        "feat: a thing",
        vec![text("old/thing.js", numbered(3, "thing"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "ada",
        "revert: remove the thing",
        vec![gone("old/thing.js")],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "bob",
        "feat: deep",
        vec![text("a/b/c/deep.rs", numbered(3, "deep"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "cara",
        "perf: deeper",
        vec![
            text("a/b/c/deep.rs", numbered(4, "deep")),
            text("a/b/top.rs", numbered(1, "top")),
        ],
        HOUR,
        "+0000",
    )?;
    c.fx.git(&["checkout", "-q", "-b", "topic"])?;
    c.commit(
        "bob",
        "feat: on a branch",
        vec![text("src/app.ts", numbered(40, "app"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "bob",
        "docs: on a branch",
        vec![text("docs/README.md", numbered(21, "read"))],
        HOUR,
        "+0000",
    )?;
    c.fx.git(&["checkout", "-q", "main"])?;
    c.commit(
        "ada",
        "test: on main meanwhile",
        vec![text("src/app.test.ts", numbered(3, "test"))],
        HOUR,
        "+0000",
    )?;
    c.at += HOUR;
    c.fx.git_env(
        &[
            "merge",
            "--no-ff",
            "-q",
            "topic",
            "-m",
            "Merge pull request #13 from acme/topic",
        ],
        &Crafted::env("ada", c.at, "+0000")?,
    )?;
    c.commit(
        "ada2",
        "feat: from another address",
        vec![text("src/app.ts", numbered(41, "app"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "cara",
        "style: late at night",
        vec![text("src/app.ts", numbered(42, "app"))],
        HOUR,
        "-0800",
    )?;
    link(&c.fx)?;
    c.commit("bob", "build: a link", vec![], HOUR, "+0000")?;
    c.commit("ada", "chore: empty", vec![], HOUR, "+0000")?;
    c.commit(
        "cara",
        "feat: again",
        vec![text("src/again.ts", numbered(2, "again"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "bob",
        "fix: again gone",
        vec![gone("src/again.ts")],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "cara",
        "feat: again back (#30)",
        vec![text("src/again.ts", numbered(3, "again"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "ada",
        "feat: x old",
        vec![text("x/old.ts", numbered(5, "xold"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "ada",
        "refactor: x to y",
        vec![gone("x/old.ts"), text("y/old.ts", numbered(5, "xold"))],
        HOUR,
        "+0000",
    )?;
    c.commit(
        "bob",
        "feat: a new x old",
        vec![text("x/old.ts", numbered(2, "new"))],
        HOUR,
        "+0000",
    )?;
    for i in 0..30usize {
        let by = ["bob", "cara", "ada", "bot"]
            .get(i % 4)
            .copied()
            .unwrap_or("bob");
        let subject = match i % 5 {
            0 => format!("feat: step {i} (#{})", 1_234_560 + i),
            1 => format!("fix: step {i} (#{})", 12_345_670 + i),
            2 => format!("Merge pull request #{}x from a/b", 900 + i),
            3 => format!("chore: step {i}"),
            _ => format!("docs: (#{}) step {i}", 40 + i),
        };
        let mut files = vec![text(
            &format!("src/steps/s{}.ts", i % 5),
            numbered(i + 1, "step"),
        )];
        if i % 2 == 0 {
            files.push(text("src/app.ts", numbered(44 + i, "app")));
        }
        if i % 3 == 0 {
            files.push(text("lib/util.ts", numbered(30 + i, "util")));
        }
        let zone = if i % 5 == 0 { "+1400" } else { "-1100" };
        c.commit(by, &subject, files, 900 + (i % 4) as i64 * 1800, zone)?;
    }
    c.commit(
        "ada",
        "fix: last (#31)",
        vec![
            text("src/app.ts", numbered(80, "app")),
            text("y/old.ts", numbered(6, "xold")),
        ],
        HOUR,
        "+0000",
    )?;
    Ok(())
}

#[cfg(unix)]
fn link(fx: &Fx) -> Result<()> {
    std::os::unix::fs::symlink("src/app.ts", fx.root.join("link")).context("making the link")
}

#[cfg(windows)]
fn link(fx: &Fx) -> Result<()> {
    fx.git(&["config", "core.symlinks", "true"])?;
    std::os::windows::fs::symlink_file("src/app.ts", fx.root.join("link"))
        .context("making the link (needs Developer Mode or an administrator)")
}
