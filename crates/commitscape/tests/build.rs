#![allow(clippy::expect_used)]
#![allow(clippy::indexing_slicing)]

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use commitscape_index::{load, CacheOptions, GixRepo};
use commitscape_report::pack::{read_pack, MAGIC};
use serde_json::Value;

fn fixture(name: &str) -> PathBuf {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name);
    assert!(
        repo.exists(),
        "fixture {name} is missing: run `cargo xtask fixtures --force`"
    );
    repo
}

fn commitscape(args: &[&str], paths: &[&Path]) -> String {
    let run = Command::new(env!("CARGO_BIN_EXE_commitscape"))
        .env("COMMITSCAPE_SITE", "http://127.0.0.1:9")
        .stdin(Stdio::null())
        .args(args)
        .args(paths)
        .output()
        .expect("running commitscape");
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    String::from_utf8_lossy(&run.stdout).into_owned()
}

fn json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).expect("written")).expect("JSON")
}

fn rows(path: &Path) -> Vec<Vec<String>> {
    std::fs::read_to_string(path)
        .expect("written")
        .lines()
        .map(|l| l.split('\t').map(str::to_string).collect())
        .collect()
}

fn events(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .expect("events were written")
        .lines()
        .map(|l| serde_json::from_str(l).expect("one JSON object per line"))
        .collect()
}

fn field(events: &[Value], span: &str, name: &str) -> Value {
    events
        .iter()
        .find(|e| e["span"] == span)
        .map(|e| e["fields"][name].clone())
        .unwrap_or(Value::Null)
}

