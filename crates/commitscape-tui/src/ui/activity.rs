//! Activity: when the work happens, on each author's own clock.

use commitscape_core::{civil_from_unix, CommitKind};
use commitscape_metrics::{Pulse, Span as Window};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, faint, many, plain, short_phrase};
use crate::app::App;
use crate::format::{grouped, hour, month_name, share, short_date, weekday_name};
use crate::theme::{ACCENT, MUTED};

const DAY: i64 = 86_400;

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect) {
    let Some(f) = app.current() else {
        return;
    };
    let p = &f.pulse;
    // The grids need ten rows; the kinds of work as many as there are,
    // and at least the five of the rhythm; the chart of commits the rest.
    let kinds = p
        .kinds
        .iter()
        .filter(|k| k.commits > 0 && k.kind != CommitKind::Other)
        .count() as u16;
    let lists = (kinds.max(5) + 3)
        .min(area.height.saturating_sub(17))
        .max(5);
    let [top, middle, bottom] = Layout::vertical([
        Constraint::Min(7),
        Constraint::Length(GRID_HEIGHT),
        Constraint::Length(lists),
    ])
    .areas(area);

    let inner = boxed(
        frame,
        top,
        "Commits over time",
        Some(format!(
            "{} on {} in {}",
            grouped(u64::from(p.commits)),
            many(u64::from(p.active_days), "active day", "active days"),
            short_phrase(app.span)
        )),
    );
    if p.commits == 0 {
        super::empty(frame, inner, "No commits in this window.");
    } else {
        let (values, per) = charts::bucket(&p.days, usize::from(inner.width));
        let most = values.iter().copied().max().unwrap_or(0);
        frame.render_widget(
            Paragraph::new(caption(per, most)),
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
            charts::month_labels(p.first_day, per),
        );
    }

    let [calendar, week] =
        Layout::horizontal([Constraint::Fill(1), Constraint::Length(56)]).areas(middle);
    if app.span == Window::All {
        draw_years(p, frame, calendar);
    } else {
        draw_calendar(p, frame, calendar);
    }
    draw_week(p, frame, week);

    let [kinds, rhythm] =
        Layout::horizontal([Constraint::Fill(1), Constraint::Fill(1)]).areas(bottom);
    draw_kinds(p, frame, kinds);
    draw_rhythm(p, frame, rhythm);
}

/// What a column of commits over time stands for: `each bar is 7 days,
/// the tallest 23 commits`.
pub(super) fn caption(per: usize, most: u64) -> Line<'static> {
    Line::from(vec![
        faint(if per == 1 {
            "each bar is a day, the tallest ".to_string()
        } else {
            format!("each bar is {per} days, the tallest ")
        }),
        bold(many(most, "commit", "commits")),
    ])
}

/// The height of a week-by-day grid in its box: a row of labels over seven
/// days, and the borders.
pub(super) const GRID_HEIGHT: u16 = 10;

/// A section for a heat grid, its key in the bottom border and, on the
/// left of it, `caption`.
fn grid_section(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    note: &str,
    caption: Option<Line<'static>>,
) -> Rect {
    let mut block = super::section(area.width, title, Some(note.to_string()))
        .title_bottom(charts::heat_key().right_aligned());
    if let Some(caption) = caption {
        block = block.title_bottom(caption);
    }
    let inner = block.inner(area);
    frame.render_widget(block, area);
    inner
}

