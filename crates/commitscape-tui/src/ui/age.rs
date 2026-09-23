//! Age: how long since each file was touched, and when the code was
//! written.

use commitscape_core::civil_from_unix;
use commitscape_metrics::QuarterAge;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, clip, faint, fit, highlight, plain, split_path};
use crate::app::App;
use crate::format::{compact, grouped, share, short_date, span_of_days};
use crate::list::Cursor;
use crate::theme::{ACCENT, BLUES, MUTED};

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let [top, bottom] = Layout::vertical([Constraint::Length(9), Constraint::Fill(1)]).areas(area);
    let [touched, written] =
        Layout::horizontal([Constraint::Percentage(45), Constraint::Percentage(55)]).areas(top);

    // Last touched, by bucket: the longer ago, the lighter the bar.
    let total = u64::from(f.files());
    let inner = boxed(
        frame,
        touched,
        "Last touched",
        Some("enter for the files".to_string()),
    );
    let buckets = &f.staleness.buckets;
    cursor.step(0, buckets.len());
    let most = buckets
        .iter()
        .map(|b| u64::from(b.files))
        .max()
        .unwrap_or(0);
    let bar_width = inner.width.saturating_sub(30).max(4);
    let lines: Vec<Line> = buckets
        .iter()
        .zip(BLUES.iter().cycle())
        .map(|(b, colour)| {
            Line::from(vec![
                plain(format!(" {:<16}", b.age.label())),
                Span::styled(
                    format!(
                        "{:<width$}",
                        charts::bar(u64::from(b.files), most, bar_width),
                        width = usize::from(bar_width)
                    ),
                    Style::new().fg(*colour),
                ),
                bold(format!(" {:>5}", grouped(u64::from(b.files)))),
                faint(format!(" {:>4}", share(u64::from(b.files), total))),
            ])
        })
        .collect();
    let first_row = Rect {
        y: inner.y + 1,
        height: inner.height.saturating_sub(1),
        ..inner
    };
    frame.render_widget(
        Paragraph::new(super::fit_line(
            Line::from(faint(format!(
                " {} files people wrote, by their last commit",
                grouped(total)
            ))),
            usize::from(inner.width),
        )),
        Rect { height: 1, ..inner },
    );
    frame.render_widget(Paragraph::new(lines), first_row);
    highlight(frame, first_row, first_row.y + cursor.selected() as u16);

    // Code by when it was written: one column per quarter, from the first
    // to this one, empty quarters included so the time runs evenly.
    let inner = boxed(frame, written, "When the code was written", None);
    let quarters = every_quarter(&f.code_age, app.anchor);
    if quarters.is_empty() {
        super::empty(frame, inner, "There is no code at HEAD.");
    } else {
        let values: Vec<u64> = quarters.iter().map(|q| q.2).collect();
        let most = values.iter().copied().max().unwrap_or(0);
        frame.render_widget(
            Paragraph::new(super::fit_line(
                Line::from(vec![
                    faint("lines by the quarter their file appeared · tallest "),
                    bold(compact(most)),
                ]),
                usize::from(inner.width),
            )),
            Rect { height: 1, ..inner },
        );
        charts::columns(
            frame.buffer_mut(),
            Rect {
                y: inner.y + 1,
                height: inner.height.saturating_sub(1),
                ..inner
            },
            &values,
            ACCENT,
            |i| {
                let q = quarters.get(i)?;
                (i == 0 || q.1 == 1).then(|| q.0.to_string())
            },
        );
    }

    // The files untouched the longest.
    let inner = boxed(frame, bottom, "Untouched the longest", None);
    let width = usize::from(inner.width);
    let name_width = (width / 5).clamp(12, 28);
    let dir_width = (width / 5).clamp(10, 28);
    let bar_width = width
        .saturating_sub(name_width + dir_width + 44)
        .clamp(6, 20);
    let oldest = f
        .staleness
        .files
        .first()
        .map_or(0, |s| s.days.max(0) as u64);
    let lines: Vec<Line> = f
        .staleness
        .files
        .iter()
        .take(usize::from(inner.height))
        .map(|s| {
            let path = app.index.paths.path_lossy(s.file);
            let (dir, name) = split_path(&path);
            super::fit_line(
                Line::from(vec![
                    Span::raw(" "),
                    bold(format!("{:<name_width$}", clip(name, name_width))),
                    Span::styled(
                        format!(" {:<dir_width$}", fit(super::home(dir), dir_width)),
                        Style::new().fg(MUTED),
                    ),
                    Span::styled(
                        format!(
                            " {:<bar_width$}",
                            charts::bar(s.days.max(0) as u64, oldest, bar_width as u16)
                        ),
                        Style::new().fg(BLUES[2]),
                    ),
                    plain(format!(" {}", span_of_days(s.days))),
                    faint(format!(", since {}", short_date(s.last_touched))),
                ]),
                width,
            )
        })
        .collect();
    frame.render_widget(Paragraph::new(lines), inner);
}

/// Every quarter from the first with code to the one `anchor` falls in, as
/// (year, quarter, lines), with no lines where no code appeared.
fn every_quarter(quarters: &[QuarterAge], anchor: i64) -> Vec<(i64, u32, u64)> {
    let Some(first) = quarters.first() else {
        return Vec::new();
    };
    let (year, month, _) = civil_from_unix(anchor);
    let now = (year, (month - 1) / 3 + 1);
    let last = quarters
        .last()
        .map_or(now, |q| (q.year, q.quarter))
        .max(now);
    let mut out = Vec::new();
    let mut at = (first.year, first.quarter);
    while at <= last {
        let lines = quarters
            .iter()
            .find(|q| (q.year, q.quarter) == at)
            .map_or(0, |q| q.lines);
        out.push((at.0, at.1, lines));
        at = if at.1 == 4 {
            (at.0 + 1, 1)
        } else {
            (at.0, at.1 + 1)
        };
    }
    out
}
