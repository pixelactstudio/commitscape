use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt::Write as _;
use std::io::{BufWriter, Write};
use std::path::Path;

use commitscape_core::{
    ChangeKind, CommitKind, FileChange, FileClass, FileId, Index, Oid, SignatureId,
};
use commitscape_metrics::{
    is_lockfile, language_of, looks_generated, role_of, Analysis, Options, Role, Window,
};
use serde::Serialize;

use crate::api;

pub const FORMAT: u32 = 4;

const REACHABLE: u8 = 8;

pub struct Export<'a> {
    pub index: &'a Index,
    pub accounts: &'a HashMap<String, String>,
    pub options: Options,
    pub anchor: i64,
    pub releases: &'a [(String, i64)],
    pub release_commits: &'a [(String, Oid)],
    pub lines: Option<Lines<'a>>,
    pub mainline: Mainline<'a>,
    pub known: Option<&'a HashSet<Oid>>,
    pub since: Since<'a>,
    pub mark: String,
    pub lineage: u64,
    pub kept: bool,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Since<'a> {
    pub moved: Option<&'a [bool]>,
    pub counted: Option<&'a HashSet<Oid>>,
}

#[derive(Debug, Clone, Copy)]
pub struct Lines<'a> {
    pub settled: &'a [bool],
    pub counted: u64,
    pub left: u64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Mainline<'a> {
    pub bits: &'a [u8],
    pub arrival: &'a [Option<i64>],
}

impl Mainline<'_> {
    fn bits(&self, at: usize) -> u8 {
        self.bits.get(at).copied().unwrap_or(0)
    }

    fn arrival(&self, at: usize) -> Option<i64> {
        self.arrival.get(at).copied().flatten()
    }
}

#[derive(Debug, Serialize)]
pub struct Manifest {
    pub format: u32,
    pub lineage: String,
    pub kept: bool,
    pub full: bool,
    pub lines: bool,
    pub lines_counted: u64,
    pub lines_mainline: bool,
    pub lines_left: Option<u64>,
    pub head: Option<String>,
    pub frontier: Vec<String>,
    pub commits: usize,
    pub total: usize,
    pub anchor: i64,
    pub max_changeset_size: u32,
    pub coupling_support: u32,
    pub ownership_min_commits: u32,
    pub mark: String,
    pub changes_only: bool,
}

/// Writes the Index, or what is new since the commits the Site already holds, as Postgres `COPY` text files and a manifest: new commits, the Mainline of earlier commits, and the Lines Changed of earlier commits now settled; only what moved and what was counted after the Site's mark, when it still holds.
pub fn write(e: &Export<'_>, dir: &Path) -> std::io::Result<Manifest> {
    std::fs::create_dir_all(dir)?;
    let index = e.index;
    let full = e.known.is_none();
    let fresh: Vec<usize> = index
        .commits
        .iter()
        .enumerate()
        .filter(|(_, c)| e.known.is_none_or(|k| !k.contains(&c.id)))
        .map(|(i, _)| i)
        .collect();

    write_commits(dir, index, &fresh, e)?;
    write_mainline(dir, index, e)?;
    write_lines(dir, index, e)?;
    let files = touched_files(index, &fresh, full);
    write_files(dir, index, &files)?;
    write_folders(dir, index)?;
    write_people(dir, index, e.accounts)?;
    write_persons(dir, index)?;
    write_snapshot(dir, e)?;
    write_head(dir, index)?;

    let manifest = Manifest {
        format: FORMAT,
        lineage: e.lineage.to_string(),
        kept: e.kept,
        full,
        lines: e.lines.is_some_and(|l| l.left == 0),
        lines_counted: e.lines.map_or(0, |l| l.counted),
        lines_mainline: mainline_counted(e),
        lines_left: e.lines.map(|l| l.left),
        head: index.head_commit.map(|h| h.to_hex()),
        frontier: index.frontier.iter().map(|o| o.to_hex()).collect(),
        commits: fresh.len(),
        total: index.commits.len(),
        anchor: e.anchor,
        max_changeset_size: e.options.max_changeset_size,
        coupling_support: e.options.coupling_support,
        ownership_min_commits: e.options.ownership_min_commits,
        mark: e.mark.clone(),
        changes_only: !full && e.since.moved.is_some() && e.since.counted.is_some(),
    };
    let json = serde_json::to_vec_pretty(&manifest).map_err(std::io::Error::other)?;
    std::fs::write(dir.join("manifest.json"), json)?;
    Ok(manifest)
}

