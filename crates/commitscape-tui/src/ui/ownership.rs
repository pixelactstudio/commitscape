//! Ownership: who made the commits under each folder, and how few people
//! it rests on.

use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, clip, faint, fit, highlight, plain, short_phrase, visible};
use crate::app::App;
use crate::format::{grouped, share};
use crate::list::Cursor;
use crate::theme::{CRITICAL, GOOD, WARNING};

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let own = &f.ownership;
    let list_area = super::intro(
        frame,
        area,
        vec![Line::from(vec![
            plain("Who made the commits under each folder. The bus factor is the fewest people who together made more than 80% of them: "),
            Span::styled("▲ 1", Style::new().fg(CRITICAL)),
            plain(" means one person leaving would take most of what anyone knows about it."),
        ])],
    );
    let rows = app.rows(f);
    let inner = boxed(
        frame,
        list_area,
        "Ownership",
        Some(format!(
            "{} of {} folders rest on one person · {} or more commits in {}",
            grouped(u64::from(own.bus_factor_one)),
            grouped(u64::from(own.directory_count)),
            app.options.ownership_min_commits,
            short_phrase(app.span)
        )),
    );
    if rows.is_empty() {
        super::empty(
            frame,
            inner,
            if app.search.query.is_empty() {
                "No folder had enough commits in this window."
            } else {
                "No folder matches the search."
            },
        );
        return;
    }
    let dir_width = usize::from(inner.width / 3).clamp(14, 40);
    let bar_width = inner
        .width
        .saturating_sub(dir_width as u16 + 56)
        .clamp(10, 40);
    let (shown, at) = visible(cursor, rows.len(), usize::from(inner.height));
    let mut lines = Vec::new();
    for &i in rows.get(shown.clone()).unwrap_or_default() {
        let Some(d) = own.directories.get(i) else {
            continue;
        };
        let parts: Vec<(u64, Color)> = d
            .owners
            .iter()
            .map(|o| (u64::from(o.commits), app.colour_of(o.author)))
            .collect();
        let top = d.owners.first();
        let who = top.map(|o| app.display_name(o.author)).unwrap_or_default();
        let (badge, colour) = match d.bus_factor {
            1 => ("▲ 1 person ".to_string(), CRITICAL),
            2 => ("● 2 people ".to_string(), WARNING),
            n => (format!("● {n} people "), GOOD),
        };
        let mut spans = vec![
            Span::raw(" "),
            bold(format!(
                "{:<width$}",
                fit(super::folder(&d.label()), dir_width),
                width = dir_width
            )),
            Span::raw(" "),
        ];
        let mut bar = charts::stacked(&parts, bar_width).spans;
        let drawn: usize = bar.iter().map(|s| s.content.chars().count()).sum();
        spans.append(&mut bar);
        spans.push(Span::raw(
            " ".repeat(usize::from(bar_width).saturating_sub(drawn)),
        ));
        spans.push(Span::styled(
            format!("  {badge:<12}"),
            Style::new().fg(colour),
        ));
        spans.push(plain(format!("{:<24}", clip(&who, 24))));
        spans.push(faint(format!(
            " {:>4} of {}",
            share(
                top.map_or(0, |o| u64::from(o.commits)),
                u64::from(d.commits)
            ),
            grouped(u64::from(d.commits))
        )));
        lines.push(super::fit_line(Line::from(spans), usize::from(inner.width)));
    }
    frame.render_widget(Paragraph::new(lines), inner);
    highlight(frame, inner, inner.y + at as u16);
    super::clickable_rows(app, inner, shown, 1);
}
