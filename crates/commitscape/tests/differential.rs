#![allow(clippy::expect_used)]
#![allow(clippy::indexing_slicing)]

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::Duration;

use commitscape_core::SignatureId;
use commitscape_report::pack::{read_pack, write_pack, Pack};
use serde_json::Value;

const ANCHOR: &str = "1800000000";
const KEY: &str = "acme/differential";
const BULK: &str = "4";

const PEOPLE: [(&str, &str); 6] = [
    ("Ada", "ada@example.com"),
    ("Ada L", "ada@old.example.com"),
    ("Pat", "pat@example.com"),
    ("Quinn", "quinn@example.com"),
    ("Ren", "ren@example.com"),
    (
        "dependabot[bot]",
        "49699333+dependabot[bot]@users.noreply.github.com",
    ),
];

const PATHS: [&str; 10] = [
    "src/a.rs",
    "src/b.rs",
    "src/deep/c.rs",
    "docs/guide.md",
    "e.py",
    "gen/f.gen",
    "vendor/v.js",
    "Cargo.lock",
    "README.md",
    "src/deep/er/d.rs",
];

const SUBJECTS: [&str; 7] = [
    "feat: more",
    "fix: a bug",
    "chore: tidy",
    "docs: words",
    "refactor: move",
    "update",
    "Revert \"fix: a bug\"",
];

const ATTRIBUTES: [&str; 5] = [
    "*.gen linguist-generated",
    "vendor/** linguist-vendored",
    "docs/** linguist-documentation",
    "e.py linguist-generated",
    "src/deep/** linguist-vendored",
];

const MAILMAP: [&str; 4] = [
    "Ada <ada@example.com> <ada@old.example.com>",
    "Pat Smith <pat@example.com>",
    "Quinn <quinn@example.com> Ren <ren@example.com>",
    "Ada <ada@example.com>",
];

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        usize::try_from(self.next() % (n.max(1) as u64)).unwrap_or(0)
    }

    fn one_in(&mut self, n: usize) -> bool {
        self.below(n) == 0
    }

    fn pick<'a, T>(&mut self, from: &'a [T]) -> &'a T {
        &from[self.below(from.len())]
    }
}

struct Repo {
    dir: PathBuf,
    clock: u64,
    sides: usize,
    moved: usize,
}

impl Repo {
    fn new(dir: PathBuf) -> Repo {
        std::fs::create_dir_all(&dir).expect("a folder");
        let repo = Repo {
            dir,
            clock: 1_600_000_000,
            sides: 0,
            moved: 0,
        };
        repo.git(&["init", "-q", "-b", "main"], PEOPLE[0]);
        repo
    }

    fn run(&self, args: &[&str], who: (&str, &str)) -> Output {
        let date = format!("@{} +0000", self.clock);
        Command::new("git")
            .current_dir(&self.dir)
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_COUNT", "2")
            .env("GIT_CONFIG_KEY_0", "gc.auto")
            .env("GIT_CONFIG_VALUE_0", "0")
            .env("GIT_CONFIG_KEY_1", "maintenance.auto")
            .env("GIT_CONFIG_VALUE_1", "false")
            .env("GIT_AUTHOR_NAME", who.0)
            .env("GIT_AUTHOR_EMAIL", who.1)
            .env("GIT_COMMITTER_NAME", who.0)
            .env("GIT_COMMITTER_EMAIL", who.1)
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .output()
            .expect("git")
    }

