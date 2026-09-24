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
pub mod filter;
pub mod report;
pub mod security;
pub mod wrapped_card;

use std::collections::HashMap;
use std::io::{self, Write};
use std::net::SocketAddr;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use commitscape_core::{AuthorId, AuthorTable, Index, LinePass};
use commitscape_forge::history::History;
use commitscape_forge::GitHub;
use commitscape_metrics::{Analysis, Options, Span, Window};
use tiny_http::{Header, Method, Request, Response, Server};

pub use assets::built;
pub use filter::Filter;
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
/// Reads GitHub's whole history, a page at a time: calls back first with
/// what was read before, then with where it is, in words, after each page.
pub type LoadHistory = Box<dyn FnOnce(&dyn Fn(Option<&History>, &str)) -> Option<History> + Send>;
/// The GitHub login of each address GitHub linked to an account, as kept.
pub type ReadAccounts = Arc<dyn Fn() -> HashMap<String, String> + Send + Sync>;
/// Undoes (`true`) or redoes (`false`) the merge that made a person, and
/// returns everyone re-resolved.
pub type ChangePeople =
    Arc<dyn Fn(&AuthorTable, AuthorId, bool) -> Option<AuthorTable> + Send + Sync>;
/// Draws the card for an index and a Window, as SVG.
pub type DrawCard = Arc<dyn Fn(&Index, Span, i64) -> String + Send + Sync>;

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
    pub history: Option<LoadHistory>,
    pub accounts: Option<ReadAccounts>,
    pub people: Option<ChangePeople>,
    pub card: Option<DrawCard>,
}