fn mainline_counted(e: &Export<'_>) -> bool {
    e.lines.is_some()
        && (0..e.index.commits.len())
            .all(|at| e.mainline.bits(at) & REACHABLE == 0 || settled(e, at))
}

fn settled(e: &Export<'_>, at: usize) -> bool {
    e.lines
        .is_some_and(|l| l.settled.get(at).copied().unwrap_or(false))
}

fn folder_of(path: &[u8]) -> &[u8] {
    match path.iter().rposition(|&b| b == b'/') {
        Some(at) => path.get(..at).unwrap_or(&[]),
        None => &[],
    }
}

fn ancestors(path: &[u8]) -> Vec<&[u8]> {
    let mut out: Vec<&[u8]> = vec![&[]];
    for (i, &b) in path.iter().enumerate() {
        if b == b'/' {
            if let Some(p) = path.get(..i) {
                out.push(p);
            }
        }
    }
    if !path.is_empty() {
        out.push(path);
    }
    out
}

fn depth(folder: &[u8]) -> usize {
    if folder.is_empty() {
        0
    } else {
        folder.iter().filter(|&&b| b == b'/').count() + 1
    }
}

struct Copy {
    out: BufWriter<std::fs::File>,
    line: String,
    fields: usize,
}

impl Copy {
    fn create(dir: &Path, name: &str) -> std::io::Result<Copy> {
        Ok(Copy {
            out: BufWriter::with_capacity(1 << 20, std::fs::File::create(dir.join(name))?),
            line: String::new(),
            fields: 0,
        })
    }

    fn field(&mut self) {
        if self.fields > 0 {
            self.line.push('\t');
        }
        self.fields += 1;
    }

    fn num(&mut self, v: impl std::fmt::Display) -> &mut Self {
        self.field();
        let _ = write!(self.line, "{v}");
        self
    }

    fn null(&mut self) -> &mut Self {
        self.field();
        self.line.push_str("\\N");
        self
    }

    fn text(&mut self, v: &str) -> &mut Self {
        self.field();
        for ch in v.chars() {
            match ch {
                '\\' => self.line.push_str("\\\\"),
                '\t' => self.line.push_str("\\t"),
                '\n' => self.line.push_str("\\n"),
                '\r' => self.line.push_str("\\r"),
                c => self.line.push(c),
            }
        }
        self
    }

    fn bytes_text(&mut self, v: &[u8]) -> &mut Self {
        self.text(&String::from_utf8_lossy(v))
    }

    fn oid(&mut self, v: Oid) -> &mut Self {
        self.field();
        self.line.push_str("\\\\x");
        self.line.push_str(&v.to_hex());
        self
    }

    fn bool(&mut self, v: bool) -> &mut Self {
        self.field();
        self.line.push(if v { 't' } else { 'f' });
        self
    }

    fn array<T: std::fmt::Display>(&mut self, items: impl Iterator<Item = Option<T>>) -> &mut Self {
        self.field();
        self.line.push('{');
        for (i, item) in items.enumerate() {
            if i > 0 {
                self.line.push(',');
            }
            match item {
                Some(v) => {
                    let _ = write!(self.line, "{v}");
                }
                None => self.line.push_str("NULL"),
            }
        }
        self.line.push('}');
        self
    }