fn git(args: &[&str]) -> String {
    let out = Command::new("git").args(args).output().expect("git");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn payload(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(&bytes[MAGIC.len()..])
        .read_to_end(&mut out)
        .expect("zlib");
    out
}

#[test]
fn build_writes_the_export_the_pack_and_the_meta_from_one_reading() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = dir.path().join("cache");
    let out = dir.path().join("out");
    let recorded = dir.path().join("events.jsonl");
    let repo = fixture("lines");
    commitscape(
        &["build", "--offline", "--cache-dir"],
        &[
            &cache,
            Path::new("--events"),
            &recorded,
            Path::new("--out"),
            &out,
            &repo,
        ],
    );

    let manifest = json(&out.join("manifest.json"));
    assert_eq!(manifest["format"], 4);
    assert_eq!(manifest["full"], true);
    assert_eq!(manifest["lines"], true);
    assert_eq!(manifest["lines_counted"], 6);
    assert_eq!(manifest["lines_mainline"], true);
    assert_eq!(manifest["lines_left"], 0);
    assert!(manifest.get("days").is_none());
    for gone in [
        "days.tsv",
        "signature_days.tsv",
        "folder_days.tsv",
        "signature_folder_days.tsv",
    ] {
        assert!(!out.join(gone).exists(), "{gone}");
    }
    let commits = rows(&out.join("commits.tsv"));
    assert_eq!(commits.len(), 7);
    assert!(commits.iter().all(|c| c.len() == 13));
    assert!(rows(&out.join("mainline.tsv")).is_empty());
    assert!(rows(&out.join("lines.tsv")).is_empty());
    let mainline: Vec<Vec<String>> = commits
        .iter()
        .map(|c| vec![c[0].clone(), c[6].clone(), c[7].clone()])
        .collect();
    let reformat = git(&["-C", repo.to_str().unwrap_or("."), "rev-parse", "HEAD~2"]);
    let flags: Vec<(String, u8)> = mainline
        .iter()
        .map(|r| {
            (
                r[0].trim_start_matches("\\\\x").to_string(),
                r[1].parse().unwrap_or(0),
            )
        })
        .collect();
    assert!(flags.iter().all(|(_, f)| f & 24 == 24));
    assert!(flags
        .iter()
        .any(|(sha, f)| sha == reformat.trim() && f & 2 == 2));

    let spans: Vec<String> = events(&recorded)
        .iter()
        .map(|e| e["span"].as_str().unwrap_or("").to_string())
        .collect();
    for span in [
        "load",
        "head_pass",
        "mainline",
        "line_pass",
        "export",
        "meta",
        "pack",
    ] {
        assert!(spans.iter().any(|s| s == span), "{span} in {spans:?}");
    }

    let bytes = std::fs::read(out.join("pack.bin")).expect("a pack");
    assert!(bytes.starts_with(MAGIC));
    let pack = read_pack(&bytes).expect("it reads back");
    assert_eq!(pack.format, 2);
    assert_eq!(pack.head.as_deref(), manifest["head"].as_str());
    assert_eq!(
        pack.lineage.to_string(),
        manifest["lineage"].as_str().unwrap_or("")
    );
    assert!(pack.lines_counted && pack.lines_complete && pack.lines_mainline);
    assert_eq!(pack.mainline.len(), pack.index.commits.len());
    assert_eq!(pack.arrival.len(), pack.index.commits.len());
    for (c, (bits, arrival)) in pack
        .index
        .commits
        .iter()
        .zip(pack.mainline.iter().zip(&pack.arrival))
    {
        let row = mainline
            .iter()
            .find(|r| r[0].ends_with(&c.id.to_hex()))
            .expect("in commits.tsv");
        assert_eq!(row[1], (c.flags.0 | bits).to_string());
        assert_eq!(row[2], arrival.map_or("\\N".to_string(), |a| a.to_string()));
    }

    let options = CacheOptions {
        root: Some(cache.clone()),
        key: None,
    };
    let source = GixRepo::open(&repo).expect("the fixture");
    let mut expected = load(&source, &options, &mut |_| {}).expect("warm").index;
    let emails: Vec<String> = (0..expected.authors.signature_count())
        .filter_map(|i| {
            expected
                .authors
                .signature(commitscape_core::SignatureId(i as u32))
                .map(|s| s.email.to_string())
        })
        .collect();
    assert!(!emails.is_empty());
    let raw = payload(&bytes);
    for email in &emails {
        assert!(
            !raw.windows(email.len()).any(|w| w == email.as_bytes()),
            "{email} is in the pack"
        );
    }
    expected.authors.blank_emails();
    for (c, packed) in expected.commits.iter_mut().zip(pack.index.commits.iter()) {
        c.flags = packed.flags;
    }
    for (ch, packed) in expected.changes.iter_mut().zip(pack.index.changes.iter()) {
        ch.set_lines(packed.lines());
    }
    assert_eq!(pack.index, expected);
    let added: u64 = pack
        .index
        .changes
        .iter()
        .filter_map(|ch| ch.lines().map(|l| u64::from(l.added)))
        .sum();
    let exported: u64 = commits
        .iter()
        .flat_map(|c| {
            c[11]
                .trim_matches(|ch| ch == '{' || ch == '}')
                .split(',')
                .filter_map(|n| n.parse::<u64>().ok())
                .collect::<Vec<_>>()
        })
        .sum();
    assert_eq!(added, exported);

    let report = dir.path().join("report.json.gz");
    commitscape(
        &[
            "report",
            "--no-emails",
            "--offline",
            "--window",
            "all",
            "--cache-dir",
        ],
        &[&cache, Path::new("--out"), &report, &repo],
    );
    let mut text = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(&report).expect("a Report"))
        .read_to_string(&mut text)
        .expect("gzip");
    let written: Value = serde_json::from_str(&text).expect("JSON");
    let meta = json(&out.join("meta.json"));
    let mut want = written["meta"].clone();
    want["anchor"] = meta["meta"]["anchor"].clone();
    assert_eq!(meta["meta"], want);
    assert_eq!(meta["stats"], written["stats"]);
    assert_eq!(meta["head"], manifest["head"]);
    assert_eq!(meta["lines_counted"], true);
    let people: Vec<Value> = written["data"]["/api/people?window=all"]["people"]
        .as_array()
        .expect("people")
        .iter()
        .map(|r| {
            serde_json::json!({
                "person_id": r["person"]["id"],
                "name": r["person"]["name"],
                "login": r["person"]["login"],
                "commits": r["commits"],
                "lines_added": r["lines_added"],
                "lines_removed": r["lines_removed"],
                "first": r["first"],
                "last": r["last"],
            })
        })
        .collect();
    assert!(!people.is_empty());
    assert_eq!(meta["people"], Value::Array(people));
}

