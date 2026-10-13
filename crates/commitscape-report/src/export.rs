use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt::Write as _;
use std::io::{BufWriter, Write};
use std::path::Path;

use commitscape_core::{
    ChangeKind, CommitFlags, CommitKind, CommitMeta, FileClass, FileId, Index, Oid, SignatureId,
};
use commitscape_metrics::{
    is_lockfile, language_of, looks_generated, role_of, Analysis, Options, Role, Window,
};
use serde::Serialize;

use crate::api;

pub const FORMAT: u32 = 2;

const DAY: i64 = 86_400;
const FOLDER_DEPTH_BY_PERSON: usize = 3;

pub struct Export<'a> {
    pub index: &'a Index,
    pub accounts: &'a HashMap<String, String>,
    pub options: Options,
    pub anchor: i64,
    pub releases: &'a [(String, i64)],
    pub lines_counted: bool,
    pub known: Option<&'a HashSet<Oid>>,
    pub lineage: u64,
    pub kept: bool,
}

#[derive(Debug, Serialize)]
pub struct Manifest {
    pub format: u32,
    pub lineage: String,
    pub kept: bool,
    pub full: bool,
    pub lines: bool,
    pub folders_full: bool,
    pub head: Option<String>,
    pub frontier: Vec<String>,
    pub commits: usize,
    pub total: usize,
    pub days: usize,
    pub anchor: i64,
    pub max_changeset_size: u32,
    pub coupling_support: u32,
    pub ownership_min_commits: u32,
}

struct Sums {
    commits: u32,
    merges: u32,
    bulk: u32,
    changes: u32,
    added: u64,
    removed: u64,
}

impl Sums {
    fn new() -> Sums {
        Sums {
            commits: 0,
            merges: 0,
            bulk: 0,
            changes: 0,
            added: 0,
            removed: 0,
        }
    }
}

/// Writes the Index, or what is new since the commits the Site already holds, as Postgres `COPY` text files and a manifest.
pub fn write(e: &Export<'_>, dir: &Path) -> std::io::Result<Manifest> {
    std::fs::create_dir_all(dir)?;
    let index = e.index;
    let full = e.known.is_none();
    let fresh: Vec<&CommitMeta> = index
        .commits
        .iter()
        .filter(|c| e.known.is_none_or(|k| !k.contains(&c.id)))
        .collect();
    let days: BTreeSet<i64> = if full {
        index.commits.iter().map(landing_day).collect()
    } else {
        fresh.iter().map(|c| landing_day(c)).collect()
    };
    let folders_full = full
        || fresh.iter().any(|c| {
            index
                .changes_of(c)
                .iter()
                .any(|ch| ch.kind == ChangeKind::Renamed)
        });
    let skipped = skipped_files(index);

    write_commits(dir, index, &fresh, e)?;
    let files = touched_files(index, &fresh, full);
    write_files(dir, index, &files)?;
    write_folders(dir, index)?;
    write_people(dir, index, e.accounts)?;
    write_persons(dir, index)?;
    write_snapshot(dir, e)?;
    write_days(dir, index, &days, folders_full, e, &skipped)?;
    write_head(dir, index)?;

    let manifest = Manifest {
        format: FORMAT,
        lineage: e.lineage.to_string(),
        kept: e.kept,
        full,
        lines: e.lines_counted,
        folders_full,
        head: index.head_commit.map(|h| h.to_hex()),
        frontier: index.frontier.iter().map(|o| o.to_hex()).collect(),
        commits: fresh.len(),
        total: index.commits.len(),
        days: days.len(),
        anchor: e.anchor,
        max_changeset_size: e.options.max_changeset_size,
        coupling_support: e.options.coupling_support,
        ownership_min_commits: e.options.ownership_min_commits,
    };
    let json = serde_json::to_vec_pretty(&manifest).map_err(std::io::Error::other)?;
    std::fs::write(dir.join("manifest.json"), json)?;
    Ok(manifest)
}

fn landing_day(c: &CommitMeta) -> i64 {
    c.landed_clock().div_euclid(DAY)
}

fn is_bulk(c: &CommitMeta, max: u32) -> bool {
    c.changes_len > max || c.flags.contains(CommitFlags::BULK)
}

fn counts(c: &CommitMeta, max: u32) -> bool {
    !c.is_merge() && !is_bulk(c, max)
}

