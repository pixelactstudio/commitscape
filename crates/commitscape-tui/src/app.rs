//! The interface as a state machine: events in, commands out, and a frame
//! drawn from the state alone.

use std::collections::HashMap;
use std::sync::Arc;

use commitscape_core::{AuthorId, Index};
use commitscape_forge::GitHub;
use commitscape_metrics::{Age, Analysis, CodeMap, Options, Span, Window};
use ratatui::crossterm::event::{
    Event as TerminalEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
};
use ratatui::style::Color;
use ratatui::Frame;

use crate::detail::{Opened, Target};
use crate::findings::Findings;
use crate::list::Cursor;
use crate::theme;
use crate::ui;
use crate::{LoadGitHub, LoadOlder, Session};

/// The Panels, in tab order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Panel {
    Overview,
    Activity,
    People,
    Map,
    Hotspots,
    Coupling,
    Ownership,
    Age,
    GitHub,
}

impl Panel {
    pub const EVERY: [Panel; 9] = [
        Panel::Overview,
        Panel::Activity,
        Panel::People,
        Panel::Map,
        Panel::Hotspots,
        Panel::Coupling,
        Panel::Ownership,
        Panel::Age,
        Panel::GitHub,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Panel::Overview => "Overview",
            Panel::Activity => "Activity",
            Panel::People => "People",
            Panel::Map => "Map",
            Panel::Hotspots => "Hotspots",
            Panel::Coupling => "Coupling",
            Panel::Ownership => "Ownership",
            Panel::Age => "Age",
            Panel::GitHub => "GitHub",
        }
    }

    pub fn position(self) -> usize {
        Panel::EVERY.iter().position(|p| *p == self).unwrap_or(0)
    }

    /// Panels whose rows a search narrows.
    fn searchable(self) -> bool {
        matches!(
            self,
            Panel::People | Panel::Hotspots | Panel::Coupling | Panel::Ownership
        )
    }
}

/// One finding the Overview leads with. Each can be entered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Headline {
    /// A directory one person holds, by its place in the Ownership ranking.
    Directory(usize),
    Hotspot,
    /// The first pair across directories, by its place in the Coupling
    /// ranking.
    Pair(usize),
    Stale,
    People,
}

/// Directories one person holds that the Overview lists.
pub(crate) const HELD_DIRECTORIES: usize = 2;

pub(crate) fn headlines(f: &Findings) -> Vec<Headline> {
    let mut out: Vec<Headline> = f
        .ownership
        .directories
        .iter()
        .enumerate()
        .filter(|(_, d)| d.bus_factor == 1)
        .take(HELD_DIRECTORIES)
        .map(|(i, _)| Headline::Directory(i))
        .collect();
    if !f.hotspots.is_empty() {
        out.push(Headline::Hotspot);
    }
    if let Some(i) = f.coupling.pairs.iter().position(|p| p.cross_directory) {
        out.push(Headline::Pair(i));
    }
    out.push(Headline::Stale);
    if !f.duplicates.is_empty() {
        out.push(Headline::People);
    }
    out
}

/// Something that happened: a key, or work finishing off the main thread.
pub struct Event(Happened);

enum Happened {
    Key(KeyEvent),
    Redraw,
    Computed {
        span: Span,
        findings: Option<Box<Findings>>,
    },
    Older(Option<Arc<Index>>),
    GitHub(Result<Box<GitHub>, String>),
    Mapped {
        span: Span,
        map: Option<CodeMap>,
    },
}

impl Event {
    pub fn key(key: KeyEvent) -> Event {
        Event(Happened::Key(key))
    }

    /// A terminal event, if it is one the interface reacts to.
    pub fn from_terminal(event: TerminalEvent) -> Option<Event> {
        match event {
            TerminalEvent::Key(key) => Some(Event::key(key)),
            TerminalEvent::Resize(..) => Some(Event(Happened::Redraw)),
            _ => None,
        }
    }
}

/// Work for another thread. Running it gives the Event to feed back.
pub struct Command(Job);

enum Job {
    Compute {
        index: Arc<Index>,
        span: Span,
        window: Window,
        options: Options,
    },
    Older {
        index: Arc<Index>,
        load: LoadOlder,
    },
    GitHub(LoadGitHub),
    /// The Map of a Window whose other findings are known.
    Map {
        index: Arc<Index>,
        span: Span,
        window: Window,
        options: Options,
    },
}