    fn git(&self, args: &[&str], who: (&str, &str)) -> String {
        let out = self.run(args, who);
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn tracked(&self) -> Vec<String> {
        self.git(&["ls-files"], PEOPLE[0])
            .lines()
            .filter(|p| !p.starts_with('.'))
            .map(str::to_string)
            .collect()
    }

    fn depth(&self) -> usize {
        self.git(
            &["rev-list", "--first-parent", "--count", "HEAD"],
            PEOPLE[0],
        )
        .parse()
        .unwrap_or(0)
    }

    fn write(&self, path: &str, text: &str) {
        let at = self.dir.join(path);
        if let Some(parent) = at.parent() {
            std::fs::create_dir_all(parent).expect("a folder");
        }
        std::fs::write(at, text).expect("a file");
    }

    fn edit(&self, rng: &mut Rng, path: &str) {
        let at = self.dir.join(path);
        let mut lines: Vec<String> = std::fs::read_to_string(&at)
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect();
        if lines.is_empty() || rng.one_in(8) {
            lines = (0..1 + rng.below(12))
                .map(|_| format!("let v{} = {};", rng.below(50), rng.below(1000)))
                .collect();
        } else {
            for _ in 0..1 + rng.below(4) {
                let at = rng.below(lines.len() + 1);
                let line = format!("let w{} = {};", rng.below(50), rng.below(1000));
                match rng.below(3) {
                    0 if at < lines.len() => lines[at] = line,
                    1 if at < lines.len() && lines.len() > 1 => {
                        lines.remove(at);
                    }
                    _ => lines.insert(at, line),
                }
            }
        }
        let mut text = lines.join("\n");
        text.push('\n');
        self.write(path, &text);
    }

    fn commit(&mut self, rng: &mut Rng, subject: &str, who: (&str, &str)) {
        self.clock += 3600 + rng.below(86_400) as u64;
        self.git(&["add", "-A"], who);
        self.git(&["commit", "-q", "--allow-empty", "-m", subject], who);
    }

    fn change(&mut self, rng: &mut Rng, avoid: &BTreeSet<String>) -> BTreeSet<String> {
        let mut touched = BTreeSet::new();
        for _ in 0..1 + rng.below(3) {
            let path = (*rng.pick(&PATHS)).to_string();
            if avoid.contains(&path) {
                continue;
            }
            if self.dir.join(&path).exists() && rng.one_in(7) {
                std::fs::remove_file(self.dir.join(&path)).expect("a file");
            } else {
                self.edit(rng, &path);
            }
            touched.insert(path);
        }
        let who = *rng.pick(&PEOPLE);
        let subject = *rng.pick(&SUBJECTS);
        self.commit(rng, subject, who);
        touched
    }

    fn rename(&mut self, rng: &mut Rng) -> bool {
        let tracked = self.tracked();
        if tracked.is_empty() {
            return false;
        }
        let from = rng.pick(&tracked).clone();
        let to = match PATHS
            .iter()
            .find(|p| !self.dir.join(p).exists() && rng.one_in(2))
        {
            Some(p) => (*p).to_string(),
            None => {
                self.moved += 1;
                format!("src/moved/m{}.rs", self.moved)
            }
        };
        if let Some(parent) = self.dir.join(&to).parent() {
            std::fs::create_dir_all(parent).expect("a folder");
        }
        self.git(&["mv", &from, &to], PEOPLE[0]);
        if rng.one_in(2) {
            self.edit(rng, &to);
        }
        let who = *rng.pick(&PEOPLE);
        self.commit(rng, "refactor: rename", who);
        true
    }

    fn listed(&mut self, rng: &mut Rng, file: &str, from: &[&str]) {
        let chosen: Vec<&str> = from.iter().copied().filter(|_| rng.one_in(2)).collect();
        if chosen.is_empty() {
            let _ = std::fs::remove_file(self.dir.join(file));
        } else {
            self.write(file, &format!("{}\n", chosen.join("\n")));
        }
        let who = *rng.pick(&PEOPLE);
        self.commit(rng, "chore: settings", who);
    }

    fn merge(&mut self, rng: &mut Rng) {
        self.sides += 1;
        let side = format!("side{}", self.sides);
        self.git(&["checkout", "-q", "-b", &side], PEOPLE[0]);
        let mut touched = BTreeSet::new();
        for _ in 0..1 + rng.below(2) {
            touched.extend(self.change(rng, &BTreeSet::new()));
        }
        self.git(&["checkout", "-q", "main"], PEOPLE[0]);
        if rng.one_in(2) {
            self.change(rng, &touched);
        }
        self.clock += 600;
        let who = *rng.pick(&PEOPLE);
        let message = format!("Merge branch '{side}'");
        let merged = self.run(&["merge", "-q", "--no-ff", "-m", &message, &side], who);
        if !merged.status.success() {
            self.git(&["merge", "--abort"], who);
        }
        self.git(&["branch", "-q", "-D", &side], PEOPLE[0]);
    }

    fn force_push(&mut self, rng: &mut Rng) -> bool {
        let depth = self.depth();
        if depth < 3 {
            return false;
        }
        let back = 1 + rng.below((depth - 2).min(3));
        self.git(
            &["reset", "-q", "--hard", &format!("HEAD~{back}")],
            PEOPLE[0],
        );
        self.git(&["clean", "-q", "-fd"], PEOPLE[0]);
        self.change(rng, &BTreeSet::new());
        true
    }
}

fn commitscape(args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_commitscape"))
        .env("COMMITSCAPE_SITE", "http://127.0.0.1:9")
        .env("COMMITSCAPE_TELEMETRY", "0")
        .env("COMMITSCAPE_THREADS", "2")
        .stdin(Stdio::null())
        .args(args)
        .output()
        .expect("running commitscape")
}

fn ok(run: Output, what: &str) -> String {
    assert!(
        run.status.success(),
        "{what}: {}",
        String::from_utf8_lossy(&run.stderr)
    );
    String::from_utf8_lossy(&run.stdout).into_owned()
}

fn rows(path: &Path) -> Vec<Vec<String>> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| l.split('\t').map(str::to_string).collect())
        .collect()
}