fn skipped_files(index: &Index) -> Vec<bool> {
    let mut generated = vec![None::<bool>; index.paths.len()];
    for h in &index.head {
        if let Some(slot) = generated.get_mut(h.file.idx()) {
            *slot = Some(matches!(
                h.class,
                FileClass::Generated | FileClass::Vendored
            ));
        }
    }
    (0..index.paths.len())
        .map(|i| {
            let path = index.paths.path(FileId(i as u32));
            let g = generated
                .get(i)
                .copied()
                .flatten()
                .unwrap_or_else(|| path.is_some_and(looks_generated));
            g || path.is_some_and(is_lockfile)
        })
        .collect()
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
    fresh: &[&CommitMeta],
    e: &Export<'_>,
) -> std::io::Result<()> {
    let mut out = Copy::create(dir, "commits.tsv")?;
    for c in fresh {
        let changes = index.changes_of(c);
        out.oid(c.id)
            .num(c.time)
            .num(c.offset_minutes)
            .num(c.author_delta)
            .num(c.signature.0)
            .num(kind_code(c.kind))
            .num(c.flags.0)
            .text(index.subject_of(c))
            .array(changes.iter().map(|ch| Some(ch.file.0)))
            .array(changes.iter().map(|ch| Some(change_code(ch.kind))));
        if e.lines_counted {
            out.array(changes.iter().map(|ch| ch.lines.map(|l| l.added)))
                .array(changes.iter().map(|ch| ch.lines.map(|l| l.removed)));
        } else {
            out.null().null();
        }
        out.end()?;
    }
    out.finish()
}

fn touched_files(index: &Index, fresh: &[&CommitMeta], full: bool) -> BTreeSet<FileId> {
    if full {
        return (0..index.paths.len()).map(|i| FileId(i as u32)).collect();
    }
    fresh
        .iter()
        .flat_map(|c| index.changes_of(c).iter().map(|ch| ch.file))
        .collect()
}

