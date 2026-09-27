use commitscape_core::{AuthorId, CommitMeta, FileHistory, FileId, HeadFile, Index, PersonTraits};
use commitscape_metrics::{
    Age, Analysis, Contributor, CoupledPair, DirectoryOwnership, Hotspot, Pulse,
};

use crate::findings::Findings;
use crate::list::Cursor;

const COMMITS_SHOWN: usize = 50;

#[derive(Clone)]
pub(crate) enum Target {
    File(FileId),
    Pair(CoupledPair),
    Directory(DirectoryOwnership),
    Bucket(Age),
    Person(AuthorId),
}

pub(crate) struct Person {
    pub name: String,
    pub email: String,
    pub commits: u32,
}

pub(crate) struct CommitLine {
    pub time: i64,
    pub id: String,
    pub author: String,
}

pub(crate) struct FileDetail {
    pub path: String,
    pub head: Option<HeadFile>,
    pub history: Option<FileHistory>,
    pub churn: u32,
    pub hotspot: Option<Hotspot>,
    pub former: Vec<String>,
    pub owners: Vec<Person>,
    pub coupled: Vec<(String, CoupledPair)>,
    pub commits: Vec<CommitLine>,
    pub more: usize,
}

pub(crate) struct PairDetail {
    pub first: String,
    pub second: String,
    pub pair: CoupledPair,
    pub commits: Vec<CommitLine>,
    pub more: usize,
}

pub(crate) struct DirectoryDetail {
    pub ownership: DirectoryOwnership,
    pub owners: Vec<Person>,
}

pub(crate) struct PersonDetail {
    pub author: AuthorId,
    pub email: String,
    pub contributor: Option<Contributor>,
    pub contribution: Option<commitscape_metrics::Contribution>,
    pub pulse: Pulse,
    pub work: Vec<(String, u32)>,
    pub held: Vec<(String, u32, u32)>,
    pub addresses: Vec<(String, u32)>,
    pub traits: PersonTraits,
    pub merge_lines: String,
    pub maybe_also: Vec<Person>,
    pub mailmap: String,
}

pub(crate) struct ListedFile {
    pub file: FileId,
    pub path: String,
    pub number: i64,
    pub other: i64,
}

pub(crate) enum Detail {
    File(Box<FileDetail>),
    Pair(PairDetail),
    Directory(DirectoryDetail),
    Bucket { age: Age, files: Vec<ListedFile> },
    Person(Box<PersonDetail>),
}

pub(crate) struct Opened {
    pub origin: Target,
    pub detail: Detail,
    pub cursor: Cursor,
    pub scroll: usize,
}

impl Opened {
    pub fn open(target: Target, analysis: &Analysis<'_>, findings: &Findings) -> Opened {
        Opened {
            detail: Detail::open(target.clone(), analysis, findings),
            origin: target,
            cursor: Cursor::default(),
            scroll: 0,
        }
    }

    pub fn list_len(&self) -> Option<usize> {
        match &self.detail {
            Detail::Bucket { files, .. } => Some(files.len()),
            _ => None,
        }
    }

    pub fn target(&self) -> Option<Target> {
        match &self.detail {
            Detail::Bucket { files, .. } => files
                .get(self.cursor.selected())
                .map(|f| Target::File(f.file)),
            _ => None,
        }
    }
}

impl Target {
    pub fn among(&self, findings: &Findings) -> Option<Target> {
        match self {
            Target::Directory(d) => findings
                .ownership
                .directories
                .iter()
                .find(|o| o.dir == d.dir)
                .cloned()
                .map(Target::Directory),
            Target::Pair(p) => findings
                .coupling
                .pairs
                .iter()
                .find(|q| (q.first, q.second) == (p.first, p.second))
                .copied()
                .map(Target::Pair),
            other => Some(other.clone()),
        }
    }
}