fn sum(array: &str) -> i64 {
    array
        .trim_matches(|c| c == '{' || c == '}')
        .split(',')
        .filter_map(|n| n.parse::<i64>().ok())
        .sum()
}

#[derive(Clone)]
struct Live {
    lineage: String,
    kept: bool,
    frontier: Vec<String>,
    mark: String,
}

#[derive(Default, Debug, PartialEq, Clone)]
struct Stored {
    commits: BTreeMap<String, Vec<String>>,
    lines: BTreeMap<String, (i64, i64)>,
    folders: BTreeMap<String, (String, String)>,
    files: BTreeMap<String, Vec<String>>,
    file_paths: BTreeSet<(String, String)>,
    persons: BTreeSet<Vec<String>>,
    people: BTreeSet<Vec<String>>,
    head_files: BTreeSet<Vec<String>>,
}

impl Stored {
    fn add_lines(&mut self, sha: &str, added: &str, removed: &str) {
        if added == "\\N" || !self.commits.contains_key(sha) {
            return;
        }
        self.lines
            .insert(sha.to_string(), (sum(added), sum(removed)));
    }

    fn load(&mut self, live: &mut Option<Live>, out: &Path) {
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(out.join("manifest.json")).expect("a manifest"))
                .expect("JSON");
        let full = manifest["full"] == true;
        let lineage = manifest["lineage"].as_str().unwrap_or("").to_string();
        if full {
            *self = Stored::default();
        } else {
            assert_eq!(
                live.as_ref().map(|l| l.lineage.as_str()),
                Some(lineage.as_str()),
                "an export of what is new needs the live Stored Index it was made after"
            );
        }
        for row in rows(&out.join("commits.tsv")) {
            self.commits
                .entry(row[0].clone())
                .or_insert_with(|| row[1..11].to_vec());
        }
        for row in rows(&out.join("commits.tsv")) {
            self.add_lines(&row[0], &row[11], &row[12]);
        }
        if !full {
            for row in rows(&out.join("mainline.tsv")) {
                if let Some(c) = self.commits.get_mut(&row[0]) {
                    c[5].clone_from(&row[1]);
                    c[6].clone_from(&row[2]);
                }
            }
            for row in rows(&out.join("lines.tsv")) {
                self.add_lines(&row[0], &row[1], &row[2]);
            }
        }
        for row in rows(&out.join("folders.tsv")) {
            self.folders
                .entry(row[0].clone())
                .or_insert((row[1].clone(), row[2].clone()));
        }
        for row in rows(&out.join("files.tsv")) {
            if self.folders.contains_key(&row[2]) {
                self.files.insert(row[0].clone(), row[1..].to_vec());
            }
        }
        for row in rows(&out.join("file_paths.tsv")) {
            self.file_paths.insert((row[0].clone(), row[1].clone()));
        }
        self.persons = rows(&out.join("persons.tsv")).into_iter().collect();
        self.people = rows(&out.join("people.tsv")).into_iter().collect();
        self.head_files = rows(&out.join("head_files.tsv")).into_iter().collect();
        *live = Some(Live {
            lineage,
            kept: manifest["kept"] == true,
            frontier: manifest["frontier"]
                .as_array()
                .map(|f| {
                    f.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            mark: manifest["mark"].as_str().unwrap_or("").to_string(),
        });
    }
}

struct Site {
    dir: PathBuf,
    accounts: PathBuf,
    runs: usize,
}

impl Site {
    fn args(&mut self, cache: &Path, repo: &Path, live: Option<&Live>) -> (Vec<String>, PathBuf) {
        self.runs += 1;
        let out = self.dir.join(format!("out{}", self.runs));
        let mut args: Vec<String> = [
            "build",
            "--offline",
            "--anchor",
            ANCHOR,
            "--max-changeset-size",
            BULK,
            "--cache-key",
            KEY,
        ]
        .map(str::to_string)
        .to_vec();
        for (flag, path) in [
            ("--cache-dir", cache),
            ("--accounts", &self.accounts),
            ("--out", &out),
        ] {
            args.push(flag.to_string());
            args.push(path.to_string_lossy().into_owned());
        }
        if let Some(l) = live.filter(|l| l.kept && !l.frontier.is_empty()) {
            let frontier = self.dir.join(format!("frontier{}", self.runs));
            std::fs::write(&frontier, l.frontier.join("\n")).expect("a frontier");
            args.push("--after".to_string());
            args.push(frontier.to_string_lossy().into_owned());
            args.push("--lineage".to_string());
            args.push(l.lineage.clone());
            if !l.mark.is_empty() {
                args.push("--since".to_string());
                args.push(l.mark.clone());
            }
        }
        args.push("--".to_string());
        args.push(repo.to_string_lossy().into_owned());
        (args, out)
    }