impl Command {
    pub fn run(self) -> Event {
        match self.0 {
            Job::Compute {
                index,
                span,
                window,
                options,
            } => Event(Happened::Computed {
                span,
                findings: Analysis::new(&index, window, options)
                    .ok()
                    .map(|a| Box::new(Findings::of(&a))),
            }),
            Job::Older { index, load } => Event(Happened::Older(load(&index).map(Arc::new))),
            Job::GitHub(load) => Event(Happened::GitHub(load().map(Box::new))),
            Job::Map {
                index,
                span,
                window,
                options,
            } => Event(Happened::Mapped {
                span,
                map: Analysis::new(&index, window, options)
                    .ok()
                    .map(|a| a.code_map()),
            }),
        }
    }
}

/// The history older than the index holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Older {
    /// The index holds all of it.
    Complete,
    Loading,
    Unavailable,
}

/// What GitHub has said about the repository.
pub(crate) enum GitHubState {
    Asking,
    Ready(Box<GitHub>),
    /// Why there is nothing to show.
    Unavailable(String),
}

/// How the Map colours its rectangles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MapColour {
    /// The Window's commits: where the work is.
    Heat,
    /// Time since last touched.
    Age,
    /// Who made most of the Window's commits there.
    Owner,
}

impl MapColour {
    fn next(self) -> MapColour {
        match self {
            MapColour::Heat => MapColour::Age,
            MapColour::Age => MapColour::Owner,
            MapColour::Owner => MapColour::Heat,
        }
    }
}

/// Where the Map is zoomed to, and what is selected there.
pub(crate) struct MapView {
    /// The node whose children fill the Map.
    pub at: usize,
    pub cursor: Cursor,
    pub colour: MapColour,
}

/// A search narrowing a Panel's rows.
#[derive(Default)]
pub(crate) struct Search {
    pub query: String,
    /// Keys go to the query rather than to the interface.
    pub typing: bool,
}

/// What Enter does from a Panel.
enum Entry {
    Open(Target),
    Show(Panel),
    Zoom(usize),
}

pub struct App {
    pub(crate) name: String,
    pub(crate) index: Arc<Index>,
    pub(crate) anchor: i64,
    pub(crate) options: Options,
    pub(crate) span: Span,
    pub(crate) panel: Panel,
    /// By position in [`Span::EVERY`].
    findings: [Option<Box<Findings>>; 4],
    computing: [bool; 4],
    pub(crate) older: Older,
    /// By position in [`Panel::EVERY`].
    pub(crate) cursors: [Cursor; 9],
    /// Details entered, innermost last.
    pub(crate) opened: Vec<Opened>,
    pub(crate) github: GitHubState,
    /// The help window, when open, and how far it is scrolled.
    pub(crate) help: Option<usize>,
    pub(crate) search: Search,
    pub(crate) map: MapView,
    /// Each person's colour, fixed by how much they have committed over all
    /// of history so that it never changes with the Window.
    pub(crate) colours: HashMap<AuthorId, Color>,
    /// Names two or more people share, so they are told apart when shown.
    shared_names: std::collections::HashSet<String>,
    /// Names and email handles two or more people share, told apart by
    /// their email's domain instead.
    shared_handles: std::collections::HashSet<(String, String)>,
    /// Rows a page key moves: what the last frame could show.
    pub(crate) page: usize,
    done: bool,
}