#[test]
fn build_without_lines_says_so_everywhere() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let out = dir.path().join("out");
    commitscape(
        &["build", "--offline", "--no-lines", "--no-cache", "--out"],
        &[&out, &fixture("merges")],
    );
    let manifest = json(&out.join("manifest.json"));
    assert_eq!(
        (manifest["lines"].clone(), manifest["lines_counted"].clone()),
        (false.into(), 0.into())
    );
    assert_eq!(manifest["lines_mainline"], false);
    assert!(manifest["lines_left"].is_null());
    assert!(rows(&out.join("commits.tsv"))
        .iter()
        .all(|c| c[11] == "\\N" && c[12] == "\\N"));
    let pack = read_pack(&std::fs::read(out.join("pack.bin")).expect("a pack")).expect("read");
    assert!(!pack.lines_counted && !pack.lines_complete && !pack.lines_mainline);
    let first_parent = pack.mainline.iter().filter(|b| *b & 16 != 0).count();
    let reachable = pack.mainline.iter().filter(|b| *b & 8 != 0).count();
    assert_eq!((reachable, first_parent), (7, 5));
    let meta = json(&out.join("meta.json"));
    assert_eq!(meta["meta"]["lines"], "off");
    assert!(meta["people"]
        .as_array()
        .expect("people")
        .iter()
        .all(|p| p["lines_added"].is_null()));
}

#[test]
fn two_clones_with_one_cache_key_walk_the_history_once() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = dir.path().join("cache");
    let quick = dir.path().join("quick");
    let full = dir.path().join("full");
    let origin = format!("file://{}", fixture("lines").display());
    git(&[
        "clone",
        "--quiet",
        "--filter=blob:none",
        "--upload-pack",
        "git -c uploadpack.allowFilter=true upload-pack",
        &origin,
        quick.to_str().unwrap_or("quick"),
    ]);
    git(&["clone", "--quiet", &origin, full.to_str().unwrap_or("full")]);
    let partial = git(&[
        "-C",
        quick.to_str().unwrap_or("."),
        "config",
        "--get",
        "remote.origin.partialclonefilter",
    ]);
    assert_eq!(partial.trim(), "blob:none");

    let quick_events = dir.path().join("quick.jsonl");
    let quick_out = dir.path().join("quick-out");
    commitscape(
        &[
            "build",
            "--offline",
            "--no-lines",
            "--cache-key",
            "acme/rocket",
            "--cache-dir",
        ],
        &[
            &cache,
            Path::new("--events"),
            &quick_events,
            Path::new("--out"),
            &quick_out,
            &quick,
        ],
    );
    let full_events = dir.path().join("full.jsonl");
    let full_out = dir.path().join("full-out");
    commitscape(
        &[
            "build",
            "--offline",
            "--cache-key",
            "acme/rocket",
            "--cache-dir",
        ],
        &[
            &cache,
            Path::new("--events"),
            &full_events,
            Path::new("--out"),
            &full_out,
            &full,
        ],
    );
    let quick_events = events(&quick_events);
    let full_events = events(&full_events);
    assert_eq!(field(&quick_events, "load", "freshness"), "built");
    assert_ne!(field(&full_events, "load", "freshness"), "built");
    assert_eq!(field(&full_events, "load", "added"), 0);
    assert!(full_events.iter().all(|e| e["span"] != "head_pass"));
    assert_eq!(field(&full_events, "line_pass", "left"), 0);
    assert_eq!(field(&full_events, "line_pass", "counted"), 6);
    let (q, f) = (
        json(&quick_out.join("manifest.json")),
        json(&full_out.join("manifest.json")),
    );
    assert_eq!(q["lineage"], f["lineage"]);
    assert_eq!(f["lines"], true);
    let dirs: Vec<_> = std::fs::read_dir(&cache)
        .expect("the cache")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    assert_eq!(dirs.len(), 1);

    let unkeyed = dir.path().join("unkeyed.jsonl");
    commitscape(
        &["build", "--offline", "--no-lines", "--cache-dir"],
        &[
            &cache,
            Path::new("--events"),
            &unkeyed,
            Path::new("--out"),
            &dir.path().join("unkeyed"),
            &full,
        ],
    );
    assert_eq!(field(&events(&unkeyed), "load", "freshness"), "built");
}

