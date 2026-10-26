#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

mod common;

use serde_json::{json, Map, Value};

const FIXTURES: &[&str] = &[
    "linear",
    "coupling",
    "ownership",
    "renames",
    "bulk",
    "merges",
    "conflict",
    "rhythm",
    "lines",
    "survival",
    "tags",
    "crafted",
];

fn params_of(query: &str) -> Value {
    let mut params = Map::new();
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        params.insert(k.into_owned(), Value::String(v.into_owned()));
    }
    Value::Object(params)
}

async fn compare(fixture: &str) {
    let mut read = common::read(&common::fixture(fixture), true, None, 0);
    read.anchor = read.index.span.newest.unwrap_or(0) + 36 * 3600;
    let written: Value =
        serde_json::from_str(&commitscape_report::report::write(read.report(), false).report)
            .unwrap();
    let key = format!("packs/report/{fixture}.pack");
    let served = common::serve(&[(&key, &read.pack())]).await;
    let data = written["data"].as_object().unwrap();
    let mut asked = 0;
    let mut differences = Vec::new();
    for (question, want) in data {
        if question.starts_with("/api/commits") {
            continue;
        }
        let (path, query) = question.split_once('?').unwrap_or((question, ""));
        let got = served
            .post(
                "/v1/answer",
                &json!({ "pack": key, "path": path, "params": params_of(query) }),
            )
            .await
            .unwrap();
        asked += 1;
        if let Some(d) = common::difference(&got, want, question) {
            differences.push(d);
        }
    }
    let stats = served
        .post("/v1/answer", &json!({ "pack": key, "path": "/api/stats" }))
        .await
        .unwrap();
    if let Some(d) = common::difference(&stats, &written["stats"], "stats") {
        differences.push(d);
    }
    assert!(asked > 8, "{fixture}: only {asked} answers in the Report");
    assert!(
        differences.is_empty(),
        "{fixture}: {} answers differ from the Report's:\n{}",
        differences.len(),
        differences
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_engine_answers_what_the_report_holds_for_its_windows() {
    for fixture in FIXTURES {
        compare(fixture).await;
    }
}
