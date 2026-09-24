//! The browser interface (ADR-0010): a server on a local port for the web
//! app, built into this binary, and the JSON API it reads.
//!
//! [`serve`] binds, starts the work that comes after the first answer
//! (reading the rest of history, counting lines, asking GitHub), and answers
//! requests until the process ends. What that work changes is announced on
//! `/api/events`, a stream of server-sent events, so the page can fetch
//! again.
//!
//! Like the terminal interface it computes from an Index with the metrics
//! crate and never reaches git; the binary hands it the rest as functions.

pub mod api;
mod assets;
pub mod security;

use std::io::{self, Write};
use std::net::SocketAddr;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use commitscape_core::{AuthorTable, Index, LinePass};
use commitscape_forge::GitHub;
use commitscape_metrics::{Analysis, Options, Span};
use tiny_http::{Header, Request, Response, Server};

pub use assets::built;
pub use security::{Guard, Token};

/// Completes an index with the history it does not hold yet.
pub type LoadOlder = Box<dyn FnOnce(&Index) -> Option<Index> + Send>;
/// Counts every change's lines (ADR-0012).
pub type CountLines = Box<dyn FnOnce(&Index) -> Option<LinePass> + Send>;
/// Links commits to GitHub accounts and returns everyone re-resolved.
pub type LinkAccounts = Box<dyn FnOnce(&Index) -> Option<AuthorTable> + Send>;
/// Asks GitHub about the repository.
pub type LoadGitHub = Box<dyn FnOnce() -> Result<GitHub, String> + Send>;
/// Reads the repository's releases.
pub type LoadReleases = Box<dyn FnOnce() -> Vec<(String, i64)> + Send>;

/// What the server opens on, and how to do what comes after.
pub struct Session {
    pub name: String,
    pub index: Index,
    /// Where every Window ends.
    pub anchor: i64,
    pub span: Span,
    pub options: Options,
    pub older: Option<LoadOlder>,
    pub lines: Option<CountLines>,
    pub link_accounts: Option<LinkAccounts>,
    pub github: Result<LoadGitHub, String>,
    pub releases: Option<LoadReleases>,
}

/// Where the server listens, and who may use it.
pub struct Listen {
    /// Bound already, so the caller can choose another port when one is
    /// taken.
    pub listener: std::net::TcpListener,
    /// This machine's name, allowed as a `Host` when listening beyond it.
    pub machine: Option<String>,
    pub token: Token,
}

/// A running server: where to open it.
pub struct Running {
    pub url: String,
    pub addr: SocketAddr,
    server: Server,
    shared: Arc<Shared>,
}

/// Binds and starts the work that follows. Requests are answered once
/// [`Running::run`] is called, on the thread that calls it.
pub fn serve(session: Session, listen: Listen) -> io::Result<Running> {
    let addr = listen.listener.local_addr()?;
    let server = Server::from_listener(listen.listener, None)
        .map_err(|e| io::Error::other(e.to_string()))?;
    let guard = Guard::new(listen.token, addr, listen.machine.as_deref());
    let shown = if addr.ip().is_unspecified() || addr.ip().is_loopback() {
        format!("127.0.0.1:{}", addr.port())
    } else {
        addr.to_string()
    };
    let url = format!("http://{shown}/?token={}", guard.token.as_str());
    let shared = Arc::new(Shared::new(session, guard));
    start_work(&shared);
    Ok(Running {
        url,
        addr,
        server,
        shared,
    })
}

impl Running {
    /// Answers requests on this thread until the process ends, each on a
    /// thread of its own.
    pub fn run(self) {
        for request in self.server.incoming_requests() {
            let shared = Arc::clone(&self.shared);
            std::thread::spawn(move || handle(&shared, request));
        }
    }
}

/// Where a piece of background work is.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Work {
    Waiting,
    Running,
    Done,
    Off(String),
}

/// Everything requests read, and background work writes.
struct Shared {
    guard: Guard,
    state: Mutex<State>,
}

struct State {
    name: String,
    index: Arc<Index>,
    anchor: i64,
    span: Span,
    options: Options,
    history: Work,
    lines: Work,
    github: Work,
    summary: Option<GitHub>,
    releases: Vec<(String, i64)>,
    generation: u32,
    listeners: Vec<Sender<String>>,
    hooks: Hooks,
}

#[derive(Default)]
struct Hooks {
    older: Option<LoadOlder>,
    lines: Option<CountLines>,
    link: Option<LinkAccounts>,
    github: Option<LoadGitHub>,
    releases: Option<LoadReleases>,
}