    fn build(&mut self, cache: &Path, repo: &Path, live: Option<&Live>) -> PathBuf {
        let (args, out) = self.args(cache, repo, live);
        ok(commitscape(&args), "build");
        out
    }

    fn killed(&mut self, cache: &Path, repo: &Path, live: Option<&Live>, after: Duration) {
        let (args, out) = self.args(cache, repo, live);
        let mut child = Command::new(env!("CARGO_BIN_EXE_commitscape"))
            .env("COMMITSCAPE_SITE", "http://127.0.0.1:9")
            .env("COMMITSCAPE_TELEMETRY", "0")
            .env("COMMITSCAPE_THREADS", "2")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .args(&args)
            .spawn()
            .expect("running commitscape");
        std::thread::sleep(after);
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(out);
    }

    fn surviving(&self, cache: &Path, repo: &Path) -> Value {
        let args: Vec<String> = [
            "surviving",
            "--everyone",
            "--offline",
            "--budget-seconds",
            "600",
            "--max-changeset-size",
            BULK,
            "--cache-key",
            KEY,
            "--cache-dir",
            &cache.to_string_lossy(),
            "--accounts",
            &self.accounts.to_string_lossy(),
            &repo.to_string_lossy(),
        ]
        .map(|s| s.to_string())
        .to_vec();
        let mut answer: Value =
            serde_json::from_str(&ok(commitscape(&args), "surviving")).expect("JSON");
        for person in answer["people"].as_array_mut().into_iter().flatten() {
            person["seconds"] = Value::Null;
        }
        answer
    }
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("a folder");
    for entry in std::fs::read_dir(from).expect("a folder").flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type().expect("a type").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("a copy");
        }
    }
}

type Tables = BTreeMap<&'static str, BTreeSet<String>>;

#[derive(PartialEq)]
struct Names {
    signatures: HashMap<String, String>,
    persons: HashMap<String, String>,
    files: HashMap<String, String>,
    paths: Vec<Vec<u8>>,
}