impl App {
    /// The interface, ready to draw a first frame with findings in it: the
    /// first Window is computed here, not on another thread. The commands
    /// returned are work to start once that frame is drawn.
    pub fn new(session: Session) -> (App, Vec<Command>) {
        let Session {
            name,
            index,
            anchor,
            span,
            options,
            older,
            github,
        } = session;
        let older_state = match (&older, index.loaded_from) {
            (_, None) => Older::Complete,
            (Some(_), Some(_)) => Older::Loading,
            (None, Some(_)) => Older::Unavailable,
        };
        let colours = colours(&index);
        // Counted over borrowed names, and handles only for shared names:
        // Linux has tens of thousands of authors, and a String for each
        // took 27ms of the first frame.
        let mut names: HashMap<&str, u32> = HashMap::new();
        for (_, a) in index.authors.iter() {
            *names.entry(a.name).or_default() += 1;
        }
        let mut handles: HashMap<(&str, &str), u32> = HashMap::new();
        for (_, a) in index.authors.iter() {
            if names.get(a.name).is_some_and(|&n| n > 1) {
                *handles.entry((a.name, handle(a.email))).or_default() += 1;
            }
        }
        let shared_handles = handles
            .into_iter()
            .filter(|&(_, n)| n > 1)
            .map(|((name, handle), _)| (name.to_string(), handle.to_string()))
            .collect();
        let shared_names = names
            .into_iter()
            .filter(|&(_, n)| n > 1)
            .map(|(name, _)| name.to_string())
            .collect();
        let mut app = App {
            name,
            index: Arc::new(index),
            anchor,
            options,
            span,
            panel: Panel::Overview,
            findings: Default::default(),
            computing: [false; 4],
            older: older_state,
            cursors: [Cursor::default(); 9],
            opened: Vec::new(),
            github: GitHubState::Asking,
            help: None,
            search: Search::default(),
            map: MapView {
                at: 0,
                cursor: Cursor::default(),
                colour: MapColour::Heat,
            },
            colours,
            shared_names,
            shared_handles,
            page: 10,
            done: false,
        };
        let mut commands = Vec::new();
        let window = span.window(anchor);
        if let Ok(analysis) = Analysis::new(&app.index, window, options) {
            if let Some(slot) = app.findings.get_mut(slot(span)) {
                *slot = Some(Box::new(Findings::without_map(&analysis)));
                commands.push(Command(Job::Map {
                    index: Arc::clone(&app.index),
                    span,
                    window,
                    options,
                }));
            }
        }
        match older {
            Some(load) if older_state == Older::Loading => commands.push(Command(Job::Older {
                index: Arc::clone(&app.index),
                load,
            })),
            _ => {}
        }
        match github {
            Ok(load) => commands.push(Command(Job::GitHub(load))),
            Err(why) => app.github = GitHubState::Unavailable(why),
        }
        (app, commands)
    }

    /// Whether the user has asked to leave.
    pub fn done(&self) -> bool {
        self.done
    }

    pub fn update(&mut self, event: Event) -> Vec<Command> {
        match event.0 {
            Happened::Key(key) => self.key(key),
            Happened::Redraw => Vec::new(),
            Happened::Computed { span, findings } => {
                if let Some(busy) = self.computing.get_mut(slot(span)) {
                    *busy = false;
                }
                match findings {
                    Some(f) => {
                        if let Some(known) = self.findings.get_mut(slot(span)) {
                            *known = Some(f);
                        }
                        Vec::new()
                    }
                    // Computed from an index that did not reach back far
                    // enough. If the rest of history has arrived since, this
                    // computes it again.
                    None => self.ensure(span),
                }
            }
            Happened::Older(Some(index)) => {
                self.index = index;
                self.older = Older::Complete;
                self.ensure(self.span)
            }
            Happened::Older(None) => {
                self.older = Older::Unavailable;
                Vec::new()
            }
            Happened::GitHub(answer) => {
                self.github = match answer {
                    Ok(github) => GitHubState::Ready(github),
                    Err(why) => GitHubState::Unavailable(why),
                };
                Vec::new()
            }
            Happened::Mapped { span, map } => {
                if let Some(Some(known)) = self.findings.get_mut(slot(span)) {
                    known.map = map;
                }
                Vec::new()
            }
        }
    }

    pub fn draw(&mut self, frame: &mut Frame) {
        ui::draw(self, frame);
    }

    /// The findings for the current Window, once computed.
    pub(crate) fn current(&self) -> Option<&Findings> {
        self.findings
            .get(slot(self.span))
            .and_then(|f| f.as_deref())
    }

    /// A person's name as the interface shows it. Two people who share a
    /// name are told apart by the start of their email, `Dev Talan
    /// (devchaudhary24k)`, or by its domain when that is shared too.
    pub(crate) fn display_name(&self, author: AuthorId) -> String {
        self.index
            .authors
            .get(author)
            .map(|a| self.label_for(a.name, a.email))
            .unwrap_or_default()
    }

