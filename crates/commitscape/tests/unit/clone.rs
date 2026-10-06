use super::*;

fn run(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .env("GIT_CEILING_DIRECTORIES", dir.parent().unwrap_or(dir))
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct Origin {
    work: PathBuf,
    url: String,
}

impl Origin {
    fn new(root: &Path) -> Self {
        let bare = root.join("remote.git");
        let work = root.join("author");
        std::fs::create_dir_all(&bare).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        run(&bare, &["init", "--quiet", "--bare"]);
        run(&work, &["init", "--quiet"]);
        let url = format!("file://{}", bare.display());
        run(&work, &["remote", "add", "origin", &url]);
        let remote = Origin { work, url };
        remote.commit("first");
        remote
    }

    fn commit(&self, text: &str) -> String {
        std::fs::write(self.work.join("file.txt"), text).unwrap();
        run(&self.work, &["add", "file.txt"]);
        run(&self.work, &["commit", "--quiet", "-m", text]);
        run(&self.work, &["push", "--quiet", "origin", "HEAD:main"]);
        run(&self.work, &["rev-parse", "HEAD"])
    }
}

fn head(dir: &Path) -> String {
    run(dir, &["rev-parse", "HEAD"])
}

#[test]
fn a_first_clone_lands_in_place_with_nothing_left_over() {
    let root = tempfile::tempdir().unwrap();
    let remote = Origin::new(root.path());
    let dir = root.path().join("clones/o/n");
    clone_into(&remote.url, &dir, Clone::Full, "o/n").unwrap();
    assert_eq!(head(&dir), head(&remote.work));
    assert!(!root.path().join("clones/o/.n.cloning").exists());
}

#[test]
fn a_healthy_clone_is_reused_and_fetches_new_commits() {
    let root = tempfile::tempdir().unwrap();
    let remote = Origin::new(root.path());
    let dir = root.path().join("clones/o/n");
    clone_into(&remote.url, &dir, Clone::Full, "o/n").unwrap();
    std::fs::write(dir.join("kept.txt"), "still here").unwrap();
    let newer = remote.commit("second");
    clone_into(&remote.url, &dir, Clone::Full, "o/n").unwrap();
    assert_eq!(head(&dir), newer);
    assert!(dir.join("kept.txt").exists());
}

#[test]
fn a_broken_clone_is_cloned_again_without_touching_the_folder_around_it() {
    let root = tempfile::tempdir().unwrap();
    let remote = Origin::new(root.path());
    let outer = root.path().join("outer");
    std::fs::create_dir_all(&outer).unwrap();
    run(&outer, &["init", "--quiet"]);
    run(&outer, &["remote", "add", "origin", &remote.url]);
    run(&outer, &["fetch", "--quiet", "origin"]);
    run(&outer, &["remote", "set-head", "origin", "main"]);
    std::fs::write(outer.join("mine.txt"), "committed").unwrap();
    run(&outer, &["add", "mine.txt"]);
    run(&outer, &["commit", "--quiet", "-m", "mine"]);
    std::fs::write(outer.join("mine.txt"), "uncommitted work").unwrap();

    let dir = outer.join("clones/o/n");
    clone_into(&remote.url, &dir, Clone::Full, "o/n").unwrap();
    std::fs::remove_file(dir.join(".git/HEAD")).unwrap();
    std::fs::remove_dir_all(dir.join(".git/refs")).unwrap();
    std::fs::create_dir_all(dir.join(".git/refs")).unwrap();

    clone_into(&remote.url, &dir, Clone::Full, "o/n").unwrap();
    assert_eq!(head(&dir), head(&remote.work));
    assert_eq!(
        std::fs::read_to_string(outer.join("mine.txt")).unwrap(),
        "uncommitted work"
    );
}

#[test]
fn a_clone_killed_part_way_does_not_spoil_the_next_run() {
    let root = tempfile::tempdir().unwrap();
    let remote = Origin::new(root.path());
    let dir = root.path().join("clones/o/n");
    let temp = root.path().join("clones/o/.n.cloning");
    std::fs::create_dir_all(temp.join(".git/objects")).unwrap();
    std::fs::write(temp.join(".git/config"), "half").unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("stray.txt"), "from a killed clone").unwrap();

    clone_into(&remote.url, &dir, Clone::Full, "o/n").unwrap();
    assert_eq!(head(&dir), head(&remote.work));
    assert!(!dir.join("stray.txt").exists());
    assert!(!temp.exists());
}

#[test]
fn a_failed_clone_leaves_the_earlier_clone_alone() {
    let root = tempfile::tempdir().unwrap();
    let remote = Origin::new(root.path());
    let dir = root.path().join("clones/o/n");
    clone_into(&remote.url, &dir, Clone::Full, "o/n").unwrap();
    std::fs::remove_file(dir.join(".git/HEAD")).unwrap();
    let missing = format!("file://{}", root.path().join("missing.git").display());
    assert!(clone_into(&missing, &dir, Clone::Full, "o/n").is_err());
    assert!(dir.join(".git").exists());
    assert!(!root.path().join("clones/o/.n.cloning").exists());

    let fresh = root.path().join("clones/o/other");
    assert!(clone_into(&missing, &fresh, Clone::Full, "o/other").is_err());
    assert!(!fresh.exists());
}