/// Weeks across, Monday to Sunday down, as GitHub draws a year.
pub(super) fn draw_calendar(p: &Pulse, frame: &mut Frame, area: Rect) {
    let inner = grid_section(frame, area, "Calendar", "each square is a day", None);
    let n = p.days.len() as i64;
    let offset = (p.first_day + 3).rem_euclid(7);
    let weeks = ((offset + n) as usize).div_ceil(7);
    // Most recent weeks first, if they do not all fit.
    let room = usize::from(inner.width.saturating_sub(5)) / 2;
    let skip = weeks.saturating_sub(room);
    let most = p.days.iter().copied().max().map_or(0, u64::from);
    let columns: Vec<Vec<Option<u64>>> = (skip..weeks)
        .map(|w| {
            (0..7)
                .map(|row| {
                    let i = (w * 7 + row) as i64 - offset;
                    (0..n)
                        .contains(&i)
                        .then(|| p.days.get(i as usize).map_or(0, |&d| u64::from(d)))
                })
                .collect()
        })
        .collect();
    let x = inner.x + 4;
    let y = inner.y + 1;
    // Month names over the week each month starts in.
    let buf = frame.buffer_mut();
    let mut free = x;
    for (k, w) in (skip..weeks).enumerate() {
        let first = p.first_day + (w * 7) as i64 - offset;
        let (_, month, day) = civil_from_unix(first.max(p.first_day) * DAY);
        let starts = k == 0 || day <= 7;
        let at = x + (k * 2) as u16;
        if starts && at >= free && at + 3 <= inner.x + inner.width {
            buf.set_string(at, inner.y, month_name(month), Style::new().fg(MUTED));
            free = at + 4;
        }
    }
    for (row, name) in [(0, "Mon"), (2, "Wed"), (4, "Fri"), (6, "Sun")] {
        if y + row < inner.bottom() {
            buf.set_string(inner.x, y + row, name, Style::new().fg(MUTED));
        }
    }
    let grid = Rect {
        x,
        y,
        width: inner.right().saturating_sub(x),
        height: inner.bottom().saturating_sub(y),
    };
    charts::heat_grid(buf, grid, &columns, most);
}

/// Years down, months across: all of history on one screen.
fn draw_years(p: &Pulse, frame: &mut Frame, area: Rect) {
    let inner = grid_section(frame, area, "By month", "each square is a month", None);
    let mut months: Vec<((i64, u32), u64)> = Vec::new();
    for (i, &n) in p.days.iter().enumerate() {
        let (y, m, _) = civil_from_unix((p.first_day + i as i64) * DAY);
        match months.last_mut() {
            Some((key, total)) if *key == (y, m) => *total += u64::from(n),
            _ => months.push(((y, m), u64::from(n))),
        }
    }
    let Some(&((first_year, _), _)) = months.first() else {
        return;
    };
    let last_year = months.last().map_or(first_year, |m| m.0 .0);
    let rows = usize::from(inner.height.saturating_sub(1));
    let skip = ((last_year - first_year + 1) as usize).saturating_sub(rows);
    let most = months.iter().map(|m| m.1).max().unwrap_or(0);
    let buf = frame.buffer_mut();
    let x = inner.x + 6;
    for m in 1..=12u32 {
        if m % 3 == 1 {
            buf.set_string(
                x + ((m - 1) * 2) as u16,
                inner.y,
                month_name(m),
                Style::new().fg(MUTED),
            );
        }
    }
    let columns: Vec<Vec<Option<u64>>> = (1..=12u32)
        .map(|m| {
            (first_year + skip as i64..=last_year)
                .map(|y| months.iter().find(|k| k.0 == (y, m)).map(|k| k.1))
                .collect()
        })
        .collect();
    for (row, year) in (first_year + skip as i64..=last_year).enumerate() {
        buf.set_string(
            inner.x,
            inner.y + 1 + row as u16,
            year.to_string(),
            Style::new().fg(MUTED),
        );
    }
    let grid = Rect {
        x,
        y: inner.y + 1,
        width: inner.right().saturating_sub(x),
        height: inner.height.saturating_sub(1),
    };
    charts::heat_grid(buf, grid, &columns, most);
}

fn full_weekday(day: usize) -> &'static str {
    const NAMES: [&str; 7] = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ];
    NAMES.get(day).copied().unwrap_or("")
}

/// Weekdays down, hours across: when the team works.
pub(super) fn draw_week(p: &Pulse, frame: &mut Frame, area: Rect) {
    let caption = match (p.busiest_weekday(), p.busiest_hour()) {
        (Some(d), Some(h)) => Some(Line::from(vec![
            faint(" busiest "),
            bold(format!("{}s", full_weekday(d))),
            faint(" around "),
            bold(format!("{} ", hour(h))),
        ])),
        _ => None,
    };
    let inner = grid_section(
        frame,
        area,
        "Hours of the week",
        "on each author's clock",
        caption,
    );
    let most = p.week.iter().flatten().copied().max().map_or(0, u64::from);
    let columns: Vec<Vec<Option<u64>>> = (0..24)
        .map(|h| {
            p.week
                .iter()
                .map(|hours| Some(u64::from(hours.get(h).copied().unwrap_or(0))))
                .collect()
        })
        .collect();
    let buf = frame.buffer_mut();
    let x = inner.x + 4;
    for h in (0..24).step_by(6) {
        let at = x + (h * 2) as u16;
        if at + 2 <= inner.right() {
            buf.set_string(at, inner.y, format!("{h:02}"), Style::new().fg(MUTED));
        }
    }
    for day in 0..7 {
        let y = inner.y + 1 + day as u16;
        if y < inner.bottom() {
            buf.set_string(inner.x, y, weekday_name(day), Style::new().fg(MUTED));
        }
    }
    let grid = Rect {
        x,
        y: inner.y + 1,
        width: inner.right().saturating_sub(x),
        height: inner.height.saturating_sub(1),
    };
    charts::heat_grid(buf, grid, &columns, most);
}

