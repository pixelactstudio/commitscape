//! The Window every Panel is computed over.

use commitscape_core::Index;
use serde::Serialize;

const DAY: i64 = 86_400;

/// A range of commit times, both ends included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Window {
    /// The earliest commit time counted; `None` for all of history.
    pub from: Option<i64>,
    /// The anchor: the latest commit time counted.
    pub to: i64,
}

impl Window {
    /// The `days` before `anchor`.
    pub fn last(days: u32, anchor: i64) -> Window {
        Window {
            from: Some(anchor - days as i64 * DAY),
            to: anchor,
        }
    }

    /// All of history up to `anchor`.
    pub fn all(anchor: i64) -> Window {
        Window {
            from: None,
            to: anchor,
        }
    }

    pub fn contains(&self, time: i64) -> bool {
        self.from.is_none_or(|f| f <= time) && time <= self.to
    }

    /// Whether an index holds every commit this Window reaches back to. A
    /// time-sliced load may not, until the rest of its history is read.
    pub fn is_loaded(&self, index: &Index) -> bool {
        match self.from {
            Some(from) => index.covers(from),
            None => index.loaded_from.is_none(),
        }
    }
}

/// The fixed set of spans a Window can take. Serialised as its label, the
/// value `--window` takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Span {
    #[serde(rename = "30d")]
    Month,
    #[serde(rename = "90d")]
    Quarter,
    #[serde(rename = "1y")]
    Year,
    #[serde(rename = "all")]
    All,
}

impl Span {
    /// Every span, shortest first.
    pub const EVERY: [Span; 4] = [Span::Month, Span::Quarter, Span::Year, Span::All];

    pub fn days(self) -> Option<u32> {
        match self {
            Span::Month => Some(30),
            Span::Quarter => Some(90),
            Span::Year => Some(365),
            Span::All => None,
        }
    }

    /// A short label for the interface: `30d`, `90d`, `1y`, `all`.
    pub fn label(self) -> &'static str {
        match self {
            Span::Month => "30d",
            Span::Quarter => "90d",
            Span::Year => "1y",
            Span::All => "all",
        }
    }

    /// Parses a label, as a command-line flag gives it.
    pub fn from_label(label: &str) -> Option<Span> {
        Span::EVERY.into_iter().find(|s| s.label() == label)
    }

    /// This span, ending at `anchor`.
    pub fn window(self, anchor: i64) -> Window {
        match self.days() {
            Some(days) => Window::last(days, anchor),
            None => Window::all(anchor),
        }
    }
}