impl Shared {
    fn new(session: Session, guard: Guard) -> Shared {
        let history = match (&session.older, session.index.loaded_from) {
            (_, None) => Work::Done,
            (Some(_), Some(_)) => Work::Waiting,
            (None, Some(_)) => Work::Off("could not be read".to_string()),
        };
        let (github, github_hook) = match session.github {
            Ok(load) => (Work::Waiting, Some(load)),
            Err(why) => (Work::Off(why), None),
        };
        Shared {
            guard,
            state: Mutex::new(State {
                name: session.name,
                index: Arc::new(session.index),
                anchor: session.anchor,
                span: session.span,
                options: session.options,
                history,
                lines: if session.lines.is_some() {
                    Work::Waiting
                } else {
                    Work::Off("no cache to keep them in".to_string())
                },
                github,
                summary: None,
                releases: Vec::new(),
                generation: 0,
                listeners: Vec::new(),
                hooks: Hooks {
                    older: session.older,
                    lines: session.lines,
                    link: session.link_accounts,
                    github: github_hook,
                    releases: session.releases,
                },
            }),
        }
    }

    fn with<T>(&self, f: impl FnOnce(&mut State) -> T) -> Option<T> {
        self.state.lock().ok().map(|mut s| f(&mut s))
    }

    /// Records a change and tells every listener.
    fn changed(&self, f: impl FnOnce(&mut State)) {
        let _ = self.with(|s| {
            f(s);
            s.generation += 1;
            let event = serde_json::to_string(&meta(s)).unwrap_or_default();
            s.listeners.retain(|l| l.send(event.clone()).is_ok());
        });
    }
}

/// Starts what comes after the first answer, each on its own thread: the
/// rest of history, then the lines and GitHub's accounts, which need all of
/// it; GitHub's numbers; the releases.
fn start_work(shared: &Arc<Shared>) {
    let (older, github, releases) = shared
        .with(|s| {
            (
                s.hooks.older.take(),
                s.hooks.github.take(),
                s.hooks.releases.take(),
            )
        })
        .unwrap_or((None, None, None));

    let after_history = Arc::clone(shared);
    let history = Arc::clone(shared);
    std::thread::spawn(move || {
        if let Some(load) = older {
            history.changed(|s| s.history = Work::Running);
            let recent = history.with(|s| Arc::clone(&s.index));
            let full = recent.and_then(|r| load(&r));
            history.changed(|s| match full {
                Some(mut full) => {
                    // Keep any change to the people made meanwhile.
                    full.authors = s.index.authors.clone();
                    s.index = Arc::new(full);
                    s.history = Work::Done;
                }
                None => s.history = Work::Off("could not be read".to_string()),
            });
        }
        whole_history_work(&after_history);
    });

    if let Some(load) = github {
        let shared = Arc::clone(shared);
        std::thread::spawn(move || {
            let answer = load();
            shared.changed(|s| match answer {
                Ok(g) => {
                    s.summary = Some(g);
                    s.github = Work::Done;
                }
                Err(why) => s.github = Work::Off(why),
            });
        });
    }
    if let Some(load) = releases {
        let shared = Arc::clone(shared);
        std::thread::spawn(move || {
            let r = load();
            shared.changed(|s| s.releases = r);
        });
    }
}

/// The work that needs all of history: GitHub's accounts, then the lines.
fn whole_history_work(shared: &Arc<Shared>) {
    let (link, lines) = shared
        .with(|s| (s.hooks.link.take(), s.hooks.lines.take()))
        .unwrap_or((None, None));
    if let Some(link) = link {
        let index = shared.with(|s| Arc::clone(&s.index));
        if let Some(table) = index.and_then(|i| link(&i)) {
            shared.changed(|s| {
                let mut index = (*s.index).clone();
                index.authors = table;
                s.index = Arc::new(index);
            });
        }
    }
    if let Some(count) = lines {
        shared.changed(|s| s.lines = Work::Running);
        let index = shared.with(|s| Arc::clone(&s.index));
        let pass = index.and_then(|i| count(&i));
        shared.changed(|s| match pass {
            Some(pass) => {
                pass.apply(Arc::make_mut(&mut s.index));
                s.lines = Work::Done;
            }
            None => s.lines = Work::Off("could not be counted".to_string()),
        });
    }
}

fn word(w: &Work, done: &str) -> String {
    match w {
        Work::Waiting | Work::Running => "loading".to_string(),
        Work::Done => done.to_string(),
        Work::Off(why) => format!("unavailable: {why}"),
    }
}

fn meta(s: &State) -> api::Meta {
    api::Meta {
        name: s.name.clone(),
        windows: Span::EVERY.iter().map(|w| w.label().to_string()).collect(),
        window: s.span.label().to_string(),
        anchor: s.anchor,
        history: match &s.history {
            Work::Off(_) => "unavailable".to_string(),
            w => word(w, "complete"),
        },
        lines: match &s.lines {
            Work::Waiting | Work::Running => "counting".to_string(),
            Work::Done => "counted".to_string(),
            Work::Off(_) => "off".to_string(),
        },
        github: match &s.github {
            Work::Waiting | Work::Running => "asking".to_string(),
            w => word(w, "ready"),
        },
        generation: s.generation,
    }
}

