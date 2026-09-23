//! The Card: a repository's story on one image, to share. The Overview's
//! picture of a Window, at a fixed size, framed and signed.

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType};
use ratatui::Frame;

use super::{charts, overview, phrase};
use crate::app::App;
use crate::theme::{self, ACCENT, LINE, SURFACE};

/// The card's size in cells: 1,080 by 684 pixels as SVG.
pub(crate) const WIDTH: u16 = 120;
pub(crate) const HEIGHT: u16 = 36;

pub(crate) fn draw(app: &App, frame: &mut Frame) {
    let area = frame.area();
    frame.render_widget(Block::new().style(Style::new().bg(SURFACE)), area);
    let Some(f) = app.current() else {
        return;
    };
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(LINE))
        .title_bottom(
            Line::from(vec![
                Span::styled(
                    format!(" {} · made with ", phrase(app.span)),
                    theme::muted(),
                ),
                Span::styled("commitscape ", Style::new().fg(ACCENT)),
            ])
            .right_aligned(),
        );
    let inner = block.inner(area);
    frame.render_widget(block, area);
    // A margin inside the frame.
    let inner = Rect {
        x: inner.x + 2,
        y: inner.y + 1,
        width: inner.width.saturating_sub(4),
        height: inner.height.saturating_sub(1),
    };
    let big = charts::big_text(&app.name)
        .filter(|rows| rows[0].chars().count() + 34 <= usize::from(inner.width));
    let hero_height = if big.is_some() { 5 } else { 2 };
    let [hero, tiles, languages, middle, facts] = Layout::vertical([
        Constraint::Length(hero_height),
        Constraint::Length(5),
        Constraint::Length(3),
        Constraint::Fill(1),
        Constraint::Length(6),
    ])
    .areas(inner);
    overview::draw_hero(app, f, frame, hero, big);
    overview::draw_tiles(app, f, frame, tiles);
    overview::draw_languages(f, frame, languages);
    let [activity, people] =
        Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(middle);
    overview::draw_activity(app, f, frame, activity);
    overview::draw_people(app, f, frame, people);
    overview::draw_facts(app, f, frame, facts, 2);
}