impl Names {
    fn of(pack: &Pack) -> Names {
        let authors = &pack.index.authors;
        let mut wrote: HashMap<u32, (usize, String)> = HashMap::new();
        for c in pack.index.commits.iter() {
            let sha = c.id.to_hex();
            let e = wrote.entry(c.signature.0).or_insert((0, sha.clone()));
            e.0 += 1;
            if sha < e.1 {
                e.1 = sha;
            }
        }
        let signature = |s: SignatureId| {
            let name = authors.signature(s).map_or("?", |r| r.name);
            match wrote.get(&s.0) {
                Some((n, first)) => format!("{name}, {n} from {}", first.get(..8).unwrap_or("")),
                None => format!("{name}, none"),
            }
        };
        let signatures = (0..authors.signature_count())
            .map(|i| {
                let id = u32::try_from(i).unwrap_or(u32::MAX);
                (id.to_string(), signature(SignatureId(id)))
            })
            .collect();
        let persons = authors
            .iter()
            .map(|(id, a)| {
                let mut members: Vec<String> = a.signatures.iter().map(|s| signature(*s)).collect();
                members.sort();
                (id.0.to_string(), members.join(", "))
            })
            .collect();
        let files = pack
            .index
            .paths
            .iter()
            .map(|(id, path)| {
                let born = pack
                    .index
                    .file_history
                    .get(id.idx())
                    .map_or(0, |h| h.first_seen);
                (
                    id.0.to_string(),
                    format!("{}@{born}", String::from_utf8_lossy(path)),
                )
            })
            .collect();
        Names {
            signatures,
            persons,
            files,
            paths: pack
                .index
                .paths
                .path_names()
                .map(|(_, p)| p.to_vec())
                .collect(),
        }
    }

    fn named(map: &HashMap<String, String>, id: &str) -> String {
        map.get(id)
            .cloned()
            .unwrap_or_else(|| format!("unknown {id}"))
    }

    fn signature(&self, id: &str) -> String {
        Names::named(&self.signatures, id)
    }

    fn person(&self, id: &str) -> String {
        Names::named(&self.persons, id)
    }

    fn file(&self, id: &str) -> String {
        Names::named(&self.files, id)
    }

    fn changes(&self, files: &str, kinds: &str) -> String {
        let list = |a: &str| -> Vec<String> {
            a.trim_matches(|c| c == '{' || c == '}')
                .split(',')
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        };
        let mut pairs: Vec<String> = list(files)
            .iter()
            .zip(list(kinds))
            .map(|(f, k)| format!("{}:{k}", self.file(f)))
            .collect();
        pairs.sort();
        pairs.join(" ")
    }
}

fn add(tables: &mut Tables, table: &'static str, row: String) {
    tables.entry(table).or_default().insert(row);
}

fn loaded_rows(stored: &Stored, names: &Names) -> Tables {
    let mut t = Tables::new();
    for (sha, c) in &stored.commits {
        let row = format!(
            "{sha} {} {} {} [{}] {} {} {} {:?} [{}]",
            c[0],
            c[1],
            c[2],
            names.signature(&c[3]),
            c[4],
            c[5],
            c[6],
            c[7],
            names.changes(&c[8], &c[9])
        );
        add(&mut t, "commits", row);
    }
    for (sha, (a, r)) in &stored.lines {
        add(&mut t, "lines", format!("{sha} +{a} -{r}"));
    }
    let mut used: BTreeSet<&String> = stored.files.values().filter_map(|f| f.get(1)).collect();
    let mut walk: Vec<&String> = used.iter().copied().collect();
    while let Some(path) = walk.pop() {
        if let Some((parent, _)) = stored.folders.get(path) {
            if used.insert(parent) {
                walk.push(parent);
            }
        }
    }
    for path in used {
        if let Some((parent, depth)) = stored.folders.get(path) {
            add(&mut t, "folders", format!("{path:?} {parent:?} {depth}"));
        }
    }
    for (id, f) in &stored.files {
        add(
            &mut t,
            "files",
            format!("[{}] {}", names.file(id), f.join(" ")),
        );
    }
    for (id, path) in &stored.file_paths {
        add(&mut t, "file_paths", format!("[{}] {path}", names.file(id)));
    }
    for p in &stored.persons {
        add(
            &mut t,
            "persons",
            format!("[{}] {}", names.person(&p[0]), p[1..].join(" ")),
        );
    }
    for p in &stored.people {
        let row = format!(
            "[{}] {} [{}] {} {} {}",
            names.signature(&p[0]),
            p[1],
            names.person(&p[2]),
            p[3],
            p[5],
            p[6]
        );
        add(&mut t, "people", row);
        add(&mut t, "people colours", p[4].clone());
    }
    for h in &stored.head_files {
        add(
            &mut t,
            "head_files",
            format!("[{}] {}", names.file(&h[0]), h[1..].join(" ")),
        );
    }
    t
}