fn write_files(dir: &Path, index: &Index, files: &BTreeSet<FileId>) -> std::io::Result<()> {
    let alive: HashSet<FileId> = index.head.iter().map(|h| h.file).collect();
    let mut out = Copy::create(dir, "files.tsv")?;
    for &file in files {
        let path = index.paths.path(file).unwrap_or(&[]);
        let history = index.history_of(file).unwrap_or_default();
        out.num(file.0)
            .bytes_text(path)
            .bytes_text(folder_of(path))
            .num(history.first_seen)
            .num(history.last_touched)
            .bool(alive.contains(&file))
            .num(role_number(role_of(path)));
        match language_of(path) {
            Some(l) => out.text(l),
            None => out.null(),
        };
        out.bool(looks_generated(path)).bool(is_lockfile(path)).end()?;
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

fn write_days(
    dir: &Path,
    index: &Index,
    days: &BTreeSet<i64>,
    folders_full: bool,
    e: &Export<'_>,
    skipped: &[bool],
) -> std::io::Result<()> {
    let max = e.options.max_changeset_size;
    let mut repo: BTreeMap<i64, Sums> = BTreeMap::new();
    let mut by_signature: BTreeMap<(i64, u32), Sums> = BTreeMap::new();
    let mut by_folder: BTreeMap<(i64, Vec<u8>), Sums> = BTreeMap::new();
    let mut by_both: BTreeMap<(i64, u32, Vec<u8>), Sums> = BTreeMap::new();
    let folder_paths: Vec<Vec<Vec<u8>>> = (0..index.paths.len())
        .map(|i| {
            let path = index.paths.path(FileId(i as u32)).unwrap_or(&[]);
            ancestors(folder_of(path))
                .into_iter()
                .map(<[u8]>::to_vec)
                .collect()
        })
        .collect();

    for c in &index.commits {
        let day = landing_day(c);
        let in_days = days.contains(&day);
        if !in_days && !folders_full {
            continue;
        }
        let counted = counts(c, max);
        let lines = counted && !c.flags.contains(CommitFlags::BLAME_IGNORED);
        let (mut added, mut removed) = (0u64, 0u64);
        let mut per_folder: HashMap<&[u8], (u32, u64, u64)> = HashMap::new();
        for ch in index.changes_of(c) {
            let skip = skipped.get(ch.file.idx()).copied().unwrap_or(true);
            let (a, r) = match (lines && !skip, ch.lines) {
                (true, Some(l)) => (u64::from(l.added), u64::from(l.removed)),
                _ => (0, 0),
            };
            added += a;
            removed += r;
            if counted {
                for f in folder_paths.get(ch.file.idx()).into_iter().flatten() {
                    let s = per_folder.entry(f.as_slice()).or_insert((0, 0, 0));
                    s.0 += 1;
                    s.1 += a;
                    s.2 += r;
                }
            }
        }
        if in_days {
            for s in [
                repo.entry(day).or_insert_with(Sums::new),
                by_signature
                    .entry((day, c.signature.0))
                    .or_insert_with(Sums::new),
            ] {
                s.commits += 1;
                s.merges += u32::from(c.is_merge());
                s.bulk += u32::from(!c.is_merge() && is_bulk(c, max));
                s.changes += if counted { c.changes_len } else { 0 };
                s.added += added;
                s.removed += removed;
            }
        }
        for (folder, (changes, a, r)) in per_folder {
            let s = by_folder
                .entry((day, folder.to_vec()))
                .or_insert_with(Sums::new);
            s.commits += 1;
            s.changes += changes;
            s.added += a;
            s.removed += r;
            if depth(folder) <= FOLDER_DEPTH_BY_PERSON {
                let s = by_both
                    .entry((day, c.signature.0, folder.to_vec()))
                    .or_insert_with(Sums::new);
                s.commits += 1;
                s.changes += changes;
                s.added += a;
                s.removed += r;
            }
        }
    }

    let mut out = Copy::create(dir, "days.tsv")?;
    for (day, s) in &repo {
        out.num(day)
            .num(s.commits)
            .num(s.merges)
            .num(s.bulk)
            .num(s.changes)
            .num(s.added)
            .num(s.removed)
            .end()?;
    }
    out.finish()?;
    let mut out = Copy::create(dir, "signature_days.tsv")?;
    for ((day, sig), s) in &by_signature {
        out.num(day)
            .num(sig)
            .num(s.commits)
            .num(s.merges)
            .num(s.bulk)
            .num(s.changes)
            .num(s.added)
            .num(s.removed)
            .end()?;
    }
    out.finish()?;
    let mut out = Copy::create(dir, "folder_days.tsv")?;
    for ((day, folder), s) in &by_folder {
        out.num(day)
            .bytes_text(folder)
            .num(s.commits)
            .num(s.changes)
            .num(s.added)
            .num(s.removed)
            .end()?;
    }
    out.finish()?;
    let mut out = Copy::create(dir, "signature_folder_days.tsv")?;
    for ((day, sig, folder), s) in &by_both {
        out.num(day)
            .num(sig)
            .bytes_text(folder)
            .num(s.commits)
            .num(s.changes)
            .num(s.added)
            .num(s.removed)
            .end()?;
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

    fn export(index: &Index, known: Option<&HashSet<Oid>>, dir: &Path) -> Manifest {
        write(
            &Export {
                index,
                accounts: &HashMap::new(),
                options: Options::default(),
                anchor: 0,
                releases: &[],
                lines_counted: false,
                known,
                lineage: 7,
                kept: true,
            },
            dir,
        )
        .expect("export")
    }

    fn lines(dir: &Path, file: &str) -> Vec<String> {
        std::fs::read_to_string(dir.join(file))
            .expect("read")
            .lines()
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn a_full_export_writes_every_commit_folder_and_day() {
        let index = index_of(&repo());
        let dir = scratch("full");
        let m = export(&index, None, &dir);
        assert!(m.full && m.folders_full);
        assert_eq!((m.commits, m.total, m.days), (3, 3, 3));
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
            .all(|l| l.starts_with("\\\\x") && l.split('\t').count() == 12));
        assert_eq!(lines(&dir, "files.tsv").len(), 3);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_export_after_known_commits_holds_only_what_is_new() {
        let repo = repo();
        let index = index_of(&repo);
        let known: HashSet<Oid> = index.commits.iter().take(2).map(|c| c.id).collect();
        let dir = scratch("after");
        let m = export(&index, Some(&known), &dir);
        assert!(!m.full && !m.folders_full);
        assert_eq!((m.commits, m.total, m.days), (1, 3, 1));
        let files = lines(&dir, "files.tsv");
        assert_eq!(files.len(), 1);
        assert!(files[0].contains("src/deep/b.rs\tsrc/deep"));
        assert_eq!(lines(&dir, "days.tsv").len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