    fn end(&mut self) -> std::io::Result<()> {
        self.line.push('\n');
        self.out.write_all(self.line.as_bytes())?;
        self.line.clear();
        self.fields = 0;
        Ok(())
    }

    fn finish(mut self) -> std::io::Result<()> {
        self.out.flush()
    }
}

fn kind_code(kind: CommitKind) -> usize {
    CommitKind::EVERY
        .iter()
        .position(|k| *k == kind)
        .unwrap_or(0)
}

fn change_code(kind: ChangeKind) -> u8 {
    kind as u8
}

fn write_commits(
    dir: &Path,
    index: &Index,
    fresh: &[usize],
    e: &Export<'_>,
) -> std::io::Result<()> {
    let mut out = Copy::create(dir, "commits.tsv")?;
    for &at in fresh {
        let Some(c) = index.commits.get(at) else {
            continue;
        };
        let changes = index.changes_of(c);
        out.oid(c.id)
            .num(c.time)
            .num(c.offset_minutes)
            .num(c.author_delta)
            .num(c.signature.0)
            .num(kind_code(c.kind))
            .num(c.flags.0 | e.mainline.bits(at));
        match e.mainline.arrival(at) {
            Some(t) => out.num(t),
            None => out.null(),
        };
        out.text(index.subject_of(c))
            .array(changes.iter().map(|ch| Some(ch.file.0)))
            .array(changes.iter().map(|ch| Some(change_code(ch.kind))));
        lines_of(&mut out, changes, settled(e, at));
        out.end()?;
    }
    out.finish()
}

fn lines_of(out: &mut Copy, changes: &[FileChange], settled: bool) {
    if settled {
        out.array(changes.iter().map(|ch| ch.lines.map(|l| l.added)))
            .array(changes.iter().map(|ch| ch.lines.map(|l| l.removed)));
    } else {
        out.null().null();
    }
}

fn write_mainline(dir: &Path, index: &Index, e: &Export<'_>) -> std::io::Result<()> {
    let mut out = Copy::create(dir, "mainline.tsv")?;
    if let Some(known) = e.known {
        for (at, c) in index.commits.iter().enumerate() {
            let moved = e
                .since
                .moved
                .is_none_or(|m| m.get(at).copied().unwrap_or(true));
            if !moved || !known.contains(&c.id) {
                continue;
            }
            out.oid(c.id).num(c.flags.0 | e.mainline.bits(at));
            match e.mainline.arrival(at) {
                Some(t) => out.num(t),
                None => out.null(),
            };
            out.end()?;
        }
    }
    out.finish()
}

fn write_lines(dir: &Path, index: &Index, e: &Export<'_>) -> std::io::Result<()> {
    let mut out = Copy::create(dir, "lines.tsv")?;
    if let Some(known) = e.known {
        for (at, c) in index.commits.iter().enumerate() {
            let counted = e.since.counted.is_none_or(|s| s.contains(&c.id));
            if !counted || !known.contains(&c.id) || !settled(e, at) {
                continue;
            }
            out.oid(c.id);
            lines_of(&mut out, index.changes_of(c), true);
            out.end()?;
        }
    }
    out.finish()
}

fn touched_files(index: &Index, fresh: &[usize], full: bool) -> BTreeSet<FileId> {
    if full {
        return (0..index.paths.len()).map(|i| FileId(i as u32)).collect();
    }
    fresh
        .iter()
        .filter_map(|&at| index.commits.get(at))
        .flat_map(|c| index.changes_of(c).iter().map(|ch| ch.file))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFacts {
    pub path: String,
    pub folder: String,
    pub born: i64,
    pub last: i64,
    pub alive: bool,
    pub role: u8,
    pub language: Option<&'static str>,
    pub generated: bool,
    pub lockfile: bool,
}

pub struct Files<'a> {
    index: &'a Index,
    alive: HashSet<FileId>,
}

