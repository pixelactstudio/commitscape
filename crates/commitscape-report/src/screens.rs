use std::collections::HashMap;

use commitscape_core::AuthorId;
use commitscape_metrics::{Analysis, Span};
use serde::Serialize;
use serde_json::Value;

use crate::api;
use crate::pack::Pack;

/// The Windows whose screens are worked out ahead for every head.
pub const SPANS: [Span; 3] = [Span::All, Span::Year, Span::Quarter];

fn value(answer: impl Serialize) -> Option<Value> {
    serde_json::to_value(answer).ok()
}

/// The key the Site asks an answer by: its path, then its parameters sorted and escaped as `encodeURIComponent` escapes them.
pub fn key(path: &str, params: &[(&str, &str)]) -> String {
    let mut params = params.to_vec();
    params.sort_unstable();
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| {
            let mut out = format!("{k}=");
            for b in v.bytes() {
                if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                    out.push(b as char);
                } else {
                    out.push_str(&format!("%{b:02X}"));
                }
            }
            out
        })
        .collect();
    format!("{path}?{}", query.join("&"))
}

/// The standard screens of a pack's head, as the engine answers them before `top` cuts their lists: its stats, and the overview, activity, people and top of the map for the whole history, the last year and the last 90 days. One Window is worked out at a time.
pub fn standard(pack: &Pack) -> Vec<(String, Value)> {
    let colours: HashMap<AuthorId, u8> = pack
        .colours
        .iter()
        .map(|&(id, colour)| (AuthorId(id), colour))
        .collect();
    let login_of: HashMap<AuthorId, String> = pack
        .logins
        .iter()
        .map(|(id, login)| (AuthorId(*id), login.clone()))
        .collect();
    let mut out = Vec::new();
    if let Some(stats) = value(api::Stats::of(
        &pack.index,
        pack.anchor,
        pack.options,
        &pack.releases,
    )) {
        out.push((key("/api/stats", &[]), stats));
    }
    for span in SPANS {
        let label = span.label();
        let a = Analysis::new(&pack.index, span.window(pack.anchor), pack.options);
        let shared = api::Shared::of(&a);
        let cx = api::Context {
            window: label,
            colours: &colours,
            releases: &pack.releases,
            lines_counted: pack.lines_mainline,
            login_of: &login_of,
            emails: false,
        };
        let window = [("window", label)];
        let answers = [
            ("/api/overview", value(api::Overview::of(&a, &cx, &shared))),
            ("/api/activity", value(api::Activity::of(&a, &cx, &shared))),
            ("/api/people", value(api::People::of(&a, &cx, &shared))),
            (
                "/api/map",
                api::MapLevel::of(&a, &cx, &shared, "").and_then(value),
            ),
        ];
        for (path, answer) in answers {
            if let Some(answer) = answer {
                out.push((key(path, &window), answer));
            }
        }
    }
    out
}