fn draw_kinds(p: &Pulse, frame: &mut Frame, area: Rect) {
    let inner = boxed(
        frame,
        area,
        "What kind of work",
        Some("from commit messages".to_string()),
    );
    let total = u64::from(p.commits);
    let other = p
        .kinds
        .iter()
        .find(|k| k.kind == CommitKind::Other)
        .map_or(0, |k| u64::from(k.commits));
    if total == 0 || (total - other) * 10 < total * 3 {
        super::empty(
            frame,
            inner,
            "Most commit messages here follow no convention (feat:, fix: ...), so their kind is unknown.",
        );
        return;
    }
    let mut kinds: Vec<(CommitKind, u64)> = p
        .kinds
        .iter()
        .filter(|k| k.commits > 0 && k.kind != CommitKind::Other)
        .map(|k| (k.kind, u64::from(k.commits)))
        .collect();
    kinds.sort_by_key(|k| std::cmp::Reverse(k.1));
    let most = kinds.first().map_or(0, |k| k.1);
    let bar_width = inner.width.saturating_sub(24).max(4);
    // When they do not all fit, the last row names the rest.
    let rows = usize::from(inner.height).saturating_sub(usize::from(other > 0));
    let shown = if kinds.len() > rows {
        rows.saturating_sub(1)
    } else {
        kinds.len()
    };
    let mut lines: Vec<Line> = kinds
        .iter()
        .take(shown)
        .map(|(kind, n)| {
            Line::from(vec![
                plain(format!(" {:<12}", kind.label())),
                Span::styled(
                    format!(
                        "{:<width$}",
                        charts::bar(*n, most, bar_width),
                        width = usize::from(bar_width)
                    ),
                    Style::new().fg(ACCENT),
                ),
                bold(format!(" {:>5}", grouped(*n))),
                faint(format!(" {:>4}", share(*n, total))),
            ])
        })
        .collect();
    if let Some(rest) = kinds.get(shown..).filter(|rest| !rest.is_empty()) {
        let named: Vec<String> = rest
            .iter()
            .map(|(kind, n)| format!("{} {}", kind.label(), grouped(*n)))
            .collect();
        lines.push(super::fit_line(
            Line::from(faint(format!(" and {}", named.join(", ")))),
            usize::from(inner.width),
        ));
    }
    if other > 0 {
        lines.push(Line::from(faint(format!(
            " and {} with no convention",
            grouped(other)
        ))));
    }
    frame.render_widget(Paragraph::new(lines), inner);
}

fn draw_rhythm(p: &Pulse, frame: &mut Frame, area: Rect) {
    let inner = boxed(frame, area, "Rhythm", None);
    let total = u64::from(p.commits);
    if total == 0 {
        return;
    }
    let row = |label: &str, value: String, note: String| {
        Line::from(vec![
            plain(format!(" {label:<18}")),
            bold(value),
            faint(format!("  {note}")),
        ])
    };
    let mut lines = vec![
        row(
            "at night",
            share(u64::from(p.night()), total),
            "22:00 to 05:00".to_string(),
        ),
        row(
            "on weekends",
            share(u64::from(p.weekend()), total),
            "Saturdays and Sundays".to_string(),
        ),
    ];
    if let Some(s) = p.longest_streak.filter(|s| s.days >= 2) {
        lines.push(row(
            "longest streak",
            format!("{} days", s.days),
            format!("from {}", short_date(s.first_day * DAY)),
        ));
    }
    if let Some((day, n)) = p.busiest_day.filter(|&(_, n)| n >= 2) {
        lines.push(row(
            "busiest day",
            short_date(day * DAY),
            format!("{} commits", grouped(u64::from(n))),
        ));
    }
    frame.render_widget(Paragraph::new(lines), inner);
}
