//! The HTTP API, through a real server on a local port (ADR-0010): who may
//! use it, and what it answers. Requests are written by hand over a TCP
//! socket, so every header is the one under test.

#![allow(clippy::expect_used)]
// Indexing a `serde_json::Value` gives `null` for what is missing: it does
// not panic.
#![allow(clippy::indexing_slicing)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};

use commitscape_index::source::RawChangeKind::{Added, Modified};
use commitscape_index::{index_from_scratch, ScriptedRepo};
use commitscape_metrics::{Options, Span};
use commitscape_web::{serve, Listen, Session, Token};

/// 2025-07-01T00:00:00Z.
const ANCHOR: i64 = 1_751_328_000;
const DAY: i64 = 86_400;

/// Three commits by Alice and one by Bob in the last month, touching one
/// Rust file of three lines.
fn session() -> Session {
    let blob = |n: u8| commitscape_core::Oid([n; 20]);
    const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
    const BOB: (&str, &str) = ("Bob Builder", "bob@example.com");
    let repo = ScriptedRepo::new()
        .commit(
            ANCHOR - 20 * DAY,
            ALICE,
            &[(b"src/main.rs", Added, blob(1))],
        )
        .said("feat: start")
        .commit(
            ANCHOR - 10 * DAY,
            BOB,
            &[(b"src/main.rs", Modified, blob(2))],
        )
        .said("fix(main): off by one\n\nIt was two.")
        .commit(
            ANCHOR - 5 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(3))],
        )
        .said("Revert \"feat: start\"")
        .commit(
            ANCHOR - 2 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(4))],
        )
        .said("tidy")
        .head_file(b"src/main.rs", "fn main() {\n    run();\n}\n");
    let index = match index_from_scratch(&repo) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let mut session = Session::plain(
        "acme".to_string(),
        index,
        ANCHOR,
        Span::Quarter,
        Options::default(),
    );
    session.commit_link = Some("https://github.com/acme/acme/commit/".to_string());
    session
}

struct Server {
    addr: SocketAddr,
    token: String,
}

fn start() -> Server {
    let running = serve(
        session(),
        Listen {
            listener: std::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
                .expect("a free port"),
            machine: None,
            token: Token::random().expect("a token"),
        },
    )
    .expect("serving");
    let addr = running.addr;
    let token = running
        .url
        .split("token=")
        .nth(1)
        .expect("the URL carries the token")
        .to_string();
    std::thread::spawn(move || running.run());
    Server { addr, token }
}

