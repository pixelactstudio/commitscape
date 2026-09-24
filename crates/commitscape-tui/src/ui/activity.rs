//! Activity: when the work happens, on each author's own clock.

use commitscape_core::civil_from_unix;
use commitscape_metrics::{Pulse, Span as Window, Work};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, faint, many, plain, short_phrase};
use crate::app::{App, GitHubState};
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
        .work
        .iter()
        .filter(|w| w.commits > 0 && w.work != Work::Unclassified)
        .count() as u16;
    let lists = (kinds.max(7) + 3)
        .min(area.height.saturating_sub(17))
        .max(5);
    let [top, middle, bottom] = Layout::vertical([
        Constraint::Min(7),
        Constraint::Length(GRID_HEIGHT),
        Constraint::Length(lists),
    ])
    .areas(area);

    draw_by_person(app, f, frame, top);

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
    draw_rhythm(app, p, frame, rhythm);
}

/// Commits over time, each column split among the five who made the most
/// and everyone else, in each person's colour, with a legend, and releases
/// marked above.
fn draw_by_person(app: &App, f: &crate::findings::Findings, frame: &mut Frame, area: Rect) {
    let p = &f.pulse;
    let inner = boxed(
        frame,
        area,
        "Commits over time, by person",
        Some(format!(
            "{} on {} in {}",
            grouped(u64::from(p.commits)),
            many(u64::from(p.active_days), "active day", "active days"),
            short_phrase(app.span)
        )),
    );
    if p.commits == 0 {
        super::empty(frame, inner, "No commits in this window.");
        return;
    }
    let by = &f.by_person;
    let slots = usize::from(inner.width).max(1);
    let per = by.days.len().div_ceil(slots).max(1);
    let stacks: Vec<Vec<u64>> = by
        .days
        .chunks(per)
        .map(|chunk| {
            let mut sum = vec![0u64; by.people.len() + 1];
            for day in chunk {
                for (s, &n) in sum.iter_mut().zip(day) {
                    *s += u64::from(n);
                }
            }
            sum
        })
        .collect();
    let mut colours: Vec<_> = by.people.iter().map(|&a| app.colour_of(a)).collect();
    colours.push(MUTED);
    let most = stacks
        .iter()
        .map(|s| s.iter().sum::<u64>())
        .max()
        .unwrap_or(0);
    let marks: Vec<usize> = app
        .releases
        .iter()
        .filter_map(|(_, time)| {
            let day = time.div_euclid(DAY) - by.first_day;
            (day >= 0 && (day as usize) < by.days.len()).then(|| day as usize / per)
        })
        .collect();

    let mut legend = caption(per, most).spans;
    legend.push(faint("   "));
    for (&person, &colour) in by.people.iter().zip(&colours) {
        legend.push(super::dot(colour));
        legend.push(plain(format!("{}  ", app.display_name(person))));
    }
    if stacks.iter().any(|s| s.last().is_some_and(|&n| n > 0)) {
        legend.push(super::dot(MUTED));
        legend.push(plain("everyone else  "));
    }
    if !marks.is_empty() {
        legend.push(faint("▾ release"));
    }
    frame.render_widget(
        Paragraph::new(super::fit_line(
            Line::from(legend),
            usize::from(inner.width),
        )),
        Rect { height: 1, ..inner },
    );
    charts::stacked_columns(
        frame.buffer_mut(),
        Rect {
            y: inner.y + 1,
            height: inner.height.saturating_sub(1),
            ..inner
        },
        &stacks,
        &colours,
        &marks,
        charts::month_labels(by.first_day, per),
    );
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
        Some("from the files, then the message".to_string()),
    );
    let total = u64::from(p.commits);
    let unclassified = p
        .work
        .iter()
        .find(|w| w.work == Work::Unclassified)
        .map_or(0, |w| u64::from(w.commits));
    if total == 0 || unclassified * 2 > total {
        super::empty(
            frame,
            inner,
            "Most commits here change code of every kind and say nothing conventional (feat:, fix: ...), so what they were is unknown.",
        );
        return;
    }
    let mut kinds: Vec<(Work, u64)> = p
        .work
        .iter()
        .filter(|w| w.commits > 0 && w.work != Work::Unclassified)
        .map(|w| (w.work, u64::from(w.commits)))
        .collect();
    kinds.sort_by_key(|k| std::cmp::Reverse(k.1));
    let most = kinds.first().map_or(0, |k| k.1);
    let bar_width = inner.width.saturating_sub(26).max(4);
    // When they do not all fit, the last row names the rest.
    let rows = usize::from(inner.height).saturating_sub(usize::from(unclassified > 0));
    let shown = if kinds.len() > rows {
        rows.saturating_sub(1)
    } else {
        kinds.len()
    };
    let mut lines: Vec<Line> = kinds
        .iter()
        .take(shown)
        .map(|(work, n)| {
            Line::from(vec![
                plain(format!(" {:<14}", work.label())),
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
            .map(|(work, n)| format!("{} {}", work.label(), grouped(*n)))
            .collect();
        lines.push(super::fit_line(
            Line::from(faint(format!(" and {}", named.join(", ")))),
            usize::from(inner.width),
        ));
    }
    if unclassified > 0 {
        lines.push(Line::from(faint(format!(
            " and {} that could not be told",
            grouped(unclassified)
        ))));
    }
    frame.render_widget(Paragraph::new(lines), inner);
}

fn draw_rhythm(app: &App, p: &Pulse, frame: &mut Frame, area: Rect) {
    let inner = boxed(frame, area, "Rhythm and GitHub", None);
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
    let mut lines = github_lines(app);
    lines.extend(vec![
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
    ]);
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
    let width = usize::from(inner.width);
    let lines: Vec<Line> = lines
        .into_iter()
        .map(|l| super::fit_line(l, width))
        .collect();
    frame.render_widget(Paragraph::new(lines), inner);
}

/// What GitHub says about pull requests and issues, or why it says nothing.
fn github_lines(app: &App) -> Vec<Line<'static>> {
    let g = match &app.github {
        GitHubState::Ready(g) => g,
        GitHubState::Asking => return vec![Line::from(faint(" asking GitHub…"))],
        GitHubState::Unavailable(why) => {
            return vec![Line::from(faint(format!(" No GitHub numbers: {why}.")))]
        }
    };
    let oldest = g
        .recent_prs
        .iter()
        .map(|p| p.created)
        .min()
        .unwrap_or(app.anchor);
    let median = g.median_hours_to_merge().map(|h| {
        if h < 1.0 {
            many((h * 60.0).round().max(1.0) as u64, "minute", "minutes")
        } else if h < 48.0 {
            many(h.round() as u64, "hour", "hours")
        } else {
            many((h / 24.0).round() as u64, "day", "days")
        }
    });
    let mut prs = vec![
        plain(format!(" {:<18}", "pull requests")),
        bold(grouped(g.prs_merged_since(oldest) as u64)),
        faint(format!(" merged of the latest {}", g.recent_prs.len())),
    ];
    if let Some(m) = median {
        prs.push(faint(", half within "));
        prs.push(bold(m));
    }
    vec![
        Line::from(prs),
        Line::from(vec![
            plain(format!(" {:<18}", "issues")),
            bold(grouped(g.open_issues)),
            faint(" open, "),
            bold(grouped(g.closed_issues)),
            faint(" closed"),
        ]),
    ]
}
