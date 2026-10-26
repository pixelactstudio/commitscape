#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

mod common;

use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Value};

const CASES: &[&str] = &[
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
    "lines-without-lines",
    "lines-with-no-time-to-count",
    "merges-with-tags",
    "crafted",
    "crafted-without-lines",
];

struct Golden {
    fixture: String,
    flags: Vec<String>,
    anchor: i64,
    asked: Vec<(String, Value, usize)>,
    answers: Vec<Value>,
}

fn golden_of(case: &str) -> Golden {
    let file: Value = serde_json::from_str(&common::gunzip(
        &common::goldens().join(format!("{case}.json.gz")),
    ))
    .unwrap();
    Golden {
        fixture: file["fixture"].as_str().unwrap().to_string(),
        flags: file["flags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f.as_str().unwrap().to_string())
            .collect(),
        anchor: file["anchor"].as_i64().unwrap(),
        asked: file["asked"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| {
                (
                    a[0].as_str().unwrap().to_string(),
                    a[1].clone(),
                    a[2].as_u64().unwrap() as usize,
                )
            })
            .collect(),
        answers: file["answers"].as_array().unwrap().clone(),
    }
}

fn write_golden(case: &str, golden: &Golden, answered: &[Value]) {
    let mut answers: Vec<String> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let lines: Vec<String> = golden
        .asked
        .iter()
        .zip(answered)
        .map(|((endpoint, body, _), answer)| {
            let text = answer.to_string();
            let at = *seen.entry(text.clone()).or_insert_with(|| {
                answers.push(text);
                answers.len() - 1
            });
            json!([endpoint, body, at]).to_string()
        })
        .collect();
    let text = format!(
        "{{\n\"fixture\": {},\n\"flags\": {},\n\"anchor\": {},\n\"asked\": [\n{}\n],\n\"answers\": [\n{}\n]\n}}\n",
        json!(golden.fixture),
        json!(golden.flags),
        golden.anchor,
        lines.join(",\n"),
        answers.join(",\n")
    );
    common::gzip(&common::goldens().join(format!("{case}.json.gz")), &text);
}

async fn check(case: &str) {
    let golden = golden_of(case);
    let lines = !golden.flags.iter().any(|f| f == "--no-lines");
    let budget = golden
        .flags
        .iter()
        .position(|f| f == "--lines-budget")
        .map(|at| Duration::from_secs(golden.flags[at + 1].parse().unwrap()));
    let read = common::read(
        &common::fixture(&golden.fixture),
        lines,
        budget,
        golden.anchor,
    );
    let key = format!("packs/golden/{case}.pack");
    let served = common::serve(&[(&key, &read.pack())]).await;
    let update = std::env::var_os("UPDATE_GOLDENS").is_some();
    let mut differences = Vec::new();
    let mut answered = Vec::new();
    for (endpoint, body, at) in &golden.asked {
        let mut asked = body.clone();
        asked["pack"] = json!(key);
        let got = served.post(endpoint, &asked).await;
        let said = format!(
            "{endpoint} {}",
            body.to_string().chars().take(300).collect::<String>()
        );
        match &got {
            Ok(value) => {
                if let Some(d) = common::difference(value, &golden.answers[*at], "") {
                    differences.push(format!("{said}\n    {d}"));
                }
            }
            Err(e) => differences.push(format!("{said}\n    {e}")),
        }
        answered.push(got.unwrap_or(Value::Null));
    }
    if update {
        write_golden(case, &golden, &answered);
        return;
    }
    assert!(
        differences.is_empty(),
        "{} of {} answers of {case} differ from tests/golden/{case}.json.gz (UPDATE_GOLDENS=1 writes the engine's answers there):\n{}",
        differences.len(),
        golden.asked.len(),
        differences
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

macro_rules! goldens {
    ($($test:ident => $case:literal),* $(,)?) => {
        $(
            #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
            async fn $test() {
                check($case).await;
            }
        )*
    };
}

goldens! {
    linear => "linear",
    coupling => "coupling",
    ownership => "ownership",
    renames => "renames",
    bulk => "bulk",
    merges => "merges",
    conflict => "conflict",
    rhythm => "rhythm",
    lines => "lines",
    survival => "survival",
    lines_without_lines => "lines-without-lines",
    lines_with_no_time_to_count => "lines-with-no-time-to-count",
    merges_with_tags => "merges-with-tags",
    crafted => "crafted",
    crafted_without_lines => "crafted-without-lines",
}

#[test]
fn every_golden_file_is_checked() {
    let mut files: Vec<String> = std::fs::read_dir(common::goldens())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter_map(|n| n.strip_suffix(".json.gz").map(str::to_string))
        .collect();
    files.sort();
    let mut cases: Vec<String> = CASES.iter().map(|c| c.to_string()).collect();
    cases.sort();
    assert_eq!(files, cases);
}

#[test]
fn every_endpoint_has_goldens() {
    let mut endpoints: Vec<String> = CASES
        .iter()
        .flat_map(|c| golden_of(c).asked.into_iter().map(|(e, _, _)| e))
        .collect();
    endpoints.sort();
    endpoints.dedup();
    assert_eq!(
        endpoints,
        [
            "/v1/answer",
            "/v1/code/log",
            "/v1/code/story",
            "/v1/commits/under",
            "/v1/git/coupling",
            "/v1/git/folder-last",
            "/v1/git/log",
            "/v1/git/path-history",
            "/v1/git/tree",
            "/v1/pulls/insight",
            "/v1/universe/rows",
        ]
    );
}
