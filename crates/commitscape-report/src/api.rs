use std::collections::HashMap;

use commitscape_core::{AuthorId, FileClass, Index, PersonTraits};
use commitscape_metrics::{Analysis, CodeMap, Contribution, Contributor, Moment, Ownership, Work};
use serde::Serialize;

const DAY: i64 = 86_400;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Meta {
    pub name: String,
    pub windows: Vec<String>,
    pub window: String,
    pub anchor: i64,
    pub history: String,
    pub lines: String,
    pub avatars: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PersonRef {
    pub id: u32,
    pub name: String,
    pub colour: Option<u8>,
    pub login: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Overview {
    pub window: String,
    pub totals: Totals,
    pub languages: Vec<Language>,
    pub commits: u32,
    pub active_days: u32,
    pub first_day: i64,
    pub days: Vec<u32>,
    pub people: Vec<PersonCommits>,
    pub timeline: Vec<TimelineMoment>,
    pub facts: Vec<Fact>,
    pub code_age: Vec<QuarterLines>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Totals {
    pub commits: u64,
    pub merges: u64,
    pub people: u32,
    pub files: u32,
    pub code_files: u32,
    pub code_lines: u64,
    pub prose_lines: u64,
    pub first_commit: Option<i64>,
    pub last_commit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Language {
    pub name: String,
    pub lines: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PersonCommits {
    pub person: PersonRef,
    pub commits: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct TimelineMoment {
    pub kind: String,
    pub time: i64,
    pub person: Option<PersonRef>,
    pub name: Option<String>,
    pub count: Option<u64>,
    pub until: Option<i64>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Fact {
    pub kind: String,
    pub value: f64,
    pub other: Option<f64>,
    pub subject: Option<String>,
    pub time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct QuarterLines {
    pub year: i32,
    pub quarter: u32,
    pub lines: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Activity {
    pub window: String,
    pub first_day: i64,
    pub people: Vec<PersonRef>,
    pub days: Vec<Vec<u32>>,
    pub releases: Vec<Release>,
    pub week: Vec<Vec<u32>>,
    pub kinds: Vec<KindCount>,
    pub unclassified: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Release {
    pub name: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct KindCount {
    pub kind: String,
    pub commits: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct People {
    pub window: String,
    pub people: Vec<PersonRow>,
    pub bots: Vec<PersonCommits>,
    pub suspects: Vec<Vec<PersonRef>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PersonRow {
    pub person: PersonRef,
    pub commits: u32,
    pub active_days: u32,
    pub first: i64,
    pub last: i64,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub areas: u32,
    pub identities: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Person {
    pub person: PersonRef,
    pub email: String,
    pub row: Option<PersonRow>,
    pub addresses: Vec<Address>,
    pub traits: Vec<String>,
    pub mailmap: String,
    pub first_day: i64,
    pub days: Vec<u32>,
    pub week: Vec<Vec<u32>>,
    pub longest_streak: Option<u32>,
    pub work: Vec<PathCount>,
    pub areas: Vec<Area>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Address {
    pub email: String,
    pub commits: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PathCount {
    pub path: String,
    pub commits: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Area {
    pub folder: String,
    pub theirs: u32,
    pub all: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct MapLevel {
    pub path: String,
    pub children: Vec<MapBlock>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct MapBlock {
    pub name: String,
    pub path: String,
    pub file: bool,
    pub lines: u64,
    pub files: u32,
    pub churn: u32,
    pub last_touched: i64,
    pub owner: Option<PersonRef>,
    pub inside: Vec<MapBlock>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct File {
    pub path: String,
    pub lines: Option<u32>,
    pub class: Option<String>,
    pub churn: u32,
    pub first_seen: Option<i64>,
    pub last_touched: Option<i64>,
    pub owners: Vec<PersonCommits>,
    pub coupled: Vec<Coupled>,
    pub commits: Vec<CommitLine>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Coupled {
    pub path: String,
    pub together: u32,
    pub degree: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CommitLine {
    pub id: String,
    pub time: i64,
    pub person: Option<PersonRef>,
}

pub struct Context<'a> {
    pub window: &'a str,
    pub colours: &'a HashMap<AuthorId, u8>,
    pub releases: &'a [(String, i64)],
    pub lines_counted: bool,
    pub login_of: &'a HashMap<AuthorId, String>,
    pub emails: bool,
}

pub struct Shared {
    pub contributors: Vec<Contributor>,
    pub ownership: Ownership,
    pub contributions: Vec<Contribution>,
    pub map: CodeMap,
}

impl Shared {
    /// Works out the contributors, ownership, contributions and code map of one Window.
    pub fn of(a: &Analysis<'_>) -> Shared {
        let ((contributors, ownership), (lines, map)) = rayon::join(
            || rayon::join(|| a.contributors(), || a.ownership()),
            || rayon::join(|| a.lines_by_person(), || a.code_map()),
        );
        let contributions = commitscape_metrics::combine(&contributors, &ownership, &lines);
        Shared {
            contributors,
            ownership,
            contributions,
            map,
        }
    }
}

impl Context<'_> {
    fn person(&self, index: &Index, id: AuthorId) -> PersonRef {
        PersonRef {
            id: id.0,
            name: index
                .authors
                .get(id)
                .map(|a| a.name.to_string())
                .unwrap_or_default(),
            colour: self.colours.get(&id).copied(),
            login: self.login_of.get(&id).cloned(),
        }
    }
}

pub fn login_of(logins: &HashMap<String, AuthorId>) -> HashMap<AuthorId, String> {
    let mut out: HashMap<AuthorId, String> = HashMap::new();
    for (login, &id) in logins {
        let e = out.entry(id).or_insert_with(|| login.clone());
        if login < e {
            e.clone_from(login);
        }
    }
    out
}

pub fn colours(index: &Index) -> HashMap<AuthorId, u8> {
    let used = index.authors.used();
    let mut people: Vec<(u32, AuthorId)> = index
        .authors
        .iter()
        .filter(|(_, a)| !a.traits.is_bot())
        .map(|(id, a)| {
            let n = a
                .signatures
                .iter()
                .map(|s| used.get(s.idx()).copied().unwrap_or(0))
                .sum();
            (n, id)
        })
        .collect();
    people.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    people
        .into_iter()
        .take(8)
        .enumerate()
        .map(|(i, (_, id))| (id, i as u8))
        .collect()
}

pub fn logins(index: &Index, accounts: &HashMap<String, String>) -> HashMap<String, AuthorId> {
    let mut out = HashMap::new();
    for (id, a) in index.authors.iter() {
        for s in a.signatures {
            let Some(sig) = index.authors.signature(*s) else {
                continue;
            };
            let email = sig.email.to_ascii_lowercase();
            if let Some(login) = accounts.get(&email) {
                out.insert(login.to_ascii_lowercase(), id);
            }
            if let Some(local) = email.strip_suffix("@users.noreply.github.com") {
                let login = local.rsplit('+').next().unwrap_or(local);
                out.insert(login.to_string(), id);
            }
        }
    }
    out
}

fn percent(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        0.0
    } else {
        (part as f64 * 100.0 / whole as f64).round()
    }
}

impl Overview {
    pub fn of(a: &Analysis<'_>, cx: &Context<'_>, shared: &Shared) -> Overview {
        let index: &Index = a.index();
        let t = a.totals();
        let pulse = a.pulse(None);
        let contributors = &shared.contributors;
        let path = |f| index.paths.path_lossy(f);

        let timeline = a
            .timeline(cx.releases)
            .into_iter()
            .map(|m| {
                let mut out = TimelineMoment {
                    kind: String::new(),
                    time: m.time(),
                    person: None,
                    name: None,
                    count: None,
                    until: None,
                    from: None,
                    to: None,
                };
                match m {
                    Moment::FirstCommit { author, .. } => {
                        out.kind = "first_commit".into();
                        out.person = author.map(|p| cx.person(index, p));
                    }
                    Moment::Release { name, .. } => {
                        out.kind = "release".into();
                        out.name = Some(name);
                    }
                    Moment::Joined { author, .. } => {
                        out.kind = "joined".into();
                        out.person = Some(cx.person(index, author));
                    }
                    Moment::Left { author, .. } => {
                        out.kind = "left".into();
                        out.person = Some(cx.person(index, author));
                    }
                    Moment::BusiestDay { commits, .. } => {
                        out.kind = "busiest_day".into();
                        out.count = Some(u64::from(commits));
                    }
                    Moment::Cleanup {
                        author, removed, ..
                    } => {
                        out.kind = "cleanup".into();
                        out.person = author.map(|p| cx.person(index, p));
                        out.count = Some(removed);
                    }
                    Moment::Quiet { until, .. } => {
                        out.kind = "quiet".into();
                        out.until = Some(until);
                    }
                    Moment::LanguageShift { from, to, .. } => {
                        out.kind = "language_shift".into();
                        out.from = Some(from.to_string());
                        out.to = Some(to.to_string());
                    }
                }
                out
            })
            .collect();

        let mut facts = Vec::new();
        let total = u64::from(pulse.commits);
        let fact = |kind: &str, value: f64| Fact {
            kind: kind.to_string(),
            value,
            other: None,
            subject: None,
            time: None,
        };
        if total >= 20 {
            let night = u64::from(pulse.night());
            let weekend = u64::from(pulse.weekend());
            if night * 4 >= total {
                facts.push(fact("night", percent(night, total)));
            }
            if weekend * 10 >= total * 3 {
                facts.push(fact("weekend", percent(weekend, total)));
            }
            if let Some((day, n)) = pulse.busiest_day {
                let usual = total as f64 / f64::from(pulse.active_days.max(1));
                if n >= 10 && f64::from(n) >= 5.0 * usual {
                    facts.push(Fact {
                        other: Some((usual * 10.0).round() / 10.0),
                        time: Some(day * DAY),
                        ..fact("busiest_day", f64::from(n))
                    });
                }
            }
            if let Some(s) = pulse.longest_streak.filter(|s| s.days >= 21) {
                facts.push(Fact {
                    time: Some(s.first_day * DAY),
                    ..fact("streak", f64::from(s.days))
                });
            }
            let of = |w: Work| {
                pulse
                    .work
                    .iter()
                    .find(|x| x.work == w)
                    .map_or(0, |x| x.commits)
            };
            let (fixes, features) = (of(Work::Fix), of(Work::Feature));
            if fixes >= 10 && fixes >= 2 * features {
                facts.push(Fact {
                    other: Some(f64::from(features)),
                    ..fact("fixes", f64::from(fixes))
                });
            }
            if let Some(c) = a.churn().first() {
                if u64::from(c.commits) * 5 >= total {
                    facts.push(Fact {
                        subject: Some(path(c.file)),
                        other: Some(total as f64),
                        ..fact("hottest_file", f64::from(c.commits))
                    });
                }
            }
        }
        let staleness = a.staleness();
        if let Some(l) = a.largest().first().filter(|l| l.loc >= 5_000) {
            facts.push(Fact {
                subject: Some(path(l.file)),
                ..fact("biggest_file", f64::from(l.loc))
            });
        }
        if let Some(s) = staleness.files.first().filter(|s| s.days >= 3 * 365) {
            facts.push(Fact {
                subject: Some(path(s.file)),
                ..fact("untouched", s.days as f64)
            });
        }

        Overview {
            window: cx.window.to_string(),
            totals: Totals {
                commits: t.commits,
                merges: t.merges,
                people: t.people as u32,
                files: t.files,
                code_files: t.code_files,
                code_lines: t.code_lines,
                prose_lines: t.prose_lines,
                first_commit: t.first_commit,
                last_commit: t.last_commit,
            },
            languages: a
                .languages()
                .languages
                .iter()
                .map(|l| Language {
                    name: l.name.to_string(),
                    lines: l.lines,
                })
                .collect(),
            commits: pulse.commits,
            active_days: pulse.active_days,
            first_day: pulse.first_day,
            days: pulse.days.clone(),
            people: contributors
                .iter()
                .map(|c| PersonCommits {
                    person: cx.person(index, c.author),
                    commits: c.commits,
                })
                .collect(),
            timeline,
            facts,
            code_age: a
                .code_age()
                .iter()
                .map(|q| QuarterLines {
                    year: q.year as i32,
                    quarter: q.quarter,
                    lines: q.lines,
                })
                .collect(),
        }
    }
}

impl Activity {
    pub fn of(a: &Analysis<'_>, cx: &Context<'_>, shared: &Shared) -> Activity {
        let index = a.index();
        let pulse = a.pulse(None);
        let split = a.commits_by_person_in(&pulse, &shared.contributors, 5);
        let window = a.window();
        let mut releases: Vec<Release> = cx
            .releases
            .iter()
            .map(|(name, time)| Release {
                name: name.clone(),
                time: *time,
            })
            .collect();
        releases.retain(|r| window.contains(r.time));
        releases.sort_by_key(|r| r.time);

        let total = pulse.commits;
        let unclassified = pulse
            .work
            .iter()
            .find(|w| w.work == Work::Unclassified)
            .map_or(0, |w| w.commits);
        let kinds = if total == 0 || unclassified * 2 > total {
            Vec::new()
        } else {
            let mut k: Vec<KindCount> = pulse
                .work
                .iter()
                .filter(|w| w.commits > 0 && w.work != Work::Unclassified)
                .map(|w| KindCount {
                    kind: w.work.label().to_string(),
                    commits: w.commits,
                })
                .collect();
            k.sort_by_key(|k| std::cmp::Reverse(k.commits));
            k
        };

        Activity {
            window: cx.window.to_string(),
            first_day: split.first_day,
            people: split.people.iter().map(|&p| cx.person(index, p)).collect(),
            days: split.days,
            releases,
            week: pulse.week.iter().map(|d| d.to_vec()).collect(),
            kinds,
            unclassified,
        }
    }
}

impl People {
    pub fn of(a: &Analysis<'_>, cx: &Context<'_>, shared: &Shared) -> People {
        let index = a.index();
        let rows = shared
            .contributors
            .iter()
            .zip(&shared.contributions)
            .map(|(c, x)| row(index, cx, c, x))
            .collect();
        People {
            window: cx.window.to_string(),
            people: rows,
            bots: a
                .bots()
                .iter()
                .map(|b| PersonCommits {
                    person: cx.person(index, b.author),
                    commits: b.commits,
                })
                .collect(),
            suspects: a
                .suspected_duplicates()
                .iter()
                .map(|g| g.people.iter().map(|&p| cx.person(index, p)).collect())
                .collect(),
        }
    }
}

fn row(
    index: &Index,
    cx: &Context<'_>,
    c: &commitscape_metrics::Contributor,
    x: &commitscape_metrics::Contribution,
) -> PersonRow {
    PersonRow {
        person: cx.person(index, c.author),
        commits: c.commits,
        active_days: c.active_days,
        first: c.first,
        last: c.last,
        lines_added: cx.lines_counted.then_some(x.lines.added),
        lines_removed: cx.lines_counted.then_some(x.lines.removed),
        areas: x.areas,
        identities: index.authors.addresses_of(c.author).len().max(1) as u32,
    }
}

impl Person {
    pub fn of(a: &Analysis<'_>, cx: &Context<'_>, shared: &Shared, id: AuthorId) -> Option<Person> {
        let index = a.index();
        let author = index.authors.get(id)?;
        let pulse = a.pulse(Some(id));
        let row = shared
            .contributors
            .iter()
            .zip(&shared.contributions)
            .find(|(c, _)| c.author == id)
            .map(|(c, x)| row(index, cx, c, x));
        let traits = [
            (PersonTraits::SAME_NAME, "same_name"),
            (PersonTraits::SAME_ACCOUNT, "same_account"),
            (PersonTraits::KEPT_APART, "kept_apart"),
            (PersonTraits::BOT, "bot"),
        ]
        .iter()
        .filter(|(t, _)| author.traits.contains(*t))
        .map(|(_, w)| w.to_string())
        .collect();
        Some(Person {
            person: cx.person(index, id),
            email: if cx.emails {
                author.email.to_string()
            } else {
                String::new()
            },
            row,
            addresses: if cx.emails {
                index
                    .authors
                    .addresses_of(id)
                    .into_iter()
                    .map(|(email, commits)| Address { email, commits })
                    .collect()
            } else {
                Vec::new()
            },
            traits,
            mailmap: if cx.emails {
                index.authors.mailmap_lines(id)
            } else {
                String::new()
            },
            first_day: pulse.first_day,
            days: pulse.days,
            week: pulse.week.iter().map(|d| d.to_vec()).collect(),
            longest_streak: pulse.longest_streak.map(|s| s.days),
            work: a
                .work_of(id)
                .iter()
                .take(20)
                .map(|w| PathCount {
                    path: index.paths.path_lossy(w.file),
                    commits: w.commits,
                })
                .collect(),
            areas: shared
                .ownership
                .held_alone()
                .into_iter()
                .filter_map(|d| {
                    let top = d.owners.first()?;
                    (top.author == id).then(|| Area {
                        folder: d.label(),
                        theirs: top.commits,
                        all: d.commits,
                    })
                })
                .collect(),
        })
    }
}

impl MapLevel {
    pub fn of(a: &Analysis<'_>, cx: &Context<'_>, shared: &Shared, path: &str) -> Option<MapLevel> {
        let index = a.index();
        let map = &shared.map;
        let at = map.nodes.iter().position(|n| n.path == path)?;
        let block = |i: usize, depth: u8| -> Option<MapBlock> {
            fn build(
                map: &commitscape_metrics::CodeMap,
                index: &Index,
                cx: &Context<'_>,
                i: usize,
                depth: u8,
            ) -> Option<MapBlock> {
                let n = map.nodes.get(i)?;
                Some(MapBlock {
                    name: n.name.clone(),
                    path: n.path.clone(),
                    file: n.file.is_some(),
                    lines: n.lines,
                    files: n.files,
                    churn: n.churn,
                    last_touched: n.last_touched,
                    owner: n.owner.map(|o| cx.person(index, o.author)),
                    inside: if depth == 0 {
                        Vec::new()
                    } else {
                        n.children
                            .iter()
                            .take(40)
                            .filter_map(|&c| build(map, index, cx, c, depth - 1))
                            .collect()
                    },
                })
            }
            build(map, index, cx, i, depth)
        };
        let here = map.nodes.get(at)?;
        Some(MapLevel {
            path: path.to_string(),
            children: here
                .children
                .iter()
                .take(200)
                .filter_map(|&c| block(c, 1))
                .collect(),
        })
    }
}

impl File {
    pub fn of(a: &Analysis<'_>, cx: &Context<'_>, path: &str) -> Option<File> {
        let index = a.index();
        let id = index.paths.get(path.as_bytes())?;
        let head = index.head.iter().find(|h| h.file == id);
        let history = index.history_of(id);
        let coupling = a.coupling();
        let mut coupled: Vec<Coupled> = coupling
            .pairs
            .iter()
            .filter_map(|p| {
                let other = if p.first == id {
                    p.second
                } else if p.second == id {
                    p.first
                } else {
                    return None;
                };
                Some(Coupled {
                    path: index.paths.path_lossy(other),
                    together: p.both,
                    degree: (p.jaccard * 100.0).round() / 100.0,
                })
            })
            .collect();
        coupled.sort_by(|x, y| y.degree.total_cmp(&x.degree));
        coupled.truncate(12);
        Some(File {
            path: path.to_string(),
            lines: head.map(|h| h.loc),
            class: head.map(|h| {
                match h.class {
                    FileClass::Source => "source",
                    FileClass::Prose => "prose",
                    FileClass::Generated => "generated",
                    FileClass::Vendored => "vendored",
                    FileClass::Binary => "binary",
                    _ => "symlink",
                }
                .to_string()
            }),
            churn: a.churn_of(id),
            first_seen: history.map(|h| h.first_seen),
            last_touched: history.map(|h| h.last_touched),
            owners: a
                .owners_of(id)
                .iter()
                .map(|o| PersonCommits {
                    person: cx.person(index, o.author),
                    commits: o.commits,
                })
                .collect(),
            coupled,
            commits: a
                .commits_touching(&[id])
                .into_iter()
                .take(30)
                .map(|c| CommitLine {
                    id: c.id.to_string(),
                    time: c.time,
                    person: index.author_of(c).map(|p| cx.person(index, p)),
                })
                .collect(),
        })
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CommitList {
    pub link: Option<String>,
    pub lines: bool,
    pub kinds: Vec<String>,
    pub people: Vec<CommitPerson>,
    pub ids: Vec<String>,
    pub times: Vec<i64>,
    pub offsets: Vec<i16>,
    pub person: Vec<u32>,
    pub subjects: Vec<String>,
    pub kind: Vec<u8>,
    pub merge: Vec<bool>,
    pub files: Vec<u32>,
    pub added: Vec<Option<u32>>,
    pub removed: Vec<Option<u32>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CommitPerson {
    pub person: PersonRef,
    pub emails: Vec<String>,
}

impl CommitList {
    pub fn of(index: &Index, cx: &Context<'_>, link: Option<&str>, emails: bool) -> CommitList {
        let mut out = CommitList {
            link: link.map(str::to_string),
            lines: cx.lines_counted,
            kinds: commitscape_core::CommitKind::EVERY
                .iter()
                .map(|k| k.label().to_string())
                .collect(),
            people: Vec::new(),
            ids: Vec::with_capacity(index.commits.len()),
            times: Vec::with_capacity(index.commits.len()),
            offsets: Vec::with_capacity(index.commits.len()),
            person: Vec::with_capacity(index.commits.len()),
            subjects: Vec::with_capacity(index.commits.len()),
            kind: Vec::with_capacity(index.commits.len()),
            merge: Vec::with_capacity(index.commits.len()),
            files: Vec::with_capacity(index.commits.len()),
            added: Vec::with_capacity(index.commits.len()),
            removed: Vec::with_capacity(index.commits.len()),
        };
        let mut seen: HashMap<Option<AuthorId>, u32> = HashMap::new();
        for c in index.commits.iter().rev() {
            let who = index.author_of(c);
            let next = seen.len() as u32;
            let at = *seen.entry(who).or_insert_with(|| {
                out.people.push(match who {
                    Some(id) => CommitPerson {
                        person: cx.person(index, id),
                        emails: if emails {
                            index
                                .authors
                                .addresses_of(id)
                                .into_iter()
                                .map(|(email, _)| email)
                                .collect()
                        } else {
                            Vec::new()
                        },
                    },
                    None => CommitPerson {
                        person: PersonRef {
                            id: u32::MAX,
                            name: "someone unknown".to_string(),
                            colour: None,
                            login: None,
                        },
                        emails: Vec::new(),
                    },
                });
                next
            });
            let changes = index.changes_of(c);
            let (mut added, mut removed) = (0u32, 0u32);
            for ch in changes {
                if let Some(l) = ch.lines {
                    added = added.saturating_add(l.added);
                    removed = removed.saturating_add(l.removed);
                }
            }
            out.ids.push(c.id.to_string());
            out.times.push(c.time + i64::from(c.author_delta));
            out.offsets.push(c.offset_minutes);
            out.person.push(at);
            out.subjects.push(index.subject_of(c).to_string());
            out.kind.push(
                commitscape_core::CommitKind::EVERY
                    .iter()
                    .position(|k| *k == c.kind)
                    .unwrap_or(0) as u8,
            );
            out.merge.push(c.is_merge());
            out.files.push(c.changes_len);
            out.added.push(cx.lines_counted.then_some(added));
            out.removed.push(cx.lines_counted.then_some(removed));
        }
        out
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Surviving {
    pub head: String,
    pub people: Vec<SurvivingPerson>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct SurvivingPerson {
    pub id: u32,
    pub name: Option<String>,
    pub status: SurvivingStatus,
    pub surviving: Option<u64>,
    pub added: Option<u64>,
    pub files: u32,
    pub oldest: Option<i64>,
    pub seconds: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum SurvivingStatus {
    Counted,
    OverBudget,
    UnknownPerson,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Stats {
    pub commits: u64,
    pub people: u32,
    pub bus_factor: Option<u32>,
    pub maintainers: u32,
    pub commits_30d: u32,
    pub people_30d: u32,
    pub code_lines: u64,
    pub untouched_5y: u64,
}

impl Stats {
    pub fn of(
        index: &Index,
        anchor: i64,
        options: commitscape_metrics::Options,
        releases: &[(String, i64)],
    ) -> Stats {
        let all = Analysis::new(index, commitscape_metrics::Window::all(anchor), options);
        let totals = all.totals();
        let health = all.health(releases, None);
        let month = Analysis::new(
            index,
            commitscape_metrics::Span::Month.window(anchor),
            options,
        );
        let (commits_30d, people_30d) = month.activity();
        let cutoff = anchor - 5 * 365 * DAY;
        let untouched_5y = index
            .head
            .iter()
            .filter(|h| h.class.is_code())
            .filter(|h| {
                index
                    .history_of(h.file)
                    .is_some_and(|f| f.last_touched < cutoff)
            })
            .map(|h| u64::from(h.loc))
            .sum();
        Stats {
            commits: totals.commits - totals.merges,
            people: totals.people as u32,
            bus_factor: health.bus_factor,
            maintainers: health.maintainers.len() as u32,
            commits_30d,
            people_30d,
            code_lines: totals.code_lines,
            untouched_5y,
        }
    }
}

#[cfg(test)]
mod types {

    use ts_rs::{Config, TS};

    use super::*;

    fn generated() -> String {
        let cfg = Config::new().with_large_int("number");
        let mut out = String::from(
            "// Generated from crates/commitscape-report/src/api.rs by its tests. Do not edit.\n",
        );
        for decl in [
            Meta::decl(&cfg),
            PersonRef::decl(&cfg),
            Overview::decl(&cfg),
            Totals::decl(&cfg),
            Language::decl(&cfg),
            PersonCommits::decl(&cfg),
            TimelineMoment::decl(&cfg),
            Fact::decl(&cfg),
            QuarterLines::decl(&cfg),
            Activity::decl(&cfg),
            Release::decl(&cfg),
            KindCount::decl(&cfg),
            People::decl(&cfg),
            PersonRow::decl(&cfg),
            Person::decl(&cfg),
            Address::decl(&cfg),
            PathCount::decl(&cfg),
            Area::decl(&cfg),
            MapLevel::decl(&cfg),
            MapBlock::decl(&cfg),
            File::decl(&cfg),
            Coupled::decl(&cfg),
            CommitLine::decl(&cfg),
            CommitList::decl(&cfg),
            CommitPerson::decl(&cfg),
            Stats::decl(&cfg),
            Surviving::decl(&cfg),
            SurvivingPerson::decl(&cfg),
            SurvivingStatus::decl(&cfg),
        ] {
            out.push_str("\nexport ");
            out.push_str(&decl);
            out.push('\n');
        }
        out
    }

    #[test]
    fn the_web_apps_types_match_the_api() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/data/src/types.ts");
        let now = generated();
        if std::env::var_os("COMMITSCAPE_UPDATE_TYPES").is_some() {
            let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
            let _ = std::fs::write(&path, &now);
            return;
        }
        let written = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            written == now,
            "packages/data/src/types.ts is out of date: run COMMITSCAPE_UPDATE_TYPES=1 cargo test -p commitscape-report"
        );
    }
}
