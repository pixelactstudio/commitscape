#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use commitscape_core::Oid;
use commitscape_engine::routes::{router, Engine};
use commitscape_engine::settings::{Settings, Source, S3};
use commitscape_index::source::RawChangeKind::{Added, Deleted, Modified};
use commitscape_index::{index_from_scratch, ScriptedRepo};
use commitscape_metrics::{Options, Span};
use commitscape_report::pack::{write_pack, Pack, Reading};
use commitscape_report::report::Report;
use serde_json::{json, Value};
use tower::ServiceExt;

const DAY0: i64 = 1_704_067_200;
const DAY: i64 = 86_400;
const TOKEN: &str = "secret";

fn blob(n: u8) -> Oid {
    let mut b = [0u8; 20];
    b[0] = n;
    Oid(b)
}

fn pack(name: &str) -> Pack {
    let repo = ScriptedRepo::new()
        .commit(
            DAY0,
            ("Ada", "ada@example.com"),
            &[(b"src/a.rs", Added, blob(1)), (b"old.txt", Added, blob(2))],
        )
        .said("feat: first")
        .commit(
            DAY0 + DAY,
            ("Bob", "12+bob@users.noreply.github.com"),
            &[(b"src/a.rs", Modified, blob(3))],
        )
        .commit(
            DAY0 + 2 * DAY,
            ("Ada", "ADA@example.com"),
            &[
                (b"src/b.rs", Added, blob(4)),
                (b"old.txt", Deleted, blob(2)),
            ],
        )
        .head_file(b"src/a.rs", "fn a() {}\nfn b() {}\n")
        .head_file(b"src/b.rs", "fn c() {}\n");
    let index = match index_from_scratch(&repo) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let commits = index.commits.len();
    let release = index
        .commits
        .get(1)
        .map(|c| c.id.to_hex())
        .unwrap_or_default();
    Pack::of(
        Report {
            name: name.into(),
            index,
            anchor: DAY0 + 3 * DAY,
            span: Span::All,
            options: Options::default(),
            releases: vec![("v1.0.0".into(), DAY0 + DAY)],
            lines_counted: true,
            accounts: HashMap::new(),
            avatars: false,
            commit_link: None,
            emails: false,
        },
        Reading {
            lineage: 1,
            lines_complete: true,
            lines_mainline: true,
            mainline: vec![24; commits],
            arrival: (0..commits)
                .map(|i| Some(DAY0 + i as i64 * DAY + 60))
                .collect(),
            release_commits: vec![("v1.0.0".into(), release)],
        },
    )
}

fn put(dir: &Path, key: &str, pack: &Pack) {
    let path = dir.join(key);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut bytes = Vec::new();
    write_pack(&mut pack.clone(), &mut bytes).unwrap();
    std::fs::write(path, bytes).unwrap();
}

struct Setup {
    _dir: tempfile::TempDir,
    source: PathBuf,
    cache: PathBuf,
    engine: Arc<Engine>,
    app: Router,
}

fn settings(source: Source, cache: &Path, disk: u64, memory: u64) -> Settings {
    Settings {
        port: 0,
        token: TOKEN.into(),
        source,
        pack_dir: cache.to_path_buf(),
        disk_bytes: disk,
        memory_bytes: memory,
        threads: 2,
        sentry: None,
    }
}

async fn setup_with(disk: u64, memory: u64) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    let cache = dir.path().join("cache");
    std::fs::create_dir_all(&source).unwrap();
    put(
        &source,
        "packs/acme/rocket/1/a-1-lines.pack",
        &pack("acme/rocket"),
    );
    put(
        &source,
        "packs/acme/other/2/b-2-lines.pack",
        &pack("acme/other"),
    );
    let engine =
        commitscape_engine::engine(&settings(Source::Dir(source.clone()), &cache, disk, memory))
            .await
            .unwrap();
    let app = router(engine.clone());
    Setup {
        _dir: dir,
        source,
        cache,
        engine,
        app,
    }
}

async fn setup() -> Setup {
    setup_with(1 << 30, 1 << 30).await
}

const ROCKET: &str = "packs/acme/rocket/1/a-1-lines.pack";
const OTHER: &str = "packs/acme/other/2/b-2-lines.pack";

async fn call(
    app: &Router,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().uri(path);
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    let req = match body {
        Some(b) => req
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(b.to_string())),
        None => req.method("GET").body(Body::empty()),
    }
    .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn ask(app: &Router, body: Value) -> (StatusCode, Value) {
    call(app, "/v1/answer", Some(TOKEN), Some(body)).await
}