impl Session {
    /// A session that does nothing after its first answer.
    pub fn plain(name: String, index: Index, anchor: i64, span: Span, options: Options) -> Session {
        Session {
            name,
            index,
            anchor,
            span,
            options,
            older: None,
            lines: None,
            link_accounts: None,
            github: Err("not asked".to_string()),
            releases: None,
            history: None,
            accounts: None,
            people: None,
            card: None,
        }
    }
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
    /// Where reading GitHub's whole history is, in words.
    github_history: String,
    gh_history: Option<Arc<History>>,
    releases: Vec<(String, i64)>,
    /// Each person's colour and GitHub logins, for the index as it is.
    colours: Arc<HashMap<AuthorId, u8>>,
    logins: Arc<HashMap<String, AuthorId>>,
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
    history: Option<LoadHistory>,
    accounts: Option<ReadAccounts>,
    people: Option<ChangePeople>,
    card: Option<DrawCard>,
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
        let mut state = State {
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
            github_history: if session.history.is_some() {
                "waiting".to_string()
            } else {
                "off".to_string()
            },
            gh_history: None,
            releases: Vec::new(),
            colours: Arc::default(),
            logins: Arc::default(),
            generation: 0,
            listeners: Vec::new(),
            hooks: Hooks {
                older: session.older,
                lines: session.lines,
                link: session.link_accounts,
                github: github_hook,
                releases: session.releases,
                history: session.history,
                accounts: session.accounts,
                people: session.people,
                card: session.card,
            },
        };
        state.people_changed();
        Shared {
            guard,
            state: Mutex::new(state),
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

impl State {
    /// Recomputes what depends on who is who.
    fn people_changed(&mut self) {
        self.colours = Arc::new(api::colours(&self.index));
        let accounts = self
            .hooks
            .accounts
            .as_ref()
            .map(|a| a())
            .unwrap_or_default();
        self.logins = Arc::new(api::logins(&self.index, &accounts));
    }
}

/// Starts what comes after the first answer, each on its own thread: the
/// rest of history, then GitHub's accounts and the lines, which need all
/// of it; GitHub's numbers and its whole history; the releases.
fn start_work(shared: &Arc<Shared>) {
    let (older, github, releases, history) = shared
        .with(|s| {
            (
                s.hooks.older.take(),
                s.hooks.github.take(),
                s.hooks.releases.take(),
                s.hooks.history.take(),
            )
        })
        .unwrap_or((None, None, None, None));

    let after = Arc::clone(shared);
    std::thread::spawn(move || {
        if let Some(load) = older {
            after.changed(|s| s.history = Work::Running);
            let recent = after.with(|s| Arc::clone(&s.index));
            let full = recent.and_then(|r| load(&r));
            after.changed(|s| match full {
                Some(mut full) => {
                    // Keep any change to the people made meanwhile.
                    full.authors = s.index.authors.clone();
                    s.index = Arc::new(full);
                    s.history = Work::Done;
                }
                None => s.history = Work::Off("could not be read".to_string()),
            });
        }
        whole_history_work(&after);
    });

    if let Some(load) = github {
        let shared = Arc::clone(shared);
        std::thread::spawn(move || {
            let answer = load();
            shared.changed(|s| match answer {
                Ok(_) => s.github = Work::Done,
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
    if let Some(load) = history {
        let shared = Arc::clone(shared);
        std::thread::spawn(move || {
            let progress = |h: Option<&History>, words: &str| {
                let h = h.map(|h| Arc::new(h.clone()));
                let words = words.to_string();
                shared.changed(|s| {
                    if h.is_some() {
                        s.gh_history = h;
                    }
                    s.github_history = words;
                });
            };
            let done = load(&progress);
            shared.changed(|s| {
                s.github_history = match &done {
                    Some(h) if h.complete => "complete".to_string(),
                    Some(_) => "stopped early; it carries on next time".to_string(),
                    None => "unavailable".to_string(),
                };
                if let Some(h) = done {
                    s.gh_history = Some(Arc::new(h));
                }
            });
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
                Arc::make_mut(&mut s.index).authors = table;
                s.people_changed();
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

fn meta(s: &State) -> api::Meta {
    api::Meta {
        name: s.name.clone(),
        windows: Span::EVERY.iter().map(|w| w.label().to_string()).collect(),
        window: s.span.label().to_string(),
        anchor: s.anchor,
        history: match &s.history {
            Work::Waiting | Work::Running => "loading".to_string(),
            Work::Done => "complete".to_string(),
            Work::Off(_) => "unavailable".to_string(),
        },
        lines: match &s.lines {
            Work::Waiting | Work::Running => "counting".to_string(),
            Work::Done => "counted".to_string(),
            Work::Off(_) => "off".to_string(),
        },
        github: match &s.github {
            Work::Waiting | Work::Running => "asking".to_string(),
            Work::Done => "ready".to_string(),
            Work::Off(why) => format!("unavailable: {why}"),
        },
        github_history: s.github_history.clone(),
        can_change_people: s.hooks.people.is_some(),
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

/// A query string's parameters, percent-decoded.
pub(crate) fn params(query: Option<&str>) -> HashMap<String, String> {
    query
        .unwrap_or("")
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), decode(v)))
        .collect()
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while let Some(&b) = bytes.get(i) {
        let hex = |j: usize| {
            bytes
                .get(j)
                .and_then(|&c| (c as char).to_digit(16))
                .map(|d| d as u8)
        };
        match (b, hex(i + 1), hex(i + 2)) {
            (b'%', Some(h), Some(l)) => {
                out.push(h * 16 + l);
                i += 3;
            }
            (b'+', _, _) => {
                out.push(b' ');
                i += 1;
            }
            _ => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What a request for data asks: the Window or a date range, and a
/// filter.
struct Asked {
    window: Window,
    label: String,
    filter: Filter,
}

fn asked(p: &HashMap<String, String>, span: Span, anchor: i64) -> Asked {
    let span = p
        .get("window")
        .and_then(|w| Span::from_label(w))
        .unwrap_or(span);
    let mut window = span.window(anchor);
    let mut label = span.label().to_string();
    let from = p.get("from").and_then(|v| v.parse::<i64>().ok());
    let to = p.get("to").and_then(|v| v.parse::<i64>().ok());
    if from.is_some() || to.is_some() {
        window = Window {
            from,
            to: to.unwrap_or(anchor),
        };
        label = "range".to_string();
    }
    Asked {
        window,
        label,
        filter: Filter {
            person: p.get("person").and_then(|v| v.parse().ok()).map(AuthorId),
            folder: p.get("folder").filter(|f| !f.is_empty()).cloned(),
        },
    }
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
    let p = params(query.as_deref());
    if *request.method() == Method::Post {
        match path.as_str() {
            "/api/person/undo" | "/api/person/redo" => {
                change_people(shared, request, &p, path.ends_with("undo"))
            }
            _ => message(request, 404, "No such API."),
        }
        return;
    }
    match path.as_str() {
        "/api/meta" => match shared.with(|s| meta(s)) {
            Some(m) => json(request, &m),
            None => message(request, 500, "The server's state could not be read."),
        },
        "/api/events" => events(shared, request),
        "/api/card.svg" => card(shared, request, &p),
        _ if path.starts_with("/api/") => data(shared, request, &path, &p),
        _ => {
            let (bytes, content_type) = assets::file(&path);
            let body = if content_type.starts_with("text/html") {
                with_meta(bytes, shared)
            } else {
                bytes.to_vec()
            };
            respond(request, 200, body, content_type, Vec::new());
        }
    }
}

/// The app's page with the state now written into it, so its first
/// question need not wait for the first event.
fn with_meta(page: &[u8], shared: &Shared) -> Vec<u8> {
    let page = String::from_utf8_lossy(page);
    let Some(meta) = shared.with(|s| serde_json::to_string(&meta(s)).unwrap_or_default()) else {
        return page.into_owned().into_bytes();
    };
    // In a script, `</` would end it early: JSON allows `<\/` for it.
    let script = format!(
        "<script>window.__COMMITSCAPE_META__ = {};</script></head>",
        meta.replace("</", "<\\/")
    );
    page.replacen("</head>", &script, 1).into_bytes()
}

/// Everything a screen's data is computed from, taken under the lock.
pub(crate) struct Snapshot {
    pub index: Arc<Index>,
    pub anchor: i64,
    pub span: Span,
    pub options: Options,
    pub releases: Vec<(String, i64)>,
    pub lines_counted: bool,
    pub history: Option<Arc<History>>,
    pub colours: Arc<HashMap<AuthorId, u8>>,
    pub logins: Arc<HashMap<String, AuthorId>>,
}

fn snapshot(shared: &Shared) -> Option<Snapshot> {
    shared.with(|s| Snapshot {
        index: Arc::clone(&s.index),
        anchor: s.anchor,
        span: s.span,
        options: s.options,
        releases: s.releases.clone(),
        lines_counted: s.lines == Work::Done,
        history: s.gh_history.clone(),
        colours: Arc::clone(&s.colours),
        logins: Arc::clone(&s.logins),
    })
}

/// A screen's data, as JSON, or why there is none.
pub(crate) fn screen(
    snap: &Snapshot,
    path: &str,
    p: &HashMap<String, String>,
) -> Result<Vec<u8>, (u16, String)> {
    let asked = asked(p, snap.span, snap.anchor);
    let filtered;
    let index: &Index = if asked.filter.is_empty() {
        &snap.index
    } else if snap.index.loaded_from.is_some() {
        // A filter's totals are over all of history, which is not read yet.
        return Err((
            409,
            "Filters wait for the rest of history, which is being read now.".to_string(),
        ));
    } else {
        filtered = asked
            .filter
            .apply(&snap.index, snap.options.max_changeset_size);
        &filtered
    };
    let a = Analysis::new(index, asked.window, snap.options).map_err(|_| {
        (
            409,
            "That window needs history that is still being read.".to_string(),
        )
    })?;
    let cx = api::Context {
        window: &asked.label,
        colours: &snap.colours,
        releases: &snap.releases,
        lines_counted: snap.lines_counted,
        history: snap.history.as_deref(),
        logins: &snap.logins,
    };
    let missing = || (404, "No such person, folder or file.".to_string());
    let body = match path {
        "/api/overview" => serde_json::to_vec(&api::Overview::of(&a, &cx)),
        "/api/activity" => serde_json::to_vec(&api::Activity::of(&a, &cx)),
        "/api/people" => serde_json::to_vec(&api::People::of(&a, &cx)),
        "/api/risk" => serde_json::to_vec(&api::Risk::of(&a, &cx)),
        "/api/person" => {
            let id = p.get("id").and_then(|v| v.parse().ok()).map(AuthorId);
            let person = id
                .and_then(|id| api::Person::of(&a, &cx, id))
                .ok_or_else(missing)?;
            serde_json::to_vec(&person)
        }
        "/api/map" => {
            let at = p.get("path").map(String::as_str).unwrap_or("");
            let level = api::MapLevel::of(&a, &cx, at).ok_or_else(missing)?;
            serde_json::to_vec(&level)
        }
        "/api/file" => {
            let at = p.get("path").map(String::as_str).unwrap_or("");
            let file = api::File::of(&a, &cx, at).ok_or_else(missing)?;
            serde_json::to_vec(&file)
        }
        _ => return Err((404, "No such API.".to_string())),
    };
    body.map_err(|e| (500, e.to_string()))
}

fn data(shared: &Shared, request: Request, path: &str, p: &HashMap<String, String>) {
    let Some(snap) = snapshot(shared) else {
        message(request, 500, "The server's state could not be read.");
        return;
    };
    match screen(&snap, path, p) {
        Ok(body) => respond(request, 200, body, "application/json", Vec::new()),
        Err((status, why)) => message(request, status, &why),
    }
}

fn card(shared: &Shared, request: Request, p: &HashMap<String, String>) {
    let Some((draw, index, span, anchor)) =
        shared.with(|s| (s.hooks.card.clone(), Arc::clone(&s.index), s.span, s.anchor))
    else {
        message(request, 500, "The server's state could not be read.");
        return;
    };
    let Some(draw) = draw else {
        message(request, 404, "This server draws no card.");
        return;
    };
    let span = p
        .get("window")
        .and_then(|w| Span::from_label(w))
        .unwrap_or(span);
    let svg = draw(&index, span, anchor);
    respond(request, 200, svg.into_bytes(), "image/svg+xml", Vec::new());
}

/// Undoes or redoes the merge behind a person (ADR-0011), under the lock,
/// so a change made meanwhile (GitHub's accounts arriving, say) is not
/// written over.
fn change_people(shared: &Shared, request: Request, p: &HashMap<String, String>, undo: bool) {
    let Some(change) = shared.with(|s| s.hooks.people.clone()) else {
        message(request, 500, "The server's state could not be read.");
        return;
    };
    let Some(change) = change else {
        message(
            request,
            409,
            "Merges can be undone only with a cache to keep the undo in.",
        );
        return;
    };
    let Some(id) = p.get("id").and_then(|v| v.parse().ok()).map(AuthorId) else {
        message(request, 400, "Which person?");
        return;
    };
    let mut done = false;
    shared.changed(|s| {
        if let Some(table) = change(&s.index.authors, id, undo) {
            Arc::make_mut(&mut s.index).authors = table;
            s.people_changed();
            done = true;
        }
    });
    if done {
        message(request, 200, "done");
    } else {
        message(
            request,
            409,
            "That person's identities could not be changed.",
        );
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