/// Sends one GET and returns the status, the headers and the body.
fn get(
    server: &Server,
    path: &str,
    host: Option<&str>,
    cookie: Option<&str>,
) -> (u16, String, String) {
    let mut stream = TcpStream::connect(server.addr).expect("connecting");
    let host = host.map_or_else(
        || format!("127.0.0.1:{}", server.addr.port()),
        str::to_string,
    );
    let mut request = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
    if let Some(c) = cookie {
        request.push_str(&format!("Cookie: {c}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).expect("writing");
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    (status, head.to_string(), body.to_string())
}

fn json(body: &str) -> serde_json::Value {
    serde_json::from_str(body).expect("JSON")
}

#[test]
fn nothing_is_answered_without_the_token() {
    let s = start();
    for path in ["/", "/api/meta", "/api/overview"] {
        let (status, _, _) = get(&s, path, None, None);
        assert_eq!(status, 401, "{path}");
    }
    let (status, _, _) = get(&s, "/api/meta?token=wrong", None, None);
    assert_eq!(status, 401);
}

#[test]
fn a_page_on_another_host_cannot_reach_it_even_with_the_token() {
    // DNS rebinding: evil.example resolves to 127.0.0.1, and its page asks.
    let s = start();
    let port = s.addr.port();
    let path = format!("/api/meta?token={}", s.token);
    let (status, _, _) = get(&s, &path, Some(&format!("evil.example:{port}")), None);
    assert_eq!(status, 403);
    let (status, _, _) = get(&s, &path, Some(&format!("localhost:{port}")), None);
    assert_eq!(status, 200, "localhost is this machine");
}

#[test]
fn the_token_in_the_first_link_is_kept_in_a_cookie_and_dropped_from_the_address() {
    let s = start();
    let (status, head, _) = get(&s, &format!("/?token={}", s.token), None, None);
    assert_eq!(status, 303);
    let cookie = format!("commitscape-{}={}", s.addr.port(), s.token);
    assert!(
        head.contains(&format!("{cookie}; HttpOnly; SameSite=Strict")),
        "{head}"
    );
    assert!(head.contains("Location: /"), "{head}");

    let (status, _, body) = get(&s, "/api/meta", None, Some(&cookie));
    assert_eq!(status, 200);
    let meta = json(&body);
    assert_eq!(meta["name"], "acme");
    assert_eq!(meta["window"], "90d");
    assert_eq!(meta["history"], "complete");
    assert_eq!(meta["lines"], "off");
}

#[test]
fn the_overview_counts_the_windows_commits_and_people() {
    let s = start();
    let path = format!("/api/overview?window=all&token={}", s.token);
    let (status, _, body) = get(&s, &path, None, None);
    assert_eq!(status, 200, "{body}");
    let o = json(&body);
    assert_eq!(o["window"], "all");
    assert_eq!(o["totals"]["commits"], 4);
    assert_eq!(o["totals"]["people"], 2);
    assert_eq!(o["totals"]["code_lines"], 3);
    assert_eq!(o["commits"], 4);
    assert_eq!(o["people"][0]["person"]["name"], "Alice Example");
    assert_eq!(o["people"][0]["commits"], 3);
    assert_eq!(o["people"][1]["commits"], 1);
    assert_eq!(o["languages"][0]["name"], "Rust");
}

#[test]
fn events_start_with_the_state_now() {
    let s = start();
    let mut stream = TcpStream::connect(s.addr).expect("connecting");
    let request = format!(
        "GET /api/events?token={} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
        s.token,
        s.addr.port()
    );
    stream.write_all(request.as_bytes()).expect("writing");
    let mut seen = String::new();
    let mut buf = [0u8; 1024];
    while !seen.contains("data: {") {
        let n = stream.read(&mut buf).expect("reading");
        if n == 0 {
            break;
        }
        seen.push_str(&String::from_utf8_lossy(buf.get(..n).unwrap_or_default()));
    }
    assert!(seen.contains("text/event-stream"), "{seen}");
    assert!(seen.contains(r#"data: {"name":"acme""#), "{seen}");
}

#[test]
fn the_commit_list_is_every_commit_newest_first_in_columns() {
    // Worked by hand from `session()`: four commits, the newest first, by
    // Alice (seen first, so person 0), Bob, Alice, Alice.
    let s = start();
    let path = format!("/api/commits?token={}", s.token);
    let (status, _, body) = get(&s, &path, None, None);
    assert_eq!(status, 200, "{body}");
    let l = json(&body);
    assert_eq!(
        l["subjects"],
        serde_json::json!([
            "tidy",
            "Revert \"feat: start\"",
            "fix(main): off by one",
            "feat: start"
        ])
    );
    assert_eq!(
        l["times"],
        serde_json::json!([
            ANCHOR - 2 * DAY,
            ANCHOR - 5 * DAY,
            ANCHOR - 10 * DAY,
            ANCHOR - 20 * DAY
        ])
    );
    assert_eq!(l["person"], serde_json::json!([0, 0, 1, 0]));
    assert_eq!(l["people"][0]["person"]["name"], "Alice Example");
    assert_eq!(
        l["people"][0]["emails"],
        serde_json::json!(["alice@example.com"])
    );
    assert_eq!(l["people"][1]["person"]["name"], "Bob Builder");
    // Other, Revert, Fix, Feature: their places in the list of kinds.
    let kinds: Vec<String> = l["kind"]
        .as_array()
        .expect("kinds")
        .iter()
        .map(|k| {
            l["kinds"][k.as_u64().expect("a number") as usize]
                .as_str()
                .unwrap_or("")
                .to_string()
        })
        .collect();
    assert_eq!(kinds, ["other", "reverts", "fixes", "features"]);
    assert_eq!(l["files"], serde_json::json!([1, 1, 1, 1]));
    assert_eq!(l["merge"], serde_json::json!([false, false, false, false]));
    // No line pass ran: unknown, never 0.
    assert_eq!(l["lines"], false);
    assert_eq!(l["added"], serde_json::json!([null, null, null, null]));
    assert_eq!(l["link"], "https://github.com/acme/acme/commit/");
    assert_eq!(l["ids"][0].as_str().map(str::len), Some(40));
}

#[test]
fn a_reports_stats_are_the_leaderboards_numbers() {
    // Worked by hand. Alice commits on days -20, -5 and -2 before the
    // anchor, Bob on day -10: 4 commits, 2 people, all in the last 30 days.
    // Alice made 3 of the last year's 4 (75%, not over 80%), so the Bus
    // Factor is 2; only Alice has 3 or more in 90 days. `old.rs` (2 lines)
    // was last touched six years ago; `src/main.rs` has 3.
    let blob = |n: u8| commitscape_core::Oid([n; 20]);
    const ALICE: (&str, &str) = ("Alice Example", "alice@example.com");
    const BOB: (&str, &str) = ("Bob Builder", "bob@example.com");
    let repo = ScriptedRepo::new()
        .commit(ANCHOR - 6 * 365 * DAY, BOB, &[(b"old.rs", Added, blob(9))])
        .commit(
            ANCHOR - 20 * DAY,
            ALICE,
            &[(b"src/main.rs", Added, blob(1))],
        )
        .commit(
            ANCHOR - 10 * DAY,
            BOB,
            &[(b"src/main.rs", Modified, blob(2))],
        )
        .commit(
            ANCHOR - 5 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(3))],
        )
        .commit(
            ANCHOR - 2 * DAY,
            ALICE,
            &[(b"src/main.rs", Modified, blob(4))],
        )
        .head_file(b"src/main.rs", "fn main() {\n    run();\n}\n")
        .head_file(b"old.rs", "fn old() {}\n// kept\n");
    let index = match index_from_scratch(&repo) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let stats =
        commitscape_web::api::Stats::of(&index, ANCHOR, Options::default(), &[]).expect("stats");
    assert_eq!(stats.commits, 5);
    assert_eq!(stats.people, 2);
    assert_eq!(stats.bus_factor, Some(2));
    assert_eq!(stats.maintainers, 1);
    assert_eq!((stats.commits_30d, stats.people_30d), (4, 2));
    assert_eq!((stats.code_lines, stats.untouched_5y), (5, 2));
}

#[test]
fn a_months_people_are_all_counted_past_the_ranking_limit() {
    // 1,005 people each make one commit in the last 30 days: every ranking
    // stops at its first 1,000, but the Leaderboards' counts do not.
    let blob = |n: u16| {
        let mut id = [0; 20];
        id[..2].copy_from_slice(&n.to_be_bytes());
        commitscape_core::Oid(id)
    };
    let people: Vec<(String, String)> = (0..1005)
        .map(|i| (format!("Person {i}"), format!("p{i}@example.com")))
        .collect();
    let mut repo = ScriptedRepo::new();
    for (i, (name, email)) in people.iter().enumerate() {
        let i = i as u16;
        repo = repo.commit(
            ANCHOR - DAY - i64::from(i) * 60,
            (name.as_str(), email.as_str()),
            &[(b"a.rs", if i == 0 { Added } else { Modified }, blob(i))],
        );
    }
    let index = match index_from_scratch(&repo.head_file(b"a.rs", "fn a() {}\n")) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    let stats =
        commitscape_web::api::Stats::of(&index, ANCHOR, Options::default(), &[]).expect("stats");
    assert_eq!((stats.commits_30d, stats.people_30d), (1005, 1005));
}