fn pack_rows(pack: &Pack, names: &Names) -> Tables {
    let mut t = Tables::new();
    let index = &pack.index;
    let mut order = Vec::new();
    for (i, c) in index.commits.iter().enumerate() {
        let mut changes: Vec<String> = index
            .changes_of(c)
            .iter()
            .map(|ch| {
                format!(
                    "{}:{:?}:{:?}",
                    names.file(&ch.file.0.to_string()),
                    ch.kind,
                    ch.lines().map(|d| (d.added, d.removed))
                )
            })
            .collect();
        changes.sort();
        let row = format!(
            "{} {} {} {} [{}] {:?} {:?} {:?} [{}] {:?} {:?}",
            c.id.to_hex(),
            c.time,
            c.offset_minutes,
            c.author_delta,
            names.signature(&c.signature.0.to_string()),
            c.kind,
            c.flags,
            index.subject_of(c),
            changes.join(" "),
            pack.mainline.get(i),
            pack.arrival.get(i)
        );
        add(&mut t, "commits", row);
        order.push(c.id.to_hex());
    }
    add(&mut t, "commit order", order.join(" "));
    for (id, a) in index.authors.iter() {
        let row = format!(
            "[{}] {} {:?}",
            names.person(&id.0.to_string()),
            a.name,
            a.traits
        );
        add(&mut t, "persons", row);
    }
    for (id, login) in &pack.logins {
        add(
            &mut t,
            "logins",
            format!("[{}] {login}", names.person(&id.to_string())),
        );
    }
    for (_, colour) in &pack.colours {
        add(&mut t, "colours", colour.to_string());
    }
    for d in &index.authors.suspected_duplicates {
        let mut same: Vec<String> = d.iter().map(|a| names.person(&a.0.to_string())).collect();
        same.sort();
        add(&mut t, "suspected duplicates", same.join(" | "));
    }
    for h in &index.head {
        let row = format!(
            "[{}] {:?} {} {} {} {} {} {} {:?}",
            names.file(&h.file.0.to_string()),
            index.paths.path_name(h.path).map(String::from_utf8_lossy),
            h.blob.to_hex(),
            h.bytes,
            h.loc,
            h.indent_levels,
            h.indent_mean,
            h.indent_stddev,
            h.class
        );
        add(&mut t, "head", row);
    }
    for (i, h) in index.file_history.iter().enumerate() {
        let row = format!(
            "[{}] {} {}",
            names.file(&i.to_string()),
            h.first_seen,
            h.last_touched
        );
        add(&mut t, "file history", row);
    }
    let rest = format!(
        "{} {} {:?} {} {:?} {} {} {} {:?} {:?} {:?} {:?} {} {:?} {}",
        pack.format,
        pack.name,
        pack.head,
        pack.anchor,
        pack.options,
        pack.lines_counted,
        pack.lines_complete,
        pack.lines_mainline,
        pack.releases,
        pack.release_commits,
        index.frontier,
        index.head_commit,
        index.history_truncated,
        index.span,
        index.schema_version
    );
    add(&mut t, "pack", rest);
    t
}

fn meta_rows(out: &Path, names: &Names) -> Tables {
    let mut meta: Value =
        serde_json::from_slice(&std::fs::read(out.join("meta.json")).expect("a meta"))
            .expect("JSON");
    let mut t = Tables::new();
    for person in meta["people"].as_array_mut().into_iter().flatten() {
        let id = person["person_id"].to_string();
        person["person_id"] = names.person(&id).into();
        add(&mut t, "people", person.to_string());
    }
    meta["people"] = Value::Null;
    add(&mut t, "meta", meta.to_string());
    t
}

fn surviving_rows(answer: &Value, names: &Names) -> Tables {
    let mut t = Tables::new();
    let mut rest = answer.clone();
    for person in answer["people"].as_array().into_iter().flatten() {
        let mut p = person.clone();
        p["id"] = names.person(&person["id"].to_string()).into();
        p["seconds"] = Value::Null;
        add(&mut t, "people", p.to_string());
    }
    rest["people"] = Value::Null;
    add(&mut t, "surviving", rest.to_string());
    t
}

