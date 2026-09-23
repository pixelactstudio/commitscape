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

use commitscape_core::Index;
use commitscape_forge::GitHub;
use commitscape_metrics::{Options, Span};

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
