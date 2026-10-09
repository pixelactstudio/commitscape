use std::collections::{BTreeMap, HashMap};

use commitscape_core::{AuthorId, Index};
use commitscape_metrics::{Analysis, Options, Span};
use rayon::prelude::*;
use serde::Serialize;

use crate::api;

const PROFILES: usize = 30;

const COMMITS: &str = "/api/commits?";

pub struct Report {
    pub name: String,
    pub index: Index,
    pub anchor: i64,
    pub span: Span,
    pub options: Options,
    pub releases: Vec<(String, i64)>,
    pub lines_counted: bool,
    pub accounts: HashMap<String, String>,
    pub avatars: bool,
    pub commit_link: Option<String>,
    pub emails: bool,
}

pub struct Written {
    pub report: String,
    pub commits: Option<String>,
}

#[derive(Serialize)]
struct Inlined {
    meta: api::Meta,
    data: BTreeMap<String, serde_json::Value>,
    stats: api::Stats,
}

fn key(path: &str, params: &[(&str, &str)]) -> String {
    let mut params = params.to_vec();
    params.sort();
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", encode(v)))
        .collect();
    format!("{path}?{}", query.join("&"))
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn value(answer: impl Serialize) -> Option<serde_json::Value> {
    serde_json::to_value(answer).ok()
}

enum Screen {
    Overview,
    Activity,
    People,
    Map(String),
    Person(AuthorId),
}

fn window(
    index: &Index,
    span: Span,
    anchor: i64,
    options: Options,
    cx: &api::Context<'_>,
) -> Vec<(String, serde_json::Value)> {
    let a = Analysis::new(index, span.window(anchor), options);
    let shared = api::Shared::of(&a);
    let w = span.label();
    let folders = shared
        .map
        .nodes
        .iter()
        .find(|n| n.path.is_empty())
        .map(|root| {
            root.children
                .iter()
                .filter_map(|&c| shared.map.nodes.get(c))
                .filter(|n| n.file.is_none())
                .map(|n| n.path.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut screens = vec![
        Screen::Overview,
        Screen::Activity,
        Screen::People,
        Screen::Map(String::new()),
    ];
    screens.extend(
        shared
            .contributors
            .iter()
            .take(PROFILES)
            .map(|c| Screen::Person(c.author)),
    );
    screens.extend(folders.into_iter().map(Screen::Map));
    let cx = api::Context { window: w, ..*cx };
    screens
        .into_par_iter()
        .filter_map(|screen| match screen {
            Screen::Overview => Some((
                key("/api/overview", &[("window", w)]),
                value(api::Overview::of(&a, &cx, &shared))?,
            )),
            Screen::Activity => Some((
                key("/api/activity", &[("window", w)]),
                value(api::Activity::of(&a, &cx, &shared))?,
            )),
            Screen::People => Some((
                key("/api/people", &[("window", w)]),
                value(api::People::of(&a, &cx, &shared))?,
            )),
            Screen::Map(path) => {
                let level = api::MapLevel::of(&a, &cx, &shared, &path)?;
                let params: &[(&str, &str)] = if path.is_empty() {
                    &[("window", w)]
                } else {
                    &[("window", w), ("path", &path)]
                };
                Some((key("/api/map", params), value(level)?))
            }
            Screen::Person(id) => {
                let person = api::Person::of(&a, &cx, &shared, id)?;
                let id = id.0.to_string();
                Some((
                    key("/api/person", &[("window", w), ("id", &id)]),
                    value(person)?,
                ))
            }
        })
        .collect()
}

/// A repository's Report as JSON: every screen's answer for every Window, with the commit list inside.
pub fn data(r: Report) -> String {
    write(r, false).report
}

/// Writes a repository's Report, and with `commits_apart` its commit list as its own JSON rather than inside the Report.
pub fn write(r: Report, commits_apart: bool) -> Written {
    let colours = api::colours(&r.index);
    let logins = api::logins(&r.index, &r.accounts);
    let login_of = api::login_of(&logins);
    let index = &r.index;
    let cx = api::Context {
        window: "all",
        colours: &colours,
        releases: &r.releases,
        lines_counted: r.lines_counted,
        login_of: &login_of,
        emails: r.emails,
    };
    let ((windows, commits), stats) = rayon::join(
        || {
            rayon::join(
                || {
                    Span::EVERY
                        .par_iter()
                        .flat_map_iter(|&span| window(index, span, r.anchor, r.options, &cx))
                        .collect::<Vec<_>>()
                },
                || {
                    let list = api::CommitList::of(index, &cx, r.commit_link.as_deref(), r.emails);
                    serde_json::to_value(&list).unwrap_or_default()
                },
            )
        },
        || api::Stats::of(index, r.anchor, r.options, &r.releases),
    );
    let mut data: BTreeMap<String, serde_json::Value> = windows.into_iter().collect();
    let commits = if commits_apart {
        Some(commits.to_string())
    } else {
        data.insert(COMMITS.to_string(), commits);
        None
    };
    let meta = api::Meta {
        name: r.name,
        windows: Span::EVERY.iter().map(|w| w.label().to_string()).collect(),
        window: r.span.label().to_string(),
        anchor: r.anchor,
        history: "complete".to_string(),
        lines: if r.lines_counted { "counted" } else { "off" }.to_string(),
        avatars: r.avatars,
    };
    let inlined = Inlined { meta, data, stats };
    Written {
        report: serde_json::to_string(&inlined).unwrap_or_default(),
        commits,
    }
}
