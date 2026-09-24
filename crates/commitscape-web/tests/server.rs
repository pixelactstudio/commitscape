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
        .head_file(b"src/main.rs", "fn main() {\n    run();\n}\n");
    let index = match index_from_scratch(&repo) {
        Ok(i) => i,
        Err(never) => match never {},
    };
    Session::plain(
        "acme".to_string(),
        index,
        ANCHOR,
        Span::Quarter,
        Options::default(),
    )
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