impl<'a> Files<'a> {
    /// Ready to tell what the Stored Index keeps of each file of an Index.
    pub fn of(index: &'a Index) -> Files<'a> {
        Files {
            index,
            alive: index.head.iter().map(|h| h.file).collect(),
        }
    }

    /// What the Stored Index keeps of one file: its path and folder now, when it was first and last changed, whether HEAD has it, its role and language, and whether it looks generated or is a lockfile.
    pub fn facts(&self, file: FileId) -> FileFacts {
        let path = self.index.paths.path(file).unwrap_or(&[]);
        let history = self.index.history_of(file).unwrap_or_default();
        FileFacts {
            path: String::from_utf8_lossy(path).into_owned(),
            folder: String::from_utf8_lossy(folder_of(path)).into_owned(),
            born: history.first_seen,
            last: history.last_touched,
            alive: self.alive.contains(&file),
            role: role_number(role_of(path)),
            language: language_of(path),
            generated: looks_generated(path),
            lockfile: is_lockfile(path),
        }
    }
}

fn write_files(dir: &Path, index: &Index, files: &BTreeSet<FileId>) -> std::io::Result<()> {
    let facts = Files::of(index);
    let mut out = Copy::create(dir, "files.tsv")?;
    for &file in files {
        let f = facts.facts(file);
        out.num(file.0)
            .text(&f.path)
            .text(&f.folder)
            .num(f.born)
            .num(f.last)
            .bool(f.alive)
            .num(f.role);
        match f.language {
            Some(l) => out.text(l),
            None => out.null(),
        };
        out.bool(f.generated).bool(f.lockfile).end()?;
    }
    out.finish()?;
    let mut out = Copy::create(dir, "file_paths.tsv")?;
    for (file, path) in index.paths.departures() {
        if files.contains(&file) {
            out.num(file.0).text(&String::from_utf8_lossy(path)).end()?;
        }
    }
    out.finish()
}

fn write_folders(dir: &Path, index: &Index) -> std::io::Result<()> {
    let mut folders: BTreeSet<&[u8]> = BTreeSet::new();
    for (_, path) in index.paths.iter() {
        for a in ancestors(folder_of(path)) {
            folders.insert(a);
        }
    }
    let mut out = Copy::create(dir, "folders.tsv")?;
    for f in folders {
        out.bytes_text(f);
        if f.is_empty() {
            out.null();
        } else {
            out.bytes_text(folder_of(f));
        }
        out.num(depth(f)).end()?;
    }
    out.finish()
}

fn role_number(role: Role) -> u8 {
    match role {
        Role::Code => 0,
        Role::Dependencies => 1,
        Role::Test => 2,
        Role::Docs => 3,
        Role::Ci => 4,
    }
}

fn write_persons(dir: &Path, index: &Index) -> std::io::Result<()> {
    let used = index.authors.used();
    let mut out = Copy::create(dir, "persons.tsv")?;
    for (id, author) in index.authors.iter() {
        let commits: u32 = author
            .signatures
            .iter()
            .map(|s| used.get(s.idx()).copied().unwrap_or(0))
            .sum();
        out.num(id.0)
            .num(author.traits.0)
            .num(index.authors.addresses_of(id).len().max(1))
            .num(commits)
            .end()?;
    }
    out.finish()
}

#[derive(Serialize)]
struct Snapshot {
    commits: u64,
    merges: u64,
    oldest: Option<i64>,
    newest: Option<i64>,
    languages: Vec<api::Language>,
    code_age: Vec<api::QuarterLines>,
    suspects: Vec<Vec<u32>>,
    releases: Vec<(String, i64)>,
    release_shas: BTreeMap<String, String>,
}

fn write_snapshot(dir: &Path, e: &Export<'_>) -> std::io::Result<()> {
    let a = Analysis::new(e.index, Window::all(e.anchor), e.options);
    let snapshot = Snapshot {
        commits: e.index.span.commits,
        merges: e.index.span.merges,
        oldest: e.index.span.oldest,
        newest: e.index.span.newest,
        languages: a
            .languages()
            .languages
            .iter()
            .map(|l| api::Language {
                name: l.name.to_string(),
                lines: l.lines,
            })
            .collect(),
        code_age: a
            .code_age()
            .iter()
            .map(|q| api::QuarterLines {
                year: q.year as i32,
                quarter: q.quarter,
                lines: q.lines,
            })
            .collect(),
        suspects: a
            .suspected_duplicates()
            .iter()
            .map(|g| g.people.iter().map(|p| p.0).collect())
            .collect(),
        releases: e.releases.to_vec(),
        release_shas: e
            .release_commits
            .iter()
            .map(|(name, commit)| (name.clone(), commit.to_hex()))
            .collect(),
    };
    let json = serde_json::to_vec(&snapshot).map_err(std::io::Error::other)?;
    std::fs::write(dir.join("snapshot.json"), json)
}

fn write_people(
    dir: &Path,
    index: &Index,
    accounts: &HashMap<String, String>,
) -> std::io::Result<()> {
    let colours = api::colours(index);
    let logins = api::logins(index, accounts);
    let login_of = api::login_of(&logins);
    let mut out = Copy::create(dir, "people.tsv")?;
    for i in 0..index.authors.signature_count() {
        let sig = SignatureId(i as u32);
        let Some(signature) = index.authors.signature(sig) else {
            continue;
        };
        out.num(sig.0).text(signature.name);
        match index.authors.person_of(sig) {
            Some(person) => {
                let author = index.authors.get(person);
                out.num(person.0)
                    .text(author.map(|a| a.name).unwrap_or(signature.name));
                match colours.get(&person) {
                    Some(c) => out.num(c),
                    None => out.null(),
                };
                match login_of.get(&person) {
                    Some(l) => out.text(l),
                    None => out.null(),
                };
                out.bool(index.authors.is_bot(person));
            }
            None => {
                out.null().null().null().null().bool(false);
            }
        }
        out.end()?;
    }
    out.finish()
}

fn class_label(class: FileClass) -> &'static str {
    match class {
        FileClass::Source => "source",
        FileClass::Prose => "prose",
        FileClass::Generated => "generated",
        FileClass::Vendored => "vendored",
        FileClass::Binary => "binary",
        FileClass::Symlink => "symlink",
    }
}