fn differences(what: &str, a: &Tables, b: &Tables) -> String {
    let mut out = String::new();
    let empty = BTreeSet::new();
    let tables: BTreeSet<&&str> = a.keys().chain(b.keys()).collect();
    for table in tables {
        let (x, y) = (
            a.get(*table).unwrap_or(&empty),
            b.get(*table).unwrap_or(&empty),
        );
        if x == y {
            continue;
        }
        out.push_str(&format!("{what}, {table}:\n"));
        for row in x.difference(y).take(12) {
            out.push_str(&format!("  only incremental {row}\n"));
        }
        for row in y.difference(x).take(12) {
            out.push_str(&format!("  only clean       {row}\n"));
        }
    }
    out
}

fn pack_of(out: &Path) -> (Pack, Vec<u8>) {
    let mut pack = read_pack(&std::fs::read(out.join("pack.bin")).expect("a pack")).expect("read");
    pack.lineage = 0;
    let mut bytes = Vec::new();
    write_pack(&mut pack, &mut bytes).expect("written");
    (pack, bytes)
}

fn fields_apart(a: &Pack, b: &Pack) -> String {
    let (x, y) = (&a.index, &b.index);
    let fields = [
        ("paths", format!("{:?}", x.paths), format!("{:?}", y.paths)),
        (
            "authors",
            format!("{:?}", x.authors),
            format!("{:?}", y.authors),
        ),
        (
            "commits",
            format!("{:?}", x.commits),
            format!("{:?}", y.commits),
        ),
        (
            "changes",
            format!("{:?}", x.changes),
            format!("{:?}", y.changes),
        ),
        (
            "subjects",
            format!("{:?}", x.subjects),
            format!("{:?}", y.subjects),
        ),
        ("head", format!("{:?}", x.head), format!("{:?}", y.head)),
        (
            "file_history",
            format!("{:?}", x.file_history),
            format!("{:?}", y.file_history),
        ),
        ("repo", format!("{:?}", x.repo), format!("{:?}", y.repo)),
        (
            "frontier",
            format!("{:?}", x.frontier),
            format!("{:?}", y.frontier),
        ),
        (
            "logins",
            format!("{:?}", a.logins),
            format!("{:?}", b.logins),
        ),
        (
            "colours",
            format!("{:?}", a.colours),
            format!("{:?}", b.colours),
        ),
        (
            "mainline",
            format!("{:?}", (&a.mainline, &a.arrival)),
            format!("{:?}", (&b.mainline, &b.arrival)),
        ),
    ];
    fields
        .iter()
        .filter(|(_, p, q)| p != q)
        .map(|(name, p, q)| format!("{name}:\n  incremental {p}\n  clean       {q}"))
        .collect::<Vec<_>>()
        .join("\n")
}

struct Built<'a> {
    out: &'a Path,
    stored: &'a Stored,
    surviving: &'a Value,
}

fn compare(seed: u64, log: &[String], site: &mut Site, repo: &Path, built: &Built<'_>) {
    let clean_cache = site.dir.join("clean-cache");
    let _ = std::fs::remove_dir_all(&clean_cache);
    let clean_out = site.build(&clean_cache, repo, None);
    let mut clean = Stored::default();
    clean.load(&mut None, &clean_out);
    let clean_surviving = site.surviving(&clean_cache, repo);
    let (a, b) = (pack_of(built.out), pack_of(&clean_out));
    let (na, nb) = (Names::of(&a.0), Names::of(&b.0));
    let mut found = String::new();
    found.push_str(&differences(
        "the loaded rows",
        &loaded_rows(built.stored, &na),
        &loaded_rows(&clean, &nb),
    ));
    found.push_str(&differences(
        "the pack",
        &pack_rows(&a.0, &na),
        &pack_rows(&b.0, &nb),
    ));
    found.push_str(&differences(
        "meta.json",
        &meta_rows(built.out, &na),
        &meta_rows(&clean_out, &nb),
    ));
    found.push_str(&differences(
        "Surviving Lines",
        &surviving_rows(built.surviving, &na),
        &surviving_rows(&clean_surviving, &nb),
    ));
    let at = format!("seed {seed} after {}", log.join(", "));
    assert!(found.is_empty(), "{at}:\n{found}");
    if na == nb {
        let meta = |dir: &Path| std::fs::read(dir.join("meta.json")).expect("written");
        assert!(
            a.1 == b.1,
            "{at}: the pack's bytes differ in {}",
            fields_apart(&a.0, &b.0)
        );
        assert!(
            meta(built.out) == meta(&clean_out),
            "{at}: meta.json's bytes differ"
        );
    }
    let _ = std::fs::remove_dir_all(clean_out);
}