#[test]
fn a_build_after_the_mark_the_site_holds_writes_only_what_changed_since() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let cache = dir.path().join("cache");
    let repo = fixture("lines");
    let build = |name: &str, extra: &[&str], after: Option<&Value>| -> Value {
        let out = dir.path().join(name);
        let mut args = vec!["build", "--offline", "--cache-key", "acme/rocket"];
        args.extend_from_slice(extra);
        let frontier = dir.path().join(format!("{name}.frontier"));
        let (lineage, mark);
        if let Some(m) = after {
            let tips: Vec<&str> = m["frontier"]
                .as_array()
                .expect("a frontier")
                .iter()
                .filter_map(Value::as_str)
                .collect();
            std::fs::write(&frontier, tips.join("\n")).expect("the frontier");
            lineage = m["lineage"].as_str().unwrap_or("").to_string();
            mark = m["mark"].as_str().unwrap_or("").to_string();
            args.extend_from_slice(&["--lineage", &lineage, "--since", &mark]);
            args.push("--after");
            commitscape(
                &args,
                &[
                    &frontier,
                    Path::new("--cache-dir"),
                    &cache,
                    Path::new("--out"),
                    &out,
                    &repo,
                ],
            );
        } else {
            args.push("--cache-dir");
            commitscape(&args, &[&cache, Path::new("--out"), &out, &repo]);
        }
        let mut manifest = json(&out.join("manifest.json"));
        manifest["mainline_rows"] = rows(&out.join("mainline.tsv")).len().into();
        manifest["lines_rows"] = rows(&out.join("lines.tsv")).len().into();
        manifest
    };

    let quick = build("quick", &["--no-lines"], None);
    assert!(quick["mark"].as_str().expect("a mark").contains(".-.-."));
    let counted = build("counted", &[], Some(&quick));
    assert_eq!(counted["full"], false);
    assert_eq!(counted["changes_only"], false);
    assert_eq!(counted["mainline_rows"], 0);
    assert!(counted["lines_rows"].as_u64().unwrap_or(0) >= 6);
    let quiet = build("quiet", &[], Some(&counted));
    assert_eq!(quiet["changes_only"], true);
    assert_eq!(
        (quiet["mainline_rows"].clone(), quiet["lines_rows"].clone()),
        (0.into(), 0.into())
    );
    let mut lost = counted.clone();
    lost["mark"] = "not a mark".into();
    let resent = build("resent", &[], Some(&lost));
    assert_eq!(resent["changes_only"], false);
    assert_eq!(resent["mainline_rows"], 7);
    assert_eq!(resent["lines_rows"], counted["lines_rows"]);
}

