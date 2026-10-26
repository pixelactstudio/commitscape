use commitscape_core::AuthorId;
use commitscape_metrics::Analysis;
use commitscape_report::api;
use serde::Serialize;
use serde_json::Value;

use crate::loaded::LoadedPack;
use crate::params::{self, Asked};

const SCREENS: [&str; 6] = [
    "/api/overview",
    "/api/activity",
    "/api/people",
    "/api/person",
    "/api/map",
    "/api/file",
];

fn value(answer: impl Serialize) -> Option<Value> {
    serde_json::to_value(answer).ok()
}

fn person_id(asked: &Asked) -> Option<AuthorId> {
    let n = asked.get("id").map_or(f64::NAN, params::Param::number);
    let whole = n.is_finite() && n.fract() == 0.0;
    (whole && (0.0..=f64::from(u32::MAX)).contains(&n)).then_some(AuthorId(n as u32))
}

/// One Data Source answer from a pack before `top` cuts its lists, exactly as `answer(view, path, askedOf(params))` works it out from the Stored Index: the screens of any Window and `/api/stats`; None where that gives null.
pub fn whole(held: &LoadedPack, path: &str, asked: &Asked) -> Option<Value> {
    let pack = &held.pack;
    if path == "/api/stats" {
        return value(api::Stats::of(
            &pack.index,
            pack.anchor,
            pack.options,
            &pack.releases,
        ));
    }
    if !SCREENS.contains(&path) {
        return None;
    }
    let asking = params::window_of(pack.anchor, asked)?;
    let a = Analysis::new(&pack.index, asking.window, pack.options);
    let cx = held.context(&asking.label);
    match path {
        "/api/overview" => value(api::Overview::of(&a, &cx, &held.shared(&a))),
        "/api/activity" => value(api::Activity::of(&a, &cx, &held.shared(&a))),
        "/api/people" => value(api::People::of(&a, &cx, &held.shared(&a))),
        "/api/person" => {
            let id = person_id(asked)?;
            value(api::Person::of(&a, &cx, &held.shared(&a), id)?)
        }
        "/api/map" => {
            let at = asked
                .get("path")
                .map(params::Param::text)
                .unwrap_or_default();
            value(api::MapLevel::of(&a, &cx, &held.shared(&a), &at)?)
        }
        "/api/file" => {
            let at = asked.get("path").filter(|p| p.is_truthy())?.text();
            value(api::File::of(&a, &cx, &held.coupling(&a), &at)?)
        }
        _ => None,
    }
}