fn write_head(dir: &Path, index: &Index) -> std::io::Result<()> {
    let mut out = Copy::create(dir, "head_files.tsv")?;
    for h in &index.head {
        out.num(h.file.0)
            .oid(h.blob)
            .num(h.bytes)
            .num(h.loc)
            .text(class_label(h.class))
            .num(h.indent_levels)
            .num(h.indent_mean)
            .num(h.indent_stddev)
            .end()?;
    }
    out.finish()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::indexing_slicing)]

    use super::*;
    use commitscape_index::source::RawChangeKind::{Added, Modified};
    use commitscape_index::{index_from_scratch, ScriptedRepo};

    const DAY0: i64 = 1_704_067_200;
    const DAY: i64 = 86_400;

    fn blob(n: u8) -> Oid {
        let mut b = [0u8; 20];
        b[0] = n;
        Oid(b)
    }

    fn repo() -> ScriptedRepo {
        ScriptedRepo::new()
            .commit(
                DAY0,
                ("Ada", "ada@example.com"),
                &[
                    (b"src/a.rs", Added, blob(1)),
                    (b"README.md", Added, blob(2)),
                ],
            )
            .said("feat: first\ttabbed \\ line")
            .commit(
                DAY0 + DAY,
                ("Bob", "bob@example.com"),
                &[(b"src/a.rs", Modified, blob(3))],
            )
            .commit(
                DAY0 + 2 * DAY,
                ("Ada", "ada@example.com"),
                &[(b"src/deep/b.rs", Added, blob(4))],
            )
    }

    fn index_of(repo: &ScriptedRepo) -> Index {
        match index_from_scratch(repo) {
            Ok(i) => i,
            Err(never) => match never {},
        }
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "commitscape-export-{name}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn export(
        index: &Index,
        known: Option<&HashSet<Oid>>,
        lines: Option<Lines<'_>>,
        dir: &Path,
    ) -> Manifest {
        export_since(index, known, lines, Since::default(), dir)
    }

    fn export_since(
        index: &Index,
        known: Option<&HashSet<Oid>>,
        lines: Option<Lines<'_>>,
        since: Since<'_>,
        dir: &Path,
    ) -> Manifest {
        let bits = [
            REACHABLE | FIRST_PARENT,
            REACHABLE,
            REACHABLE | FIRST_PARENT,
        ];
        let arrival = [Some(DAY0), Some(DAY0 + 2 * DAY), Some(DAY0 + 2 * DAY)];
        write(
            &Export {
                index,
                accounts: &HashMap::new(),
                options: Options::default(),
                anchor: 0,
                releases: &[("v1.0".to_string(), DAY0 + DAY)],
                release_commits: &[("v1.0".to_string(), index.commits[1].id)],
                lines,
                mainline: Mainline {
                    bits: &bits,
                    arrival: &arrival,
                },
                known,
                since,
                mark: "a mark".to_string(),
                lineage: 7,
                kept: true,
            },
            dir,
        )
        .expect("export")
    }

    const FIRST_PARENT: u8 = 16;

    fn lines(dir: &Path, file: &str) -> Vec<String> {
        std::fs::read_to_string(dir.join(file))
            .expect("read")
            .lines()
            .map(str::to_string)
            .collect()
    }

    fn sha(index: &Index, at: usize) -> String {
        format!("\\\\x{}", index.commits[at].id.to_hex())
    }

    #[test]
    fn a_full_export_writes_every_commit_with_its_mainline_and_every_folder() {
        let index = index_of(&repo());
        let dir = scratch("full");
        let m = export(&index, None, None, &dir);
        assert!(m.full && !m.lines && !m.lines_mainline);
        assert_eq!((m.commits, m.total, m.lines_counted), (3, 3, 0));
        assert_eq!(m.lines_left, None);
        assert_eq!(
            lines(&dir, "folders.tsv"),
            vec!["\t\\N\t0", "src\t\t1", "src/deep\tsrc\t2"]
        );
        let commits = lines(&dir, "commits.tsv");
        assert_eq!(commits.len(), 3);
        assert!(commits
            .iter()
            .any(|l| l.contains("feat: first\\ttabbed \\\\ line")));
        assert!(commits
            .iter()
            .all(|l| l.starts_with("\\\\x") && l.split('\t').count() == 13));
        let columns: Vec<&str> = commits[1].split('\t').collect();
        assert_eq!(columns[6], "8");
        assert_eq!(columns[7], (DAY0 + 2 * DAY).to_string());
        assert_eq!(&columns[11..], ["\\N", "\\N"]);
        assert!(lines(&dir, "mainline.tsv").is_empty());
        assert!(lines(&dir, "lines.tsv").is_empty());
        assert_eq!(lines(&dir, "files.tsv").len(), 3);
        for gone in [
            "days.tsv",
            "signature_days.tsv",
            "folder_days.tsv",
            "signature_folder_days.tsv",
        ] {
            assert!(!dir.join(gone).exists(), "{gone}");
        }
        let snapshot: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("snapshot.json")).expect("read"))
                .expect("JSON");
        assert_eq!(
            snapshot["release_shas"]["v1.0"],
            index.commits[1].id.to_hex()
        );
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).expect("read"))
                .expect("JSON");
        assert_eq!(manifest["format"], 4);
        assert_eq!(manifest["mark"], "a mark");
        assert_eq!(manifest["changes_only"], false);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_export_after_known_commits_holds_what_is_new_and_the_lines_settled_since() {
        let repo = repo();
        let index = index_of(&repo);
        let known: HashSet<Oid> = index.commits.iter().take(2).map(|c| c.id).collect();
        let dir = scratch("after");
        let settled = [true, false, true];
        let m = export(
            &index,
            Some(&known),
            Some(Lines {
                settled: &settled,
                counted: 2,
                left: 1,
            }),
            &dir,
        );
        assert!(!m.full && !m.lines && !m.lines_mainline);
        assert_eq!((m.commits, m.total, m.lines_counted), (1, 3, 2));
        assert_eq!(m.lines_left, Some(1));
        let files = lines(&dir, "files.tsv");
        assert_eq!(files.len(), 1);
        assert!(files[0].contains("src/deep/b.rs\tsrc/deep"));
        assert_eq!(lines(&dir, "commits.tsv").len(), 1);
        assert_eq!(lines(&dir, "mainline.tsv").len(), 2);
        assert_eq!(
            lines(&dir, "lines.tsv"),
            vec![format!("{}\t{{NULL,NULL}}\t{{NULL,NULL}}", sha(&index, 0))]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_export_after_a_mark_that_holds_writes_only_the_mainline_that_moved_and_the_lines_counted_since(
    ) {
        let index = index_of(&repo());
        let known: HashSet<Oid> = index.commits.iter().map(|c| c.id).collect();
        let dir = scratch("since");
        let settled = [true; 3];
        let moved = [false, true, false];
        let counted: HashSet<Oid> = [index.commits[2].id].into_iter().collect();
        let m = export_since(
            &index,
            Some(&known),
            Some(Lines {
                settled: &settled,
                counted: 3,
                left: 0,
            }),
            Since {
                moved: Some(&moved),
                counted: Some(&counted),
            },
            &dir,
        );
        assert!(!m.full && m.changes_only);
        assert_eq!(
            lines(&dir, "mainline.tsv"),
            vec![format!("{}\t8\t{}", sha(&index, 1), DAY0 + 2 * DAY)]
        );
        let filled = lines(&dir, "lines.tsv");
        assert_eq!(filled.len(), 1);
        assert!(filled[0].starts_with(&sha(&index, 2)));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn lines_are_complete_once_nothing_is_left_to_count() {
        let index = index_of(&repo());
        let dir = scratch("complete");
        let settled = [true; 3];
        let m = export(
            &index,
            None,
            Some(Lines {
                settled: &settled,
                counted: 3,
                left: 0,
            }),
            &dir,
        );
        assert!(m.lines && m.lines_mainline);
        assert_eq!((m.lines_counted, m.lines_left), (3, Some(0)));
        assert!(lines(&dir, "commits.tsv")
            .iter()
            .all(|l| !l.ends_with("\\N\t\\N")));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_mainline_is_counted_while_commits_only_other_refs_reach_wait() {
        let index = index_of(&repo());
        let dir = scratch("mainline");
        let bits = [REACHABLE | FIRST_PARENT, 0, REACHABLE | FIRST_PARENT];
        let arrival = [Some(DAY0), None, Some(DAY0 + 2 * DAY)];
        let settled = [true, false, true];
        let m = write(
            &Export {
                index: &index,
                accounts: &HashMap::new(),
                options: Options::default(),
                anchor: 0,
                releases: &[],
                release_commits: &[],
                lines: Some(Lines {
                    settled: &settled,
                    counted: 2,
                    left: 1,
                }),
                mainline: Mainline {
                    bits: &bits,
                    arrival: &arrival,
                },
                known: None,
                since: Since::default(),
                mark: String::new(),
                lineage: 7,
                kept: true,
            },
            &dir,
        )
        .expect("export");
        assert!(!m.lines && m.lines_mainline);
        assert_eq!(m.lines_left, Some(1));
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).expect("read"))
                .expect("JSON");
        assert_eq!(manifest["lines_mainline"], true);
        assert_eq!(manifest["lines_left"], 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
