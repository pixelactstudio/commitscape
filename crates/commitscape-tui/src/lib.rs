mod app;
mod detail;
mod export;
mod findings;
pub mod format;
mod list;
mod theme;
mod ui;

use std::io;
use std::sync::mpsc::{self, Sender};

use commitscape_core::{AuthorId, AuthorTable, Index, LinePass};
use commitscape_forge::GitHub;
use commitscape_metrics::{Options, Span};
use ratatui::backend::TestBackend;
use ratatui::buffer::Buffer;
use ratatui::Terminal;

pub use app::{App, Command, Event};

pub use export::svg;
pub use theme::{truecolor, Theme};

pub type LoadOlder = Box<dyn FnOnce(&Index) -> Option<Index> + Send>;

pub type LoadGitHub = Box<dyn FnOnce() -> Result<GitHub, String> + Send>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeopleChange {
    Undo(AuthorId),
    Redo(AuthorId),
}

pub type ChangePeople =
    std::sync::Arc<dyn Fn(&AuthorTable, PeopleChange) -> Option<AuthorTable> + Send + Sync>;

pub type LinkAccounts = Box<dyn FnOnce(&Index) -> Option<AuthorTable> + Send>;

pub type CountLines = Box<dyn FnOnce(&Index) -> Option<LinePass> + Send>;

pub type LoadReleases = Box<dyn FnOnce() -> Vec<(String, i64)> + Send>;

pub struct Session {
    pub name: String,
    pub index: Index,
    pub anchor: i64,
    pub span: Span,
    pub options: Options,
    pub older: Option<LoadOlder>,
    pub github: Result<LoadGitHub, String>,
    pub people: Option<ChangePeople>,
    pub link_accounts: Option<LinkAccounts>,
    pub lines: Option<CountLines>,
    pub releases: Option<LoadReleases>,
    pub theme: Theme,
}

/// Draws a repository's card.
pub fn card(session: Session) -> Buffer {
    let (mut app, mut work) = App::new(session);
    while let Some(command) = work.pop() {
        work.extend(app.update(command.run()));
    }
    let Ok(mut terminal) = Terminal::new(TestBackend::new(ui::card::WIDTH, ui::card::HEIGHT));
    let Ok(_) = terminal.draw(|frame| ui::card::draw(&app, frame));
    terminal.backend().buffer().clone()
}

/// Runs the terminal interface until the person quits.
pub fn run(session: Session) -> io::Result<()> {
    in_terminal(session, false)
}

pub fn paint_once(session: Session) -> io::Result<()> {
    in_terminal(session, true)
}

fn in_terminal(session: Session, once: bool) -> io::Result<()> {
    let (mut app, commands) = App::new(session);
    let truecolor = theme::truecolor();
    let draw = move |app: &mut App, frame: &mut ratatui::Frame| {
        app.draw(frame);
        if !truecolor {
            theme::fit_to_terminal(frame.buffer_mut());
        }
    };
    let mut terminal = ratatui::try_init()?;
    let _ =
        ratatui::crossterm::execute!(io::stdout(), ratatui::crossterm::event::EnableMouseCapture);
    let result = (|| {
        terminal.draw(|frame| draw(&mut app, frame))?;
        if once {
            return Ok(());
        }
        let (tx, rx) = mpsc::channel();
        read_terminal(tx.clone());
        for command in commands {
            spawn(command, &tx);
        }
        while let Ok(event) = rx.recv() {
            for command in app.update(event) {
                spawn(command, &tx);
            }
            while let Ok(event) = rx.try_recv() {
                for command in app.update(event) {
                    spawn(command, &tx);
                }
            }
            if app.done() {
                break;
            }
            terminal.draw(|frame| draw(&mut app, frame))?;
        }
        Ok(())
    })();
    let _ =
        ratatui::crossterm::execute!(io::stdout(), ratatui::crossterm::event::DisableMouseCapture);
    ratatui::restore();
    result
}

fn spawn(command: Command, tx: &Sender<Event>) {
    let tx = tx.clone();
    std::thread::spawn(move || {
        let _ = tx.send(command.run());
    });
}

fn read_terminal(tx: Sender<Event>) {
    std::thread::spawn(move || {
        while let Ok(event) = ratatui::crossterm::event::read() {
            if let Some(event) = Event::from_terminal(event) {
                if tx.send(event).is_err() {
                    break;
                }
            }
        }
    });
}