#[tokio::test]
async fn health_is_open_and_everything_else_needs_the_token() {
    let s = setup().await;
    let (status, health) = call(&s.app, "/healthz", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(health["ok"], true);
    let body = json!({ "pack": ROCKET, "path": "/api/overview" });
    let (status, error) = call(&s.app, "/v1/answer", None, Some(body.clone())).await;
    assert_eq!(
        (status, error),
        (StatusCode::UNAUTHORIZED, json!({ "error": "unauthorized" }))
    );
    let (status, _) = call(&s.app, "/v1/answer", Some("wrong"), Some(body.clone())).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = call(&s.app, "/v1/answer", Some(TOKEN), Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(&s.app, "/nowhere", Some(TOKEN), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn answers_are_the_reports_screens_for_any_window() {
    let s = setup().await;
    let (status, overview) = ask(
        &s.app,
        json!({ "pack": ROCKET, "path": "/api/overview", "params": { "window": "all" } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(overview["window"], "all");
    assert_eq!(overview["commits"], 3);
    assert_eq!(overview["people"].as_array().map(Vec::len), Some(2));
    assert!(overview.get("count").is_none());

    let (_, people) = ask(
        &s.app,
        json!({ "pack": ROCKET, "path": "/api/people", "params": { "top": "1" } }),
    )
    .await;
    assert_eq!(people["count"], 2);
    assert_eq!(people["people"].as_array().map(Vec::len), Some(1));
    let ada = &people["people"][0];
    assert_eq!(ada["person"]["name"], "Ada");
    assert_eq!(ada["identities"], 1);
    assert!(ada["lines_added"].is_number());

    let (_, range) = ask(
        &s.app,
        json!({ "pack": ROCKET, "path": "/api/activity", "params": { "from": (DAY0 + DAY).to_string(), "to": DAY0 + 2 * DAY - 1 } }),
    )
    .await;
    assert_eq!(range["window"], "range");
    assert_eq!(
        range["releases"],
        json!([{ "name": "v1.0.0", "time": DAY0 + DAY }])
    );

    let (_, stats) = ask(
        &s.app,
        json!({ "pack": ROCKET, "path": "/api/stats", "params": { "window": "nonsense" } }),
    )
    .await;
    assert_eq!(stats["commits"], 3);

    let (_, everyone) = ask(&s.app, json!({ "pack": ROCKET, "path": "/api/people" })).await;
    let id = everyone["people"]
        .as_array()
        .and_then(|p| p.iter().find(|r| r["person"]["name"] == "Bob"))
        .map(|r| r["person"]["id"].to_string())
        .unwrap();
    let (_, bob) = ask(
        &s.app,
        json!({ "pack": ROCKET, "path": "/api/person", "params": { "id": id, "window": "30d" } }),
    )
    .await;
    assert_eq!(bob["person"]["login"], "bob");
    assert_eq!(bob["email"], "");

    let (_, map) = ask(
        &s.app,
        json!({ "pack": ROCKET, "path": "/api/map", "params": { "path": "src/" } }),
    )
    .await;
    assert_eq!(map["path"], "src/");

    let (status, gone) = ask(
        &s.app,
        json!({ "pack": ROCKET, "path": "/api/file", "params": { "path": "old.txt" } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (gone["lines"].clone(), gone["churn"].clone()),
        (Value::Null, json!(2))
    );
}

#[tokio::test]
async fn a_pack_of_the_format_before_answers_as_the_same_pack_does_unpacked() {
    use std::io::Write;

    let s = setup().await;
    let old = "packs/acme/rocket/0/old-0-lines.pack";
    let mut pack = pack("acme/rocket");
    pack.format = 2;
    let payload = bincode::serde::encode_to_vec(&pack, bincode::config::standard()).unwrap();
    let mut z = flate2::write::ZlibEncoder::new(
        b"commitscape pack 1\n".to_vec(),
        flate2::Compression::default(),
    );
    z.write_all(&payload).unwrap();
    std::fs::write(
        s.source
            .join(old)
            .parent()
            .map(|p| {
                std::fs::create_dir_all(p).unwrap();
                s.source.join(old)
            })
            .unwrap(),
        z.finish().unwrap(),
    )
    .unwrap();
    for path in ["/api/overview", "/api/people", "/api/activity", "/api/map"] {
        let (status, new) = ask(&s.app, json!({ "pack": ROCKET, "path": path })).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        let (status, before) = ask(&s.app, json!({ "pack": old, "path": path })).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert_eq!(before, new, "{path}");
    }
    let kept: Vec<String> = std::fs::read_dir(&s.cache)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        kept.iter().filter(|n| n.ends_with(".unpacked")).count(),
        1,
        "{kept:?}"
    );
    assert_eq!(
        kept.iter().filter(|n| n.ends_with(".pack")).count(),
        1,
        "{kept:?}"
    );
}

#[tokio::test]
async fn questions_with_no_answer_say_so() {
    let s = setup().await;
    for (path, params) in [
        ("/api/nothing", json!({})),
        ("/api/overview", json!({ "window": "7d" })),
        ("/api/overview", json!({ "from": "200", "to": "100" })),
        ("/api/person", json!({ "id": "x" })),
        ("/api/person", json!({ "id": "99" })),
        ("/api/file", json!({})),
        ("/api/file", json!({ "path": 0 })),
        ("/api/map", json!({ "path": "nowhere" })),
    ] {
        let (status, error) = ask(
            &s.app,
            json!({ "pack": ROCKET, "path": path, "params": params }),
        )
        .await;
        assert_eq!(
            (status, error),
            (StatusCode::NOT_FOUND, json!({ "error": "no such answer" })),
            "{path} {params}"
        );
    }
    let (status, error) = ask(
        &s.app,
        json!({ "pack": "packs/none.pack", "path": "/api/overview" }),
    )
    .await;
    assert_eq!(
        (status, error),
        (StatusCode::NOT_FOUND, json!({ "error": "no such pack" }))
    );
    let (status, _) = ask(
        &s.app,
        json!({ "pack": "../secret", "path": "/api/overview" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, error) = ask(&s.app, json!({ "path": "/api/overview" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error["error"].is_string());
    let (status, error) = call(
        &s.app,
        "/v1/git/tree",
        Some(TOKEN),
        Some(json!({ "pack": ROCKET })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(error["error"].is_string());
    let (status, error) = call(
        &s.app,
        "/v1/code/log",
        Some(TOKEN),
        Some(json!({ "pack": ROCKET, "path": "src/", "page": 0 })),
    )
    .await;
    assert_eq!(
        (status, error),
        (
            StatusCode::BAD_REQUEST,
            json!({ "error": "That is not a page." })
        )
    );
    let (status, error) = call(
        &s.app,
        "/v1/code/story",
        Some(TOKEN),
        Some(json!({ "pack": "packs/none.pack", "path": "" })),
    )
    .await;
    assert_eq!(
        (status, error),
        (StatusCode::NOT_FOUND, json!({ "error": "no such pack" }))
    );
}

async fn view(app: &Router, path: &str, body: Value) -> Value {
    let (status, answer) = call(app, path, Some(TOKEN), Some(body)).await;
    assert_eq!(status, StatusCode::OK, "{path}: {answer}");
    answer
}

#[tokio::test]
async fn the_code_window_and_the_universe_are_answered_from_the_pack() {
    let s = setup().await;
    let of = json!({ "builtAt": 900, "head": "abc", "branch": "main", "raw": null });
    let tree = view(
        &s.app,
        "/v1/git/tree",
        json!({ "pack": ROCKET, "blobs": {}, "of": of }),
    )
    .await;
    assert_eq!(tree["paths"], json!(["src/a.rs", "src/b.rs"]));
    assert_eq!(tree["langs"], json!(["rust"]));
    assert_eq!(tree["churn"], json!([2, 1]));
    assert_eq!(tree["logged"], 3);
    assert_eq!(tree["builtAt"], 900);
    assert_eq!(
        tree["dirs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["path"].clone())
            .collect::<Vec<_>>(),
        vec![json!(""), json!("src/")]
    );
    assert_eq!(tree["dirs"][0]["commits"], 3);
    assert_eq!(tree["people"][0]["name"], "Ada");

    let coupling = view(&s.app, "/v1/git/coupling", json!({ "pack": ROCKET })).await;
    assert_eq!(coupling, json!({ "v": 1, "of": {} }));

    let log = view(&s.app, "/v1/git/log", json!({ "pack": ROCKET })).await;
    assert_eq!(log["names"], json!(["a.rs", "b.rs", "old.txt"]));
    assert_eq!(log["alive"], json!([1, 1, 0]));
    assert_eq!(log["files"], json!([0, 2, 0, 1, 2]));
    assert_eq!(log["gaps"], json!([DAY0, DAY, DAY]));

    let history = view(
        &s.app,
        "/v1/git/path-history",
        json!({ "pack": ROCKET, "path": "src/" }),
    )
    .await;
    assert_eq!(history["total"], 3);
    assert_eq!(history["commits"][2]["subject"], "feat: first");
    assert_eq!(history["months"]["counts"], json!([3]));

    let last = view(
        &s.app,
        "/v1/git/folder-last",
        json!({ "pack": ROCKET, "path": "" }),
    )
    .await;
    assert_eq!(last["entries"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        (
            last["entries"][0]["name"].clone(),
            last["entries"][0]["dir"].clone()
        ),
        (json!("src"), json!(true))
    );

    let story = view(
        &s.app,
        "/v1/code/story",
        json!({ "pack": ROCKET, "path": "src/a.rs" }),
    )
    .await;
    assert_eq!(
        (
            story["kind"].clone(),
            story["commits"].clone(),
            story["people"].clone()
        ),
        (json!("file"), json!(2), json!(2))
    );
    assert_eq!(story["file"]["lang"], "rust");
    assert_eq!(story["born"]["subject"], "");
    let gone = view(
        &s.app,
        "/v1/code/story",
        json!({ "pack": ROCKET, "path": "old.txt" }),
    )
    .await;
    assert_eq!(gone["kind"], "missing");

    let page = view(
        &s.app,
        "/v1/code/log",
        json!({ "pack": ROCKET, "path": "src/", "page": 1 }),
    )
    .await;
    assert_eq!(
        (page["total"].clone(), page["pages"].clone()),
        (json!(3), json!(1))
    );
    assert_eq!(page["commits"][0]["pull"], Value::Null);

    let first = view(
        &s.app,
        "/v1/commits/under",
        json!({ "pack": ROCKET, "path": "src/", "query": { "limit": 2 } }),
    )
    .await;
    assert_eq!(first["total"], 3);
    assert_eq!(first["shas"].as_array().map(Vec::len), Some(2));
    let next = first["next"].as_str().unwrap().to_string();
    let rest = view(
        &s.app,
        "/v1/commits/under",
        json!({ "pack": ROCKET, "path": "src/", "query": { "limit": 2 }, "cursor": next }),
    )
    .await;
    assert_eq!(
        (rest["shas"].as_array().map(Vec::len), rest["next"].clone()),
        (Some(1), Value::Null)
    );
    let said = view(
        &s.app,
        "/v1/commits/under",
        json!({ "pack": ROCKET, "path": "", "said": [first["shas"][1]] }),
    )
    .await;
    assert_eq!(said["shas"], json!([first["shas"][1]]));

    let insight = view(
        &s.app,
        "/v1/pulls/insight",
        json!({ "pack": ROCKET, "number": 7, "paths": [], "author": "bob", "named": [{ "sha": history["commits"][0]["sha"], "at": DAY0, "subject": "x (#7)" }] }),
    )
    .await;
    assert_eq!(
        (insight["number"].clone(), insight["source"].clone()),
        (json!(7), json!("commit"))
    );
    assert_eq!(insight["filesTotal"], 2);
    assert_eq!(insight["known"], 2);
    assert!(insight["holders"]
        .as_array()
        .unwrap()
        .iter()
        .all(|h| h["person"]["login"] != "bob"));
}

#[tokio::test]
async fn commits_are_searched_by_their_words_in_the_engine_as_the_commit_list_searches_them() {
    let s = setup().await;
    let search = |query: Value| {
        let app = s.app.clone();
        async move {
            let (status, found) = call(
                &app,
                "/v1/commits/search",
                Some(TOKEN),
                Some(json!({ "pack": ROCKET, "query": query })),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            found
        }
    };
    let all = search(json!({})).await;
    assert_eq!(all["total"], 3);
    let newest_first = all["shas"].clone();
    assert_eq!(
        search(json!({ "q": "FIRST" })).await["shas"],
        json!([newest_first[2]])
    );
    assert_eq!(search(json!({ "q": "feat first" })).await["total"], 1);
    assert_eq!(search(json!({ "q": "feat nothing" })).await["total"], 0);
    assert_eq!(
        search(json!({ "q": "bob" })).await["shas"],
        json!([newest_first[1]])
    );
    assert_eq!(search(json!({ "q": "ada" })).await["total"], 2);
    assert_eq!(
        search(json!({ "q": "ada", "merges": 0, "since": (DAY0 + DAY) / DAY })).await["shas"],
        json!([newest_first[0]])
    );
    let first = search(json!({ "limit": 2 })).await;
    assert_eq!(
        (
            first["total"].clone(),
            first["shas"].as_array().map(Vec::len)
        ),
        (json!(3), Some(2))
    );
    let (_, rest) = call(
        &s.app,
        "/v1/commits/search",
        Some(TOKEN),
        Some(json!({ "pack": ROCKET, "query": { "limit": 2 }, "cursor": first["next"] })),
    )
    .await;
    assert_eq!(
        (rest["shas"].clone(), rest["next"].clone()),
        (json!([newest_first[2]]), Value::Null)
    );
    let (_, under) = call(
        &s.app,
        "/v1/commits/under",
        Some(TOKEN),
        Some(json!({ "pack": ROCKET, "path": "src/", "query": { "q": "bob" } })),
    )
    .await;
    assert_eq!(under["shas"], json!([newest_first[1]]));
}

#[tokio::test]
async fn the_universe_rows_are_what_the_atlas_is_made_from() {
    let s = setup().await;
    let (status, rows) = call(
        &s.app,
        "/v1/universe/rows",
        Some(TOKEN),
        Some(json!({ "pack": ROCKET })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rows["mainline"], true);
    assert_eq!(rows["newest"], DAY0 + 2 * DAY + 60);
    let commits = rows["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 3);
    assert_eq!(commits[0]["time"], DAY0 + 60);
    assert_eq!(commits[0]["firstParent"], true);
    assert_eq!(commits[0]["files"].as_array().map(Vec::len), Some(2));
    let files = rows["files"].as_array().unwrap();
    assert_eq!(files.len(), 3);
    assert!(files
        .iter()
        .any(|f| f["path"] == "old.txt" && f["alive"] == false && f["lines"].is_null()));
    assert!(files
        .iter()
        .any(|f| f["path"] == "src/a.rs" && f["language"] == "Rust" && f["lines"] == 2));
    let people = rows["people"].as_array().unwrap();
    assert_eq!(people.len(), 2);
    assert!(people.iter().any(|p| p["login"] == "bob"));
    assert_eq!(rows["releases"], json!([["v1.0.0", DAY0 + DAY + 60]]));
}

#[test]
fn the_universe_rows_a_build_writes_are_the_rows_the_engine_answers_one_per_line() {
    let pack = pack("acme/rocket");
    let mut bytes = Vec::new();
    commitscape_report::universe::write_rows(&pack, &mut bytes).unwrap();
    let lines: Vec<Value> = String::from_utf8(bytes)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let rows = serde_json::to_value(commitscape_report::universe::rows(&pack)).unwrap();
    let head = &lines[0];
    assert_eq!(head["mainline"], rows["mainline"]);
    assert_eq!(head["newest"], rows["newest"]);
    assert_eq!(head["releases"], rows["releases"]);
    let (commits, files, people) = (
        head["commits"].as_u64().unwrap() as usize,
        head["files"].as_u64().unwrap() as usize,
        head["people"].as_u64().unwrap() as usize,
    );
    assert_eq!(lines.len(), 1 + commits + files + people);
    assert_eq!(
        Value::Array(lines[1..1 + commits].to_vec()),
        rows["commits"]
    );
    assert_eq!(
        Value::Array(lines[1 + commits..1 + commits + files].to_vec()),
        rows["files"]
    );
    assert_eq!(
        Value::Array(lines[1 + commits + files..].to_vec()),
        rows["people"]
    );
}

#[tokio::test]
async fn warming_works_out_the_answers_named() {
    let s = setup().await;
    let (status, warmed) = call(
        &s.app,
        "/v1/warm",
        Some(TOKEN),
        Some(json!({ "pack": ROCKET, "keys": ["/api/overview?window=30d", "/api/people?window=all&top=5", "/api/nothing?"] })),
    )
    .await;
    assert_eq!((status, warmed), (StatusCode::OK, json!({ "made": 2 })));
    let (_, health) = call(&s.app, "/healthz", None, None).await;
    assert_eq!(health["decodes"], 1);
}

#[tokio::test]
async fn a_pack_is_fetched_and_decoded_once_however_many_ask_at_once() {
    let s = setup().await;
    let mut asks = Vec::new();
    for i in 0..16 {
        let app = s.app.clone();
        let window = ["30d", "90d", "1y", "all"][i % 4];
        asks.push(tokio::spawn(async move {
            ask(
                &app,
                json!({ "pack": ROCKET, "path": "/api/overview", "params": { "window": window } }),
            )
            .await
        }));
    }
    for a in asks {
        assert_eq!(a.await.unwrap().0, StatusCode::OK);
    }
    let held = s.engine.packs.held();
    assert_eq!(
        (
            held.fetches,
            held.decodes,
            held.memory_packs,
            held.disk_packs
        ),
        (1, 1, 1, 1)
    );
}

#[tokio::test]
async fn packs_leave_memory_and_disk_oldest_first() {
    let s = setup_with(1, 1).await;
    ask(&s.app, json!({ "pack": ROCKET, "path": "/api/stats" })).await;
    ask(&s.app, json!({ "pack": OTHER, "path": "/api/stats" })).await;
    let held = s.engine.packs.held();
    assert_eq!((held.memory_packs, held.disk_packs), (1, 1));
    let files: Vec<_> = std::fs::read_dir(&s.cache).unwrap().collect();
    assert_eq!(files.len(), 1);
    ask(&s.app, json!({ "pack": ROCKET, "path": "/api/overview" })).await;
    assert_eq!(s.engine.packs.held().fetches, 3);
}

#[tokio::test]
async fn what_an_earlier_run_kept_on_disk_is_used_again() {
    let s = setup().await;
    ask(&s.app, json!({ "pack": ROCKET, "path": "/api/stats" })).await;
    std::fs::remove_dir_all(&s.source).unwrap();
    let again = commitscape_engine::engine(&settings(
        Source::Dir(s.source.clone()),
        &s.cache,
        1 << 30,
        1 << 30,
    ))
    .await
    .unwrap();
    let app = router(again.clone());
    let (status, _) = ask(&app, json!({ "pack": ROCKET, "path": "/api/overview" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (again.packs.held().fetches, again.packs.held().disk_packs),
        (0, 1)
    );
}

#[tokio::test]
async fn a_broken_pack_is_an_error_and_is_fetched_again_next_time() {
    let s = setup().await;
    std::fs::write(
        s.source.join("packs/broken.pack"),
        b"commitscape pack 1\nnot zlib",
    )
    .unwrap();
    let (status, error) = ask(
        &s.app,
        json!({ "pack": "packs/broken.pack", "path": "/api/overview" }),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(error["error"]
        .as_str()
        .unwrap_or_default()
        .starts_with("could not read the pack"));
    assert_eq!(s.engine.packs.held().disk_packs, 0);
    put(&s.source, "packs/broken.pack", &pack("fixed"));
    let (status, _) = ask(
        &s.app,
        json!({ "pack": "packs/broken.pack", "path": "/api/overview" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn packs_are_fetched_from_s3_with_a_signed_get() {
    use axum::extract::{Path as UrlPath, RawQuery, State};
    use axum::routing::get;

    let mut bytes = Vec::new();
    write_pack(&mut pack("acme/rocket"), &mut bytes).unwrap();
    let stored = Arc::new(bytes);
    let fake = Router::new()
        .route(
            "/bucket/{*key}",
            get(
                |State(stored): State<Arc<Vec<u8>>>,
                 UrlPath(key): UrlPath<String>,
                 RawQuery(query): RawQuery| async move {
                    let signed = query.unwrap_or_default().contains("X-Amz-Signature=");
                    match (key.as_str(), signed) {
                        (ROCKET, true) => (StatusCode::OK, stored.as_ref().clone()),
                        (_, true) => (
                            StatusCode::NOT_FOUND,
                            b"<Error><Code>NoSuchKey</Code></Error>".to_vec(),
                        ),
                        (_, false) => (StatusCode::FORBIDDEN, Vec::new()),
                    }
                },
            ),
        )
        .with_state(stored);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, fake).await;
    });
    let dir = tempfile::tempdir().unwrap();
    let engine = commitscape_engine::engine(&settings(
        Source::S3(S3 {
            endpoint: format!("http://{address}"),
            bucket: "bucket".into(),
            access_key_id: "key".into(),
            secret_access_key: "secret".into(),
            region: "auto".into(),
            path_style: true,
        }),
        dir.path(),
        1 << 30,
        1 << 30,
    ))
    .await
    .unwrap();
    let app = router(engine.clone());
    let (status, overview) = ask(&app, json!({ "pack": ROCKET, "path": "/api/overview" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(overview["commits"], 3);
    let (status, _) = ask(&app, json!({ "pack": OTHER, "path": "/api/overview" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(engine.packs.held().fetches, 1);
}
