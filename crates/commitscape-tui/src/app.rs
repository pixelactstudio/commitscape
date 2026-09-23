//! The interface as a state machine: events in, commands out, and a frame
//! drawn from the state alone.

use std::sync::Arc;

use commitscape_core::Index;
use commitscape_metrics::{Age, Analysis, Options, Span, Window};
use ratatui::crossterm::event::{
    Event as TerminalEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
};
use ratatui::layout::{Constraint, Layout};
use ratatui::Frame;

use crate::detail::{Opened, Target};
use crate::draw;
use crate::findings::Findings;
use crate::list::Cursor;
use crate::{LoadOlder, Session};

/// The Panels, in tab order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Panel {
    Overview,
    Hotspots,
    Coupling,
    Ownership,
    Staleness,
    CodeAge,
    People,
}

impl Panel {
    pub const EVERY: [Panel; 7] = [
        Panel::Overview,
        Panel::Hotspots,
        Panel::Coupling,
        Panel::Ownership,
        Panel::Staleness,
        Panel::CodeAge,
        Panel::People,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Panel::Overview => "Overview",
            Panel::Hotspots => "Hotspots",
            Panel::Coupling => "Coupling",
            Panel::Ownership => "Ownership",
            Panel::Staleness => "Staleness",
            Panel::CodeAge => "Code Age",
            Panel::People => "People",
        }
    }

    pub fn position(self) -> usize {
        Panel::EVERY.iter().position(|p| *p == self).unwrap_or(0)
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
pub(crate) const HELD_DIRECTORIES: usize = 5;

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

/// What Enter does from a Panel.
enum Entry {
    Open(Target),
    Show(Panel),
}

pub struct App {
    name: String,
    index: Arc<Index>,
    anchor: i64,
    options: Options,
    span: Span,
    panel: Panel,
    /// By position in [`Span::EVERY`].
    findings: [Option<Box<Findings>>; 4],
    computing: [bool; 4],
    older: Older,
    /// By position in [`Panel::EVERY`].
    cursors: [Cursor; 7],
    /// Details entered, innermost last.
    opened: Vec<Opened>,
    /// Rows a page key moves: what the last frame could show.
    page: usize,
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
        } = session;
        let older_state = match (&older, index.loaded_from) {
            (_, None) => Older::Complete,
            (Some(_), Some(_)) => Older::Loading,
            (None, Some(_)) => Older::Unavailable,
        };
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
            cursors: [Cursor::default(); 7],
            opened: Vec::new(),
            page: 10,
            done: false,
        };
        if let Ok(analysis) = Analysis::new(&app.index, span.window(anchor), options) {
            if let Some(slot) = app.findings.get_mut(slot(span)) {
                *slot = Some(Box::new(Findings::of(&analysis)));
            }
        }
        let commands = match older {
            Some(load) if older_state == Older::Loading => vec![Command(Job::Older {
                index: Arc::clone(&app.index),
                load,
            })],
            _ => Vec::new(),
        };
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
        }
    }

    pub fn draw(&mut self, frame: &mut Frame) {
        let [header, tabs, body, footer] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Fill(1),
            Constraint::Length(1),
        ])
        .areas(frame.area());
        // A table's rows: the body less its borders and header row.
        self.page = usize::from(body.height.saturating_sub(3)).max(1);
        let waiting = self.waiting();
        let context = draw::Context {
            index: &self.index,
            span: self.span,
            anchor: self.anchor,
            options: self.options,
        };
        let findings = self
            .findings
            .get(slot(self.span))
            .and_then(|f| f.as_deref());
        draw::header(frame, header, &self.name, &context, findings);
        draw::tabs(frame, tabs, self.panel);
        match (findings, self.opened.last_mut()) {
            (Some(_), Some(opened)) => draw::detail(frame, body, opened, &context),
            (Some(f), None) => {
                let mut fallback = Cursor::default();
                let cursor = self
                    .cursors
                    .get_mut(self.panel.position())
                    .unwrap_or(&mut fallback);
                draw::panel(frame, body, self.panel, f, &context, cursor);
            }
            (None, _) => draw::waiting(frame, body, &waiting),
        }
        draw::footer(frame, footer, self.span, !self.opened.is_empty());
    }

    fn key(&mut self, key: KeyEvent) -> Vec<Command> {
        if key.kind == KeyEventKind::Release {
            return Vec::new();
        }
        let page = self.page as isize;
        match key.code {
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => self.done = true,
            KeyCode::Char('q') => self.done = true,
            KeyCode::Esc | KeyCode::Backspace => {
                self.opened.pop();
            }
            KeyCode::Char('w') => return self.switch(self.span_after(1)),
            KeyCode::Char('W') => return self.switch(self.span_after(-1)),
            KeyCode::Tab | KeyCode::Right | KeyCode::Char('l') => self.show(self.panel_after(1)),
            KeyCode::BackTab | KeyCode::Left | KeyCode::Char('h') => {
                self.show(self.panel_after(-1))
            }
            KeyCode::Char(c @ '1'..='7') => {
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
            Panel::Hotspots => f.hotspots.len(),
            Panel::Coupling => f.coupling.pairs.len(),
            Panel::Ownership => f.ownership.directories.len(),
            Panel::Staleness => Age::EVERY.len(),
            Panel::CodeAge => f.code_age.len(),
            Panel::People => f.duplicates.len(),
        }
    }

    fn current(&self) -> Option<&Findings> {
        self.findings
            .get(slot(self.span))
            .and_then(|f| f.as_deref())
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
            Panel::Hotspots => f.hotspots.get(i).map(|h| open(Target::File(h.file))),
            Panel::Coupling => f.coupling.pairs.get(i).map(|p| open(Target::Pair(*p))),
            Panel::Ownership => f
                .ownership
                .directories
                .get(i)
                .map(|d| open(Target::Directory(d.clone()))),
            Panel::Staleness => Age::EVERY.get(i).map(|a| open(Target::Bucket(*a))),
            Panel::CodeAge => f.code_age.get(i).map(|q| open(Target::Quarter(*q))),
            Panel::People => f.duplicates.get(i).map(|g| open(Target::Group(g.clone()))),
        }
    }

    /// Why the Window's findings are not on screen yet.
    fn waiting(&self) -> String {
        let phrase = draw::phrase(self.span);
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
