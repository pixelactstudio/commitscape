//! The terminal interface: Panels over an Index, one Window at a time.
//!
//! [`App`] is the interface without a terminal. Key presses and finished
//! work go in as [`Event`]s; work for another thread comes out as
//! [`Command`]s, and running a command gives the Event to feed back. It
//! draws a frame from its state alone. [`run`] puts it in a terminal.

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
pub use theme::truecolor;

/// Completes an index with the history it does not hold yet. Called once,
/// off the main thread, after the first frame. `None` when that history
/// could not be read.
pub type LoadOlder = Box<dyn FnOnce(&Index) -> Option<Index> + Send>;

/// Asks GitHub about the repository. Called once, off the main thread,
/// after the first frame. The error says why there is nothing to show.
pub type LoadGitHub = Box<dyn FnOnce() -> Result<GitHub, String> + Send>;

/// A change to who is who, asked for from a person's profile (ADR-0011).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeopleChange {
    /// Split a merged person back into the identities they were joined from.
    Undo(AuthorId),
    /// Join again the identities an undo split.
    Redo(AuthorId),
}

/// Makes a [`PeopleChange`] and returns everyone re-resolved, or `None`
/// when it could not be made. Keeps the change where the next run finds it.
pub type ChangePeople =
    std::sync::Arc<dyn Fn(&AuthorTable, PeopleChange) -> Option<AuthorTable> + Send + Sync>;

/// Asks GitHub which accounts the index's commits belong to, and returns
/// everyone re-resolved when that joined anyone. Called once, off the main
/// thread, with all of history.
pub type LinkAccounts = Box<dyn FnOnce(&Index) -> Option<AuthorTable> + Send>;

/// Counts the lines of every change the index holds (ADR-0012). Called
/// once, off the main thread, with all of history. `None` when they could
/// not be counted.
pub type CountLines = Box<dyn FnOnce(&Index) -> Option<LinePass> + Send>;

/// What the interface opens on.
pub struct Session {
    /// The repository's name, for the header.
    pub name: String,
    pub index: Index,
    /// Where every Window ends: the present moment, when someone is looking.
    pub anchor: i64,
    /// The Window shown first. The index must reach back at least this far
    /// for the first frame to show findings.
    pub span: Span,
    pub options: Options,
    /// How to read the history `index` does not hold, when it holds only a
    /// recent slice.
    pub older: Option<LoadOlder>,
    /// How to ask GitHub about the repository, or why it will not be asked.
    pub github: Result<LoadGitHub, String>,
    /// How to undo a merge of identities, if it can be kept anywhere.
    pub people: Option<ChangePeople>,
    /// How to link commits to GitHub accounts, if GitHub can be asked.
    pub link_accounts: Option<LinkAccounts>,
    /// How to count lines, if they can be kept.
    pub lines: Option<CountLines>,
}

/// A repository's story on one card, to share: the Overview's picture of
/// the session's Window, framed and signed, 120 by 36 cells. The work the
/// interface would start after its first frame, asking GitHub among it, is
/// done first. [`svg`] makes the card an image.
pub fn card(session: Session) -> Buffer {
    let (mut app, mut work) = App::new(session);
    while let Some(command) = work.pop() {
        work.extend(app.update(command.run()));
    }
    let Ok(mut terminal) = Terminal::new(TestBackend::new(ui::card::WIDTH, ui::card::HEIGHT));
    let Ok(_) = terminal.draw(|frame| ui::card::draw(&app, frame));
    terminal.backend().buffer().clone()
}

/// Opens the interface in the terminal and runs it until the user quits.
pub fn run(session: Session) -> io::Result<()> {
    in_terminal(session, false)
}

/// Draws the first frame, then restores the terminal and returns: what the
/// first-paint benchmark times.
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
    // Clicks and the wheel. Holding Shift still selects text in most
    // terminals.
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
            // Take whatever else has arrived, so a burst of key repeats is
            // drawn once.
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

/// Forwards terminal events until the interface stops listening.
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