fn committed(repo: &Path, files: &[(&str, &str)], when: u64) {
    for (path, text) in files {
        std::fs::write(repo.join(path), text).expect("a file");
    }
    let date = format!("@{when} +0000");
    for args in [
        vec!["add", "-A"],
        vec!["commit", "-q", "-m", "fix: a change"],
    ] {
        let out = Command::new("git")
            .current_dir(repo)
            .args(&args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Ada")
            .env("GIT_AUTHOR_EMAIL", "ada@example.com")
            .env("GIT_COMMITTER_NAME", "Ada")
            .env("GIT_COMMITTER_EMAIL", "ada@example.com")
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .output()
            .expect("git");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

fn outputs(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<(String, Vec<u8>)> = std::fs::read_dir(dir)
        .expect("an output folder")
        .flatten()
        .map(|e| {
            (
                e.file_name().to_string_lossy().into_owned(),
                std::fs::read(e.path()).expect("an output"),
            )
        })
        .collect();
    files.sort();
    files
}

fn copied(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("a folder");
    for entry in std::fs::read_dir(from).expect("a folder").flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copied(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).expect("a copy");
        }
    }
}

fn kept_files(cache: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for dir in std::fs::read_dir(cache).into_iter().flatten().flatten() {
        for f in std::fs::read_dir(dir.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            if f.file_name().to_string_lossy().ends_with(".cols") {
                out.push(f.path());
            }
        }
    }
    out
}

#[test]
fn builds_from_the_kept_columns_write_what_builds_from_the_cache_write_warm_and_after_new_commits()
{
    let dir = tempfile::tempdir().expect("a temporary directory");
    let repo = dir.path().join("repo");
    std::fs::create_dir(&repo).expect("a repository folder");
    git(&[
        "-C",
        repo.to_str().expect("a path"),
        "init",
        "-q",
        "-b",
        "main",
    ]);
    committed(
        &repo,
        &[("a.rs", "1\n2\n3\n"), ("b.md", "x\n")],
        1_700_000_000,
    );
    committed(&repo, &[("a.rs", "1\ntwo\n3\n4\n")], 1_700_086_400);
    let run = |cache: &Path, name: &str, fresh: bool| -> (Vec<(String, Vec<u8>)>, Vec<Value>) {
        if fresh {
            for f in kept_files(cache) {
                std::fs::remove_file(f).expect("removing kept columns");
            }
        }
        let out = dir.path().join(name);
        let events_file = dir.path().join(format!("{name}.events"));
        commitscape(
            &[
                "build",
                "--offline",
                "--anchor",
                "1800000000",
                "--cache-key",
                "acme/kept",
            ],
            &[
                Path::new("--cache-dir"),
                cache,
                Path::new("--events"),
                &events_file,
                Path::new("--out"),
                &out,
                &repo,
            ],
        );
        (outputs(&out), events(&events_file))
    };
    let kept = dir.path().join("kept");
    let plain = dir.path().join("plain");
    for (step, more) in [
        (0, None),
        (1, None),
        (2, Some((1_700_172_800, "c\n"))),
        (3, Some((1_700_259_200, "c\nd\n"))),
        (4, None),
        (5, Some((1_700_345_600, "// @generated\nc\nd\n"))),
        (6, None),
        (7, Some((1_700_432_000, "c\nd\ne\n"))),
        (8, None),
    ] {
        if let Some((when, c)) = more {
            committed(
                &repo,
                &[("a.rs", &format!("1\ntwo\n3\n4\n{when}\n")), ("c.rs", c)],
                when,
            );
        }
        let _ = std::fs::remove_dir_all(&plain);
        if kept.exists() {
            copied(&kept, &plain);
        }
        let (with, events_with) = run(&kept, &format!("kept{step}"), false);
        if step == 0 {
            assert_eq!(field(&events_with, "line_pass", "kept"), Value::Null);
            continue;
        }
        let (without, _) = run(&plain, &format!("plain{step}"), true);
        assert_eq!(
            with.iter().map(|f| &f.0).collect::<Vec<_>>(),
            without.iter().map(|f| &f.0).collect::<Vec<_>>()
        );
        for ((name, a), (_, b)) in with.iter().zip(&without) {
            assert!(a == b, "step {step}: {name} differs");
        }
        assert_eq!(
            kept_files(&kept).len().min(1),
            1,
            "step {step}: columns kept"
        );
        let from_kept = field(&events_with, "line_pass", "kept");
        assert_eq!(
            from_kept,
            if step == 0 {
                Value::Null
            } else {
                Value::Bool(true)
            },
            "step {step}"
        );
    }
}
