#![allow(dead_code, clippy::unwrap_used, clippy::indexing_slicing)]

use std::collections::{HashMap, HashSet};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use commitscape_core::{CommitFlags, Index, Oid};
use commitscape_engine::routes::{router, Engine};
use commitscape_engine::settings::{Settings, Source};
use commitscape_index::mainline::REACHABLE;
use commitscape_index::{
    line_pass, load, CacheOptions, GixRepo, IdentityRules, IdentityStore, LinePlan, LineStore,
    RepoSource,
};
use commitscape_metrics::{Options, Span};
use commitscape_report::pack::{write_pack, Pack, Reading};
use commitscape_report::report::Report;
use serde_json::Value;
use tower::ServiceExt;

pub const TOKEN: &str = "golden";

pub fn fixture(name: &str) -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name);
    assert!(
        path.join(".git").exists(),
        "the fixture {name} is missing: run `cargo xtask fixtures --force`"
    );
    path
}

pub fn goldens() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

pub struct Read {
    pub name: String,
    pub index: Index,
    pub anchor: i64,
    pub releases: Vec<(String, i64)>,
    pub accounts: HashMap<String, String>,
    pub lines_counted: bool,
    pub reading: Reading,
}

impl Read {
    pub fn report(&self) -> Report {
        Report {
            name: self.name.clone(),
            index: self.index.clone(),
            anchor: self.anchor,
            span: Span::All,
            options: Options::default(),
            releases: self.releases.clone(),
            lines_counted: self.lines_counted,
            accounts: self.accounts.clone(),
            avatars: false,
            commit_link: None,
            emails: false,
        }
    }

    pub fn pack(&self) -> Pack {
        Pack::of(self.report(), self.reading.clone())
    }
}

pub fn read(repo: &Path, lines: bool, budget: Option<Duration>, anchor: i64) -> Read {
    let cache = tempfile::tempdir().unwrap();
    let options = CacheOptions {
        root: Some(cache.path().to_path_buf()),
        key: None,
    };
    let source = GixRepo::open(repo).unwrap();
    let mut loaded = load(&source, &options, &mut |_| {}).unwrap();
    let mainline = commitscape_index::mainline(&source, &loaded.index).unwrap();
    let metrics = Options::default();
    let counted = lines.then(|| {
        let plan = LinePlan {
            skip_commits: loaded
                .index
                .commits
                .iter()
                .map(|c| metrics.is_bulk(c))
                .collect(),
            skip_files: commitscape_metrics::skipped_files(&loaded.index),
            mainline: Some(mainline.bits.clone()),
            budget,
        };
        let store = LineStore::for_repo(&options, &loaded.index.repo);
        let mut pass = line_pass(
            &source,
            &loaded.index,
            &plan,
            store.as_ref(),
            &mut |_, _| {},
        )
        .unwrap();
        let settled = std::mem::take(&mut pass.settled);
        let left = pass.left;
        pass.apply(&mut loaded.index);
        (settled, left)
    });
    let ignored: HashSet<Oid> = source.blame_ignore_revs().unwrap().into_iter().collect();
    for c in loaded.index.commits.iter_mut() {
        if ignored.contains(&c.id) {
            c.flags = c.flags.with(CommitFlags::BLAME_IGNORED);
        }
    }
    let rules = match IdentityStore::for_repo(&options, &loaded.index.repo) {
        Some(store) => store.rules(source.mailmap().unwrap()),
        None => IdentityRules::from_mailmap(source.mailmap().unwrap()),
    };
    let accounts = rules
        .accounts
        .into_iter()
        .map(|(email, a)| (email, a.login))
        .collect();
    let tags = source.release_tags();
    let lines_mainline =
        counted.as_ref().is_some_and(|(settled, _)| {
            mainline.bits.iter().enumerate().all(|(at, bits)| {
                bits & REACHABLE == 0 || settled.get(at).copied().unwrap_or(false)
            })
        });
    let lines_complete = counted.as_ref().is_some_and(|(_, left)| *left == 0);
    let git_dir = PathBuf::from(&loaded.index.repo.git_dir);
    let named = if git_dir.file_name().is_some_and(|n| n == ".git") {
        git_dir.parent().map(Path::to_path_buf)
    } else {
        Some(git_dir)
    };
    Read {
        name: named
            .and_then(|d| d.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "repository".into()),
        anchor,
        releases: tags.iter().map(|(n, t, _)| (n.clone(), *t)).collect(),
        accounts,
        lines_counted: lines,
        reading: Reading {
            lineage: loaded.lineage,
            lines_complete,
            lines_mainline,
            mainline: mainline.bits,
            arrival: mainline.arrival,
            release_commits: tags.into_iter().map(|(n, _, c)| (n, c.to_hex())).collect(),
        },
        index: loaded.index,
    }
}

pub struct Served {
    _dir: tempfile::TempDir,
    pub app: Router,
    pub engine: Arc<Engine>,
}

pub async fn serve(packs: &[(&str, &Pack)]) -> Served {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    for (key, pack) in packs {
        let path = source.join(key);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut bytes = Vec::new();
        write_pack(&mut (*pack).clone(), &mut bytes).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    let engine = commitscape_engine::engine(&Settings {
        port: 0,
        token: TOKEN.into(),
        source: Source::Dir(source),
        pack_dir: dir.path().join("cache"),
        disk_bytes: 1 << 30,
        memory_bytes: 1 << 30,
        threads: 2,
        sentry: None,
    })
    .await
    .unwrap();
    Served {
        _dir: dir,
        app: router(engine.clone()),
        engine,
    }
}

impl Served {
    pub async fn post(&self, endpoint: &str, body: &Value) -> Result<Value, String> {
        let req = Request::builder()
            .uri(endpoint)
            .method("POST")
            .header("authorization", format!("Bearer {TOKEN}"))
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        match status {
            StatusCode::OK => Ok(value),
            StatusCode::NOT_FOUND if value["error"] == "no such answer" => Ok(Value::Null),
            other => Err(format!("{other}: {value}")),
        }
    }
}

pub fn same(a: &Value, b: &Value) -> bool {
    difference(a, b, "").is_none()
}

pub fn difference(a: &Value, b: &Value, at: &str) -> Option<String> {
    let short = |v: &Value| v.to_string().chars().take(200).collect::<String>();
    match (a, b) {
        (Value::Number(x), Value::Number(y)) if x.as_f64() == y.as_f64() => None,
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{at}: {} items, not {}", x.len(), y.len()));
            }
            x.iter()
                .zip(y)
                .enumerate()
                .find_map(|(i, (p, q))| difference(p, q, &format!("{at}[{i}]")))
        }
        (Value::Object(x), Value::Object(y)) => {
            let keys: std::collections::BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            keys.into_iter().find_map(|k| match (x.get(k), y.get(k)) {
                (Some(p), Some(q)) => difference(p, q, &format!("{at}.{k}")),
                (Some(_), None) => Some(format!("{at}.{k}: only in the answer")),
                _ => Some(format!("{at}.{k}: only in the golden")),
            })
        }
        _ if a == b => None,
        _ => Some(format!("{at}: {} is not {}", short(a), short(b))),
    }
}

pub fn gunzip(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap();
    let mut text = String::new();
    flate2::read::GzDecoder::new(bytes.as_slice())
        .read_to_string(&mut text)
        .unwrap();
    text
}

pub fn gzip(path: &Path, text: &str) {
    let mut out = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    out.write_all(text.as_bytes()).unwrap();
    std::fs::write(path, out.finish().unwrap()).unwrap();
}