impl Detail {
    fn open(target: Target, analysis: &Analysis<'_>, findings: &Findings) -> Detail {
        let index = analysis.index();
        match target {
            Target::File(file) => Detail::File(Box::new(file_detail(file, analysis, findings))),
            Target::Pair(pair) => {
                let commits = analysis.commits_touching(&[pair.first, pair.second]);
                Detail::Pair(PairDetail {
                    first: index.paths.path_lossy(pair.first),
                    second: index.paths.path_lossy(pair.second),
                    pair,
                    more: commits.len().saturating_sub(COMMITS_SHOWN),
                    commits: commit_lines(index, &commits),
                })
            }
            Target::Directory(ownership) => Detail::Directory(DirectoryDetail {
                owners: ownership
                    .owners
                    .iter()
                    .map(|o| person(index, o.author, o.commits))
                    .collect(),
                ownership,
            }),
            Target::Bucket(age) => Detail::Bucket {
                age,
                files: analysis
                    .stale_files(age)
                    .iter()
                    .map(|f| ListedFile {
                        file: f.file,
                        path: index.paths.path_lossy(f.file),
                        number: f.days,
                        other: f.last_touched,
                    })
                    .collect(),
            },
            Target::Person(author) => {
                let found = index.authors.get(author);
                Detail::Person(Box::new(PersonDetail {
                    author,
                    email: found.map(|a| a.email.to_string()).unwrap_or_default(),
                    addresses: index.authors.addresses_of(author),
                    traits: found.map(|a| a.traits).unwrap_or_default(),
                    merge_lines: index.authors.mailmap_lines(author),
                    contributor: findings
                        .contributors
                        .iter()
                        .find(|c| c.author == author)
                        .copied(),
                    contribution: findings
                        .contributions
                        .iter()
                        .find(|c| c.author == author)
                        .copied(),
                    pulse: analysis.pulse(Some(author)),
                    work: analysis
                        .work_of(author)
                        .iter()
                        .take(12)
                        .map(|c| (index.paths.path_lossy(c.file), c.commits))
                        .collect(),
                    held: findings
                        .ownership
                        .held_alone()
                        .into_iter()
                        .filter_map(|d| {
                            let top = d.owners.first()?;
                            (top.author == author).then(|| (d.label(), top.commits, d.commits))
                        })
                        .collect(),
                    maybe_also: findings
                        .duplicates
                        .iter()
                        .find(|g| g.people.contains(&author))
                        .map(|g| {
                            g.people
                                .iter()
                                .zip(&g.commits)
                                .filter(|(p, _)| **p != author)
                                .map(|(p, n)| person(index, *p, *n))
                                .collect()
                        })
                        .unwrap_or_default(),
                    mailmap: findings
                        .duplicates
                        .iter()
                        .find(|g| g.people.contains(&author))
                        .map(|g| analysis.mailmap_for(g))
                        .unwrap_or_default(),
                }))
            }
        }
    }
}

fn file_detail(file: FileId, analysis: &Analysis<'_>, findings: &Findings) -> FileDetail {
    let index = analysis.index();
    let commits = analysis.commits_touching(&[file]);
    FileDetail {
        path: index.paths.path_lossy(file),
        head: index.head.iter().find(|h| h.file == file).copied(),
        history: index.history_of(file),
        churn: analysis.churn_of(file),
        hotspot: findings.hotspots.iter().find(|h| h.file == file).copied(),
        former: index
            .paths
            .former_paths(file)
            .map(|p| String::from_utf8_lossy(p).into_owned())
            .collect(),
        owners: analysis
            .owners_of(file)
            .iter()
            .map(|o| person(index, o.author, o.commits))
            .collect(),
        coupled: findings
            .coupling
            .pairs
            .iter()
            .filter_map(|p| {
                let other = if p.first == file {
                    p.second
                } else if p.second == file {
                    p.first
                } else {
                    return None;
                };
                Some((index.paths.path_lossy(other), *p))
            })
            .collect(),
        more: commits.len().saturating_sub(COMMITS_SHOWN),
        commits: commit_lines(index, &commits),
    }
}

fn commit_lines(index: &Index, commits: &[&CommitMeta]) -> Vec<CommitLine> {
    commits
        .iter()
        .take(COMMITS_SHOWN)
        .map(|c| CommitLine {
            time: c.time,
            id: c.id.short(),
            author: index
                .author_of(c)
                .and_then(|a| index.authors.get(a))
                .map(|a| a.name.to_string())
                .unwrap_or_default(),
        })
        .collect()
}

fn person(index: &Index, author: AuthorId, commits: u32) -> Person {
    let found = index.authors.get(author);
    Person {
        name: found.map(|a| a.name.to_string()).unwrap_or_default(),
        email: found.map(|a| a.email.to_string()).unwrap_or_default(),
        commits,
    }
}