fn run(seed: u64, steps: usize) {
    let mut rng = Rng(seed);
    let dir = tempfile::tempdir_in(env!("CARGO_TARGET_TMPDIR")).expect("a temporary directory");
    let mut repo = Repo::new(dir.path().join("repo"));
    let accounts = dir.path().join("accounts.json");
    std::fs::write(
        &accounts,
        r#"{"pat@example.com":"pat-gh","quinn@example.com":"quinn-gh"}"#,
    )
    .expect("accounts");
    let mut site = Site {
        dir: dir.path().to_path_buf(),
        accounts,
        runs: 0,
    };
    let cache = dir.path().join("cache");
    let mut live: Option<Live> = None;
    let mut stored = Stored::default();
    let mut states: Vec<PathBuf> = Vec::new();
    let mut log: Vec<String> = Vec::new();
    repo.change(&mut rng, &BTreeSet::new());
    log.push("commit".to_string());
    let mut last: Option<(PathBuf, Value)> = None;
    for step in 0..steps {
        let roll = rng.below(100);
        let op = match roll {
            0..=34 => {
                repo.change(&mut rng, &BTreeSet::new());
                "commit"
            }
            35..=41 => {
                if !repo.rename(&mut rng) {
                    continue;
                }
                "rename"
            }
            42..=46 => {
                repo.listed(&mut rng, ".gitattributes", &ATTRIBUTES);
                ".gitattributes"
            }
            47..=51 => {
                repo.listed(&mut rng, ".mailmap", &MAILMAP);
                ".mailmap"
            }
            52..=58 => {
                repo.merge(&mut rng);
                "merge"
            }
            59..=64 => {
                if !repo.force_push(&mut rng) {
                    continue;
                }
                "force push"
            }
            65..=70 => {
                let after = Duration::from_millis(rng.below(400) as u64);
                site.killed(&cache, &repo.dir, live.as_ref(), after);
                "killed build"
            }
            71..=75 => {
                if states.is_empty() {
                    continue;
                }
                let from = rng.pick(&states).clone();
                let _ = std::fs::remove_dir_all(&cache);
                copy_dir(&from, &cache);
                "State restored"
            }
            _ => {
                let out = site.build(&cache, &repo.dir, live.as_ref());
                stored.load(&mut live, &out);
                let state = dir.path().join(format!("state{step}"));
                copy_dir(&cache, &state);
                states.push(state);
                let surviving = site.surviving(&cache, &repo.dir);
                if let Some((previous, _)) = last.replace((out, surviving)) {
                    let _ = std::fs::remove_dir_all(previous);
                }
                "build"
            }
        };
        log.push(op.to_string());
        if op == "build" {
            if let Some((out, surviving)) = &last {
                let built = Built {
                    out,
                    stored: &stored,
                    surviving,
                };
                compare(seed, &log, &mut site, &repo.dir, &built);
            }
        }
    }
    let out = site.build(&cache, &repo.dir, live.as_ref());
    stored.load(&mut live, &out);
    let surviving = site.surviving(&cache, &repo.dir);
    log.push("build".to_string());
    let built = Built {
        out: &out,
        stored: &stored,
        surviving: &surviving,
    };
    compare(seed, &log, &mut site, &repo.dir, &built);
}

#[test]
fn builds_after_random_histories_and_operations_write_what_a_clean_build_writes() {
    for seed in 1..=8 {
        run(seed, 30);
    }
}

#[test]
#[ignore = "hundreds of seeds; run with --ignored"]
fn many_seeds_of_random_histories_and_operations_write_what_a_clean_build_writes() {
    let from: u64 = std::env::var("SEEDS_FROM")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(100);
    let count: u64 = std::env::var("SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(200);
    for seed in from..from + count {
        eprintln!("seed {seed}");
        run(seed, 40);
    }
}
