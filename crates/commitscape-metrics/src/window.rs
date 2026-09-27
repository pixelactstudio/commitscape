use commitscape_core::Index;
use serde::Serialize;

const DAY: i64 = 86_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Window {
    pub from: Option<i64>,
    pub to: i64,
}

impl Window {
    pub fn last(days: u32, anchor: i64) -> Window {
        Window {
            from: Some(anchor - days as i64 * DAY),
            to: anchor,
        }
    }

    pub fn all(anchor: i64) -> Window {
        Window {
            from: None,
            to: anchor,
        }
    }

    pub fn contains(&self, time: i64) -> bool {
        self.from.is_none_or(|f| f <= time) && time <= self.to
    }

    pub fn is_loaded(&self, index: &Index) -> bool {
        match self.from {
            Some(from) => index.covers(from),
            None => index.loaded_from.is_none(),
        }
    }
}

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
    pub const EVERY: [Span; 4] = [Span::Month, Span::Quarter, Span::Year, Span::All];

    pub fn days(self) -> Option<u32> {
        match self {
            Span::Month => Some(30),
            Span::Quarter => Some(90),
            Span::Year => Some(365),
            Span::All => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Span::Month => "30d",
            Span::Quarter => "90d",
            Span::Year => "1y",
            Span::All => "all",
        }
    }

    pub fn from_label(label: &str) -> Option<Span> {
        Span::EVERY.into_iter().find(|s| s.label() == label)
    }

    pub fn window(self, anchor: i64) -> Window {
        match self.days() {
            Some(days) => Window::last(days, anchor),
            None => Window::all(anchor),
        }
    }
}