fn header(name: &str, value: &str) -> Option<Header> {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).ok()
}

fn respond(request: Request, status: u16, body: Vec<u8>, content_type: &str, extra: Vec<Header>) {
    let mut response = Response::from_data(body).with_status_code(status);
    let headers = [
        header("Content-Type", content_type),
        header("Cache-Control", "no-store"),
        header("X-Content-Type-Options", "nosniff"),
        header("Referrer-Policy", "no-referrer"),
    ];
    for h in headers.into_iter().flatten().chain(extra) {
        response.add_header(h);
    }
    let _ = request.respond(response);
}

fn json<T: serde::Serialize>(request: Request, value: &T) {
    let body = serde_json::to_vec(value).unwrap_or_default();
    respond(request, 200, body, "application/json", Vec::new());
}

fn message(request: Request, status: u16, text: &str) {
    respond(
        request,
        status,
        text.as_bytes().to_vec(),
        "text/plain; charset=utf-8",
        Vec::new(),
    );
}

/// Answers one request.
fn handle(shared: &Shared, request: Request) {
    let host = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Host"))
        .map(|h| h.value.as_str().to_string());
    if !shared.guard.host_allowed(host.as_deref()) {
        message(
            request,
            403,
            "This server answers only to the address it printed.",
        );
        return;
    }
    let url = request.url().to_string();
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (url.clone(), None),
    };
    let cookie = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Cookie"))
        .map(|h| h.value.as_str().to_string());
    if !shared.guard.authorised(cookie.as_deref(), query.as_deref()) {
        message(
            request,
            401,
            "Open the link commitscape printed: it carries the secret this server asks for.",
        );
        return;
    }
    // The token came in the URL: keep it in a cookie and drop it from the
    // address bar, so it is not shared with a screenshot.
    if security::token_in(query.as_deref()).is_some() && !path.starts_with("/api/") {
        let extra = [
            header("Set-Cookie", &shared.guard.set_cookie()),
            header("Location", &path),
        ];
        respond(
            request,
            303,
            Vec::new(),
            "text/plain",
            extra.into_iter().flatten().collect(),
        );
        return;
    }
    let param = |name: &str| -> Option<String> {
        query
            .as_deref()?
            .split('&')
            .filter_map(|kv| kv.split_once('='))
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.to_string())
    };
    match path.as_str() {
        "/api/meta" => match shared.with(|s| meta(s)) {
            Some(m) => json(request, &m),
            None => message(request, 500, "The server's state could not be read."),
        },
        "/api/overview" => {
            let Some((index, span, anchor, options)) =
                shared.with(|s| (Arc::clone(&s.index), s.span, s.anchor, s.options))
            else {
                message(request, 500, "The server's state could not be read.");
                return;
            };
            let span = param("window")
                .and_then(|w| Span::from_label(&w))
                .unwrap_or(span);
            match Analysis::new(&index, span.window(anchor), options) {
                Ok(a) => json(request, &api::Overview::of(&a, span)),
                Err(_) => message(
                    request,
                    409,
                    "That window needs history that is still being read.",
                ),
            }
        }
        "/api/events" => events(shared, request),
        _ if path.starts_with("/api/") => message(request, 404, "No such API."),
        _ => {
            let (bytes, content_type) = assets::file(&path);
            respond(request, 200, bytes.to_vec(), content_type, Vec::new());
        }
    }
}

/// A stream of server-sent events: the state now, then every change.
fn events(shared: &Shared, request: Request) {
    let (tx, rx) = mpsc::channel();
    let first = shared.with(|s| {
        let now = serde_json::to_string(&meta(s)).unwrap_or_default();
        let _ = tx.send(now);
        s.listeners.push(tx.clone());
    });
    if first.is_none() {
        message(request, 500, "The server's state could not be read.");
        return;
    }
    // A comment every fifteen seconds keeps proxies from closing it.
    let beat = tx;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(15));
        if beat.send(String::new()).is_err() {
            break;
        }
    });
    // Written to the connection itself and flushed after each event: a
    // response body would sit in the server's buffer until it filled.
    let mut out = request.into_writer();
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                Cache-Control: no-store\r\nConnection: close\r\n\r\n";
    if out
        .write_all(head.as_bytes())
        .and_then(|()| out.flush())
        .is_err()
    {
        return;
    }
    while let Ok(event) = rx.recv() {
        let text = if event.is_empty() {
            ": still here\n\n".to_string()
        } else {
            format!("data: {event}\n\n")
        };
        if out
            .write_all(text.as_bytes())
            .and_then(|()| out.flush())
            .is_err()
        {
            break;
        }
    }
}