    /// [`display_name`](Self::display_name) for a name and email.
    pub(crate) fn label_for(&self, name: &str, email: &str) -> String {
        if !self.shared_names.contains(name) {
            return name.to_string();
        }
        let handle = handle(email);
        if self
            .shared_handles
            .contains(&(name.to_string(), handle.to_string()))
        {
            let domain = email.rsplit('@').next().unwrap_or(email);
            return format!("{name} ({domain})");
        }
        format!("{name} ({handle})")
    }

    /// A person's colour: one of the eight categorical colours for the eight
    /// who committed most, grey for everyone else.
    pub(crate) fn colour_of(&self, author: AuthorId) -> Color {
        self.colours.get(&author).copied().unwrap_or(theme::MUTED)
    }

    fn key(&mut self, key: KeyEvent) -> Vec<Command> {
        if key.kind == KeyEventKind::Release {
            return Vec::new();
        }
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.done = true;
            return Vec::new();
        }
        if self.search.typing {
            self.type_search(key.code);
            return Vec::new();
        }
        if let Some(scroll) = self.help.as_mut() {
            match key.code {
                KeyCode::Esc | KeyCode::Char('?') | KeyCode::Char('q') => self.help = None,
                KeyCode::Up | KeyCode::Char('k') => *scroll = scroll.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => *scroll += 1,
                KeyCode::PageUp => *scroll = scroll.saturating_sub(self.page),
                KeyCode::PageDown => *scroll += self.page,
                _ => {}
            }
            return Vec::new();
        }
        let page = self.page as isize;
        match key.code {
            KeyCode::Char('q') => self.done = true,
            KeyCode::Char('?') => self.help = Some(0),
            KeyCode::Char('/') if self.panel.searchable() && self.opened.is_empty() => {
                self.search.typing = true;
            }
            KeyCode::Esc | KeyCode::Backspace => self.back(),
            KeyCode::Char('w') => return self.switch(self.span_after(1)),
            KeyCode::Char('W') => return self.switch(self.span_after(-1)),
            KeyCode::Char('c') if self.panel == Panel::Map => {
                self.map.colour = self.map.colour.next();
            }
            KeyCode::Tab | KeyCode::Right | KeyCode::Char('l') => self.show(self.panel_after(1)),
            KeyCode::BackTab | KeyCode::Left | KeyCode::Char('h') => {
                self.show(self.panel_after(-1))
            }
            KeyCode::Char(c @ '1'..='9') => {
                let n = c as usize - '1' as usize;
                if let Some(panel) = Panel::EVERY.get(n) {
                    self.show(*panel);
                }
            }
            KeyCode::Up | KeyCode::Char('k') => self.step(-1),
            KeyCode::Down | KeyCode::Char('j') => self.step(1),
            KeyCode::PageUp => self.step(-page),
            KeyCode::PageDown => self.step(page),
            KeyCode::Home | KeyCode::Char('g') => self.step(isize::MIN),
            KeyCode::End | KeyCode::Char('G') => self.step(isize::MAX),
            KeyCode::Enter => self.open(),
            _ => {}
        }
        Vec::new()
    }

    fn type_search(&mut self, code: KeyCode) {
        match code {
            KeyCode::Esc => self.search = Search::default(),
            KeyCode::Enter => self.search.typing = false,
            KeyCode::Backspace => {
                self.search.query.pop();
            }
            KeyCode::Char(c) => self.search.query.push(c),
            _ => {}
        }
        if let Some(cursor) = self.cursors.get_mut(self.panel.position()) {
            *cursor = Cursor::default();
        }
    }

    /// Esc: out of a detail, then out of a zoomed Map, then clear a search.
    fn back(&mut self) {
        if self.opened.pop().is_some() {
            return;
        }
        if self.panel == Panel::Map && self.map.at != 0 {
            let parent = self
                .current()
                .and_then(|f| f.nodes().get(self.map.at))
                .and_then(|n| n.parent)
                .unwrap_or(0);
            let from = self.map.at;
            self.map.at = parent;
            // Select the directory just left, so Esc then Enter returns.
            let position = self
                .current()
                .and_then(|f| f.nodes().get(parent))
                .and_then(|n| n.children.iter().position(|&c| c == from))
                .unwrap_or(0);
            self.map.cursor = Cursor::default();
            self.map.cursor.step(position as isize, position + 1);
            return;
        }
        self.search = Search::default();
    }

    fn switch(&mut self, span: Span) -> Vec<Command> {
        self.span = span;
        self.opened.clear();
        self.ensure(span)
    }

    /// Starts computing a Window's findings, unless they are known, being
    /// computed, or waiting for older history.
    fn ensure(&mut self, span: Span) -> Vec<Command> {
        let window = span.window(self.anchor);
        let known = self.findings.get(slot(span)).is_some_and(Option::is_some);
        let busy = self.computing.get(slot(span)).copied().unwrap_or(false);
        if known || busy || !window.is_loaded(&self.index) {
            return Vec::new();
        }
        if let Some(busy) = self.computing.get_mut(slot(span)) {
            *busy = true;
        }
        vec![Command(Job::Compute {
            index: Arc::clone(&self.index),
            span,
            window,
            options: self.options,
        })]
    }

    fn show(&mut self, panel: Panel) {
        if panel != self.panel {
            self.search = Search::default();
        }
        self.panel = panel;
        self.opened.clear();
    }

    fn span_after(&self, step: isize) -> Span {
        let at = Span::EVERY
            .iter()
            .position(|s| *s == self.span)
            .unwrap_or(0) as isize;
        let next = (at + step).rem_euclid(Span::EVERY.len() as isize) as usize;
        Span::EVERY.get(next).copied().unwrap_or(self.span)
    }

    fn panel_after(&self, step: isize) -> Panel {
        let at = self.panel.position() as isize;
        let next = (at + step).rem_euclid(Panel::EVERY.len() as isize) as usize;
        Panel::EVERY.get(next).copied().unwrap_or(self.panel)
    }

    /// Moves the selection, or scrolls a detail that is text.
    fn step(&mut self, delta: isize) {
        let len = self.panel_len();
        match self.opened.last_mut() {
            Some(top) => match top.list_len() {
                Some(len) => top.cursor.step(delta, len),
                None => top.scroll = top.scroll.saturating_add_signed(delta),
            },
            None if self.panel == Panel::Map => self.map.cursor.step(delta, len),
            None => {
                if let Some(cursor) = self.cursors.get_mut(self.panel.position()) {
                    cursor.step(delta, len);
                }
            }
        }
    }

    fn panel_len(&self) -> usize {
        let Some(f) = self.current() else {
            return 0;
        };
        match self.panel {
            Panel::Overview => headlines(f).len(),
            Panel::Map => f.nodes().get(self.map.at).map_or(0, |n| n.children.len()),
            Panel::Activity | Panel::GitHub => 0,
            Panel::Age => f.staleness.buckets.len(),
            Panel::People | Panel::Hotspots | Panel::Coupling | Panel::Ownership => {
                self.rows(f).len()
            }
        }
    }

    /// The rows of a searchable Panel that match the search, as positions
    /// in its full list.
    pub(crate) fn rows(&self, f: &Findings) -> Vec<usize> {
        let query = self.search.query.to_lowercase();
        let matches = |text: &str| query.is_empty() || text.to_lowercase().contains(&query);
        let path = |file| self.index.paths.path_lossy(file);
        let person = |author| {
            self.index
                .authors
                .get(author)
                .map(|a| format!("{} {}", a.name, a.email))
                .unwrap_or_default()
        };
        let keep = |texts: Vec<String>| texts.iter().any(|t| matches(t));
        match self.panel {
            Panel::People => (0..f.contributors.len())
                .filter(|&i| {
                    f.contributors
                        .get(i)
                        .is_some_and(|c| keep(vec![person(c.author)]))
                })
                .collect(),
            Panel::Hotspots => (0..f.hotspots.len())
                .filter(|&i| f.hotspots.get(i).is_some_and(|h| keep(vec![path(h.file)])))
                .collect(),
            Panel::Coupling => (0..f.coupling.pairs.len())
                .filter(|&i| {
                    f.coupling
                        .pairs
                        .get(i)
                        .is_some_and(|p| keep(vec![path(p.first), path(p.second)]))
                })
                .collect(),
            Panel::Ownership => (0..f.ownership.directories.len())
                .filter(|&i| {
                    f.ownership.directories.get(i).is_some_and(|d| {
                        let owners = d.owners.iter().map(|o| person(o.author));
                        let label = crate::ui::folder(&d.label()).to_string();
                        keep(std::iter::once(label).chain(owners).collect())
                    })
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    fn open(&mut self) {
        let Some(findings) = self.current() else {
            return;
        };
        let entry = match self.opened.last() {
            Some(top) => top.target().map(Entry::Open),
            None => self.entry(findings),
        };
        let target = match entry {
            Some(Entry::Open(target)) => target,
            Some(Entry::Show(panel)) => {
                self.show(panel);
                return;
            }
            Some(Entry::Zoom(node)) => {
                self.map.at = node;
                self.map.cursor = Cursor::default();
                return;
            }
            None => return,
        };
        let Ok(analysis) = Analysis::new(&self.index, findings.window, self.options) else {
            return;
        };
        let opened = Opened::open(target, &analysis, findings);
        self.opened.push(opened);
    }

    fn entry(&self, f: &Findings) -> Option<Entry> {
        let i = self
            .cursors
            .get(self.panel.position())
            .map_or(0, |c| c.selected());
        let row = || self.rows(f).get(i).copied();
        let open = Entry::Open;
        match self.panel {
            Panel::Overview => match headlines(f).get(i)? {
                Headline::Directory(d) => f
                    .ownership
                    .directories
                    .get(*d)
                    .map(|d| open(Target::Directory(d.clone()))),
                Headline::Hotspot => f.hotspots.first().map(|h| open(Target::File(h.file))),
                Headline::Pair(p) => f.coupling.pairs.get(*p).map(|p| open(Target::Pair(*p))),
                Headline::Stale => Some(open(Target::Bucket(Age::Older))),
                Headline::People => Some(Entry::Show(Panel::People)),
            },
            Panel::Activity | Panel::GitHub => None,
            Panel::People => f
                .contributors
                .get(row()?)
                .map(|c| open(Target::Person(c.author))),
            Panel::Map => {
                let node = f.nodes().get(self.map.at)?;
                let child = *node.children.get(self.map.cursor.selected())?;
                let target = f.nodes().get(child)?;
                Some(match target.file {
                    Some(file) => open(Target::File(file)),
                    None => Entry::Zoom(child),
                })
            }
            Panel::Hotspots => f.hotspots.get(row()?).map(|h| open(Target::File(h.file))),
            Panel::Coupling => f.coupling.pairs.get(row()?).map(|p| open(Target::Pair(*p))),
            Panel::Ownership => f
                .ownership
                .directories
                .get(row()?)
                .map(|d| open(Target::Directory(d.clone()))),
            Panel::Age => Age::EVERY.get(i).map(|a| open(Target::Bucket(*a))),
        }
    }

    /// Why the Window's findings are not on screen yet.
    pub(crate) fn waiting(&self) -> String {
        let phrase = ui::phrase(self.span);
        if self.span.window(self.anchor).is_loaded(&self.index) {
            return format!("Computing the findings for {phrase}…");
        }
        match self.older {
            Older::Loading => format!("Reading the rest of history for {phrase}…"),
            Older::Unavailable | Older::Complete => format!(
                "The history {phrase} needs could not be read from the cache. \
                 Run commitscape again to rebuild it."
            ),
        }
    }
}

fn slot(span: Span) -> usize {
    Span::EVERY.iter().position(|s| *s == span).unwrap_or(0)
}

/// The eight people with the most commits over all of history get the
/// eight categorical colours, in that order.
/// The start of an email without a `+tag`, `dev` for `dev+git@x.org`, or
/// the login in GitHub's `12345+login@users.noreply.github.com`.
fn handle(email: &str) -> &str {
    let (local, domain) = email.split_once('@').unwrap_or((email, ""));
    if domain.eq_ignore_ascii_case("users.noreply.github.com") {
        local.rsplit('+').next().unwrap_or(local)
    } else {
        local.split('+').next().unwrap_or(local)
    }
}

fn colours(index: &Index) -> HashMap<AuthorId, Color> {
    let used = index.authors.used();
    let mut people: Vec<(u32, AuthorId)> = index
        .authors
        .iter()
        .map(|(id, a)| {
            let commits = a
                .signatures
                .iter()
                .map(|s| used.get(s.idx()).copied().unwrap_or(0))
                .sum();
            (commits, id)
        })
        .collect();
    people.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    people
        .into_iter()
        .zip(theme::SERIES)
        .map(|((_, id), colour)| (id, colour))
        .collect()
}
