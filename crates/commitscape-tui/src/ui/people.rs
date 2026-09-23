//! People: who made the Window's commits, each in the colour they keep on
//! every screen.

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, clip, dot, faint, highlight, plain, short_phrase, visible};
use crate::app::App;
use crate::format::{ago, grouped, share};
use crate::list::Cursor;

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let groups = f.duplicates.len();
    let hint_height = if groups > 0 { 5 } else { 0 };
    let [list_area, hint_area] =
        Layout::vertical([Constraint::Fill(1), Constraint::Length(hint_height)]).areas(area);

    let rows = app.rows(f);
    let total: u64 = f.contributors.iter().map(|c| u64::from(c.commits)).sum();
    let inner = boxed(
        frame,
        list_area,
        "People",
        Some(format!(
            "{} committed in {} · enter for a profile",
            grouped(f.contributors.len() as u64),
            short_phrase(app.span)
        )),
    );
    if rows.is_empty() {
        super::empty(
            frame,
            inner,
            if app.search.query.is_empty() {
                "Nobody committed in this window."
            } else {
                "Nobody matches the search."
            },
        );
        return;
    }
    let most = f.contributors.first().map_or(0, |c| u64::from(c.commits));
    let name_width = 30usize;
    let fixed = 3 + 2 + name_width + 1 + 7 + 6 + 11 + 12 + 10;
    let bar_width = inner.width.saturating_sub(fixed as u16).clamp(4, 40);

    // Each heading as wide as the values under it.
    let header = Line::from(vec![faint(format!(
        "{:>3}  {:<nw$} {:<bw$}{:>7}{:>6}{:>11}{:>12}{:>10}",
        "#",
        "person",
        "",
        "commits",
        "share",
        "active",
        "last commit",
        "AI help",
        nw = name_width,
        bw = usize::from(bar_width),
    ))]);
    frame.render_widget(Paragraph::new(header), Rect { height: 1, ..inner });
    let body = Rect {
        y: inner.y + 1,
        height: inner.height.saturating_sub(1),
        ..inner
    };
    let (shown, at) = visible(cursor, rows.len(), usize::from(body.height));
    let lines: Vec<Line> = rows
        .get(shown.clone())
        .unwrap_or_default()
        .iter()
        .filter_map(|&i| f.contributors.get(i).map(|c| (i, c)))
        .map(|(i, c)| {
            let name = app.display_name(c.author);
            let colour = app.colour_of(c.author);
            let last = (app.anchor - c.last).div_euclid(86_400);
            Line::from(vec![
                faint(format!("{:>3}  ", i + 1)),
                dot(colour),
                bold(format!(
                    "{:<width$}",
                    clip(&name, name_width - 2),
                    width = name_width - 2
                )),
                Span::raw(" "),
                Span::styled(
                    format!(
                        "{:<width$}",
                        charts::bar(u64::from(c.commits), most, bar_width),
                        width = usize::from(bar_width)
                    ),
                    Style::new().fg(colour),
                ),
                bold(format!(" {:>6}", grouped(u64::from(c.commits)))),
                faint(format!(" {:>5}", share(u64::from(c.commits), total))),
                plain(format!(" {:>5} days", grouped(u64::from(c.active_days)))),
                plain(format!(" {:>11}", ago(last))),
                if c.agent > 0 {
                    plain(format!(
                        " {:>9}",
                        share(u64::from(c.agent), u64::from(c.commits))
                    ))
                } else {
                    faint(format!(" {:>9}", "none"))
                },
            ])
        })
        .collect();
    frame.render_widget(Paragraph::new(lines), body);
    highlight(frame, body, body.y + at as u16);

    if groups > 0 {
        let inner = boxed(
            frame,
            hint_area,
            "Same person?",
            Some("open one of them to see how to join them".to_string()),
        );
        let mut lines = vec![Line::from(vec![
            bold(grouped(groups as u64)),
            plain(if groups == 1 {
                " pair of identities shares a name or an email name. Nothing was merged:"
            } else {
                " groups of identities share a name or an email name. Nothing was merged:"
            }),
        ])];
        for g in f
            .duplicates
            .iter()
            .take(usize::from(inner.height.saturating_sub(1)))
        {
            let mut spans = vec![Span::raw("  ")];
            for (k, p) in g.people.iter().enumerate() {
                if k > 0 {
                    spans.push(faint("  ·  "));
                }
                if let Some(a) = app.index.authors.get(*p) {
                    spans.push(dot(app.colour_of(*p)));
                    spans.push(plain(a.name.to_string()));
                    spans.push(faint(format!(" <{}>", a.email)));
                }
            }
            lines.push(super::fit_line(Line::from(spans), usize::from(inner.width)));
        }
        frame.render_widget(Paragraph::new(lines), inner);
    }
}
