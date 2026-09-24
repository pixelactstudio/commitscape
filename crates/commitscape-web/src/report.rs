//! The browser interface as one HTML file that needs no server, with the
//! web app and its data written into it.
//!
//! `commitscape report` holds, for every Window, each screen, the Map's
//! first two levels, the profiles of the people who made most commits, and
//! the card; what is left out (a file's details, deeper folders, filters)
//! says it is only in the live interface. `commitscape wrapped` holds one
//! person's year.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use commitscape_core::Index;
use commitscape_forge::history::History;
use commitscape_metrics::{Analysis, Options, Span};
use serde::Serialize;

use crate::{api, assets, screen, DrawCard, Snapshot};

/// How many people's profiles each Window carries.
const PROFILES: usize = 30;

/// Everything a report is made from, all of it read already.
pub struct Report {
    pub name: String,
    pub index: Index,
    pub anchor: i64,
    pub span: Span,
    pub options: Options,
    pub releases: Vec<(String, i64)>,
    pub lines_counted: bool,
    pub history: Option<History>,
    /// The GitHub login of each address GitHub linked to an account.
    pub accounts: HashMap<String, String>,
    pub card: Option<DrawCard>,
}

/// What the page finds in `window.__COMMITSCAPE__`.
#[derive(Serialize)]
struct Inlined {
    meta: api::Meta,
    /// Each answer by the request that asks for it, as [`key`] writes it.
    data: BTreeMap<String, serde_json::Value>,
    /// Each Window's card, as SVG.
    cards: BTreeMap<String, String>,
}

/// A request as the page writes it: its path, then its parameters sorted.
fn key(path: &str, params: &[(&str, &str)]) -> String {
    let mut params = params.to_vec();
    params.sort();
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", encode(v)))
        .collect();
    format!("{path}?{}", query.join("&"))
}

/// Percent-encodes as `encodeURIComponent` does.
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

/// The report, as one HTML page.
pub fn report(r: Report) -> String {
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
        // The Map's second level, and the busiest people's profiles.
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
        can_change_people: false,
        generation: 0,
    };
    let inlined = Inlined { meta, data, cards };
    page(
        "__COMMITSCAPE__",
        &serde_json::to_string(&inlined).unwrap_or_default(),
    )
}

/// The Wrapped page: the app, showing one person's year, as one file.
pub fn wrapped_page(year: &api::WrappedYear) -> String {
    page(
        "__COMMITSCAPE_WRAPPED__",
        &serde_json::to_string(year).unwrap_or_default(),
    )
}

/// The built app's page with its script and styles written into it, and
/// the data before them.
fn page(global: &str, json: &str) -> String {
    let (index, _) = assets::file("/index.html");
    let mut html = String::from_utf8_lossy(index).into_owned();
    // In a script, `</` would end it early: JSON allows `<\/` for it.
    let data = format!(
        "<script>window.{global} = {};</script>",
        json.replace("</", "<\\/")
    );
    let mut head = data;
    let mut kept = String::new();
    for line in html.lines() {
        let t = line.trim();
        if let Some(src) = attribute(t, "<script", "src") {
            let (js, _) = assets::file(&src);
            let js = String::from_utf8_lossy(js).replace("</script", "<\\/script");
            head.push_str(&format!("<script type=\"module\">{js}</script>"));
        } else if let Some(href) = attribute(t, "<link rel=\"stylesheet\"", "href") {
            let (css, _) = assets::file(&href);
            head.push_str(&format!(
                "<style>{}</style>",
                String::from_utf8_lossy(css).replace("</style", "<\\/style")
            ));
        } else if t.starts_with("<link rel=\"icon\"") {
            // The icon is a file beside the page: a report has none.
        } else {
            kept.push_str(line);
            kept.push('\n');
        }
    }
    html = kept.replacen("</head>", &format!("{head}</head>"), 1);
    html
}

/// The value of `name` in a tag that starts with `tag`.
fn attribute(line: &str, tag: &str, name: &str) -> Option<String> {
    if !line.starts_with(tag) {
        return None;
    }
    let start = line.find(&format!("{name}=\""))? + name.len() + 2;
    let rest = line.get(start..)?;
    Some(rest.get(..rest.find('"')?)?.to_string())
}
