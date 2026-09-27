use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use commitscape_core::Index;
use commitscape_forge::history::History;
use commitscape_metrics::{Analysis, Options, Span};
use serde::Serialize;

use crate::{api, screen, DrawCard, Snapshot};

const PROFILES: usize = 30;

pub struct Report {
    pub name: String,
    pub index: Index,
    pub anchor: i64,
    pub span: Span,
    pub options: Options,
    pub releases: Vec<(String, i64)>,
    pub lines_counted: bool,
    pub history: Option<History>,
    pub accounts: HashMap<String, String>,
    pub card: Option<DrawCard>,
    pub avatars: bool,
    pub commit_link: Option<String>,
    pub emails: bool,
}

#[derive(Serialize)]
struct Inlined {
    meta: api::Meta,
    data: BTreeMap<String, serde_json::Value>,
    cards: BTreeMap<String, String>,
    stats: Option<api::Stats>,
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

/// A repository's Report as JSON: every screen's answer for every Window, and each Window's card.
pub fn data(r: Report) -> String {
    let accounts = r.accounts;
    let colours = api::colours(&r.index);
    let logins = api::logins(&r.index, &accounts);
    let snap = Snapshot {
        index: Arc::new(r.index),
        anchor: r.anchor,
        span: r.span,
        options: r.options,
        releases: r.releases,
        lines_counted: r.lines_counted,
        history: r.history.map(Arc::new),
        colours: Arc::new(colours),
        logins: Arc::new(logins),
        commit_link: r.commit_link,
        emails: r.emails,
    };
    let mut data = BTreeMap::new();
    let mut cards = BTreeMap::new();
    let mut ask = |path: &str, params: &[(&str, &str)]| {
        let p: HashMap<String, String> = params
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let answer = screen(&snap, path, &p)
            .ok()
            .and_then(|body| serde_json::from_slice::<serde_json::Value>(&body).ok());
        if let Some(value) = answer {
            data.insert(key(path, params), value);
        }
    };
    ask("/api/commits", &[]);
    for span in Span::EVERY {
        let w = span.label();
        for path in ["/api/overview", "/api/activity", "/api/people", "/api/risk"] {
            ask(path, &[("window", w)]);
        }
        ask("/api/map", &[("window", w)]);
        let window = span.window(snap.anchor);
        let Ok(a) = Analysis::new(&snap.index, window, snap.options) else {
            continue;
        };
        let top: Vec<String> = a
            .contributors()
            .iter()
            .take(PROFILES)
            .map(|c| c.author.0.to_string())
            .collect();
        let map = a.code_map();
        let folders: Vec<String> = map
            .nodes
            .iter()
            .find(|n| n.path.is_empty())
            .map(|root| {
                root.children
                    .iter()
                    .filter_map(|&c| map.nodes.get(c))
                    .filter(|n| n.file.is_none())
                    .map(|n| n.path.clone())
                    .collect()
            })
            .unwrap_or_default();
        drop(map);
        drop(a);
        for id in &top {
            ask("/api/person", &[("window", w), ("id", id)]);
        }
        for folder in &folders {
            ask("/api/map", &[("window", w), ("path", folder)]);
        }
        if let Some(draw) = &r.card {
            cards.insert(w.to_string(), draw(&snap.index, span, snap.anchor));
        }
    }
    let meta = api::Meta {
        name: r.name,
        windows: Span::EVERY.iter().map(|w| w.label().to_string()).collect(),
        window: r.span.label().to_string(),
        anchor: r.anchor,
        history: "complete".to_string(),
        lines: if r.lines_counted { "counted" } else { "off" }.to_string(),
        github: if snap.history.is_some() {
            "ready".to_string()
        } else {
            "unavailable: not read for this report".to_string()
        },
        github_history: if snap.history.is_some() {
            "complete".to_string()
        } else {
            "off".to_string()
        },
        avatars: r.avatars,
    };
    let stats = api::Stats::of(&snap.index, snap.anchor, snap.options, &snap.releases);
    let inlined = Inlined {
        meta,
        data,
        cards,
        stats,
    };
    serde_json::to_string(&inlined).unwrap_or_default()
}
