//! Drawing. A frame is a function of the App's state alone: nothing here
//! computes a metric.

mod activity;
mod age;
pub(crate) mod charts;
mod coupling;
mod detail;
mod github;
mod help;
mod hotspots;
mod map;
mod overview;
mod ownership;
mod people;

use commitscape_metrics::Span;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span as Text};
use ratatui::widgets::{Block, BorderType, Clear, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::{App, Panel};
use crate::format::{counted, grouped, short_date};
use crate::list::Cursor;
use crate::theme::{self, ACCENT, LINE, MUTED, SELECTED, SURFACE, TEXT, TEXT_2};

/// A Window's span in words: `the last 90 days`.
pub(crate) fn phrase(span: Span) -> &'static str {
    match span {
        Span::Month => "the last 30 days",
        Span::Quarter => "the last 90 days",
        Span::Year => "the last year",
        Span::All => "all of history",
    }
}

/// A Window's span, short: `90 days`, `all time`.
pub(crate) fn short_phrase(span: Span) -> &'static str {
    match span {
        Span::Month => "30 days",
        Span::Quarter => "90 days",
        Span::Year => "1 year",
        Span::All => "all time",
    }
}

pub(crate) fn draw(app: &mut App, frame: &mut Frame) {
    let area = frame.area();
    frame.render_widget(Block::new().style(Style::new().bg(SURFACE).fg(TEXT)), area);
    let [header, tabs, rule, body, footer] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(area);
    app.page = usize::from(body.height.saturating_sub(4)).max(1);

    draw_header(app, frame, header);
    draw_tabs(app, frame, tabs, rule);
    draw_body(app, frame, body);
    draw_footer(app, frame, footer);
    if let Some(scroll) = app.help {
        dim(frame, area);
        let scroll = help::draw(app, frame, area, scroll);
        app.help = Some(scroll);
    }
}

/// Fades everything already drawn, under an overlay.
fn dim(frame: &mut Frame, area: Rect) {
    let buf = frame.buffer_mut();
    for y in area.y..area.y + area.height {
        for x in area.x..area.x + area.width {
            if let Some(cell) = buf.cell_mut((x, y)) {
                cell.set_fg(theme::GRID).set_bg(SURFACE);
            }
        }
    }
}

fn draw_body(app: &mut App, frame: &mut Frame, area: Rect) {
    if app.panel == Panel::GitHub && app.opened.is_empty() {
        github::draw(app, frame, area);
        return;
    }
    if app.current().is_none() {
        let message = app.waiting();
        frame.render_widget(
            Paragraph::new(vec![
                Line::default(),
                Line::from(message).style(theme::secondary()),
            ])
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: false }),
            area,
        );
        return;
    }
    if let Some(mut opened) = app.opened.pop() {
        detail::draw(app, frame, area, &mut opened);
        app.opened.push(opened);
        return;
    }
    let position = app.panel.position();
    let mut cursor = app.cursors.get(position).copied().unwrap_or_default();
    match app.panel {
        Panel::Overview => overview::draw(app, frame, area, &mut cursor),
        Panel::Activity => activity::draw(app, frame, area),
        Panel::People => people::draw(app, frame, area, &mut cursor),
        Panel::Map => {
            let mut map_cursor = app.map.cursor;
            map::draw(app, frame, area, &mut map_cursor);
            app.map.cursor = map_cursor;
        }
        Panel::Hotspots => hotspots::draw(app, frame, area, &mut cursor),
        Panel::Coupling => coupling::draw(app, frame, area, &mut cursor),
        Panel::Ownership => ownership::draw(app, frame, area, &mut cursor),
        Panel::Age => age::draw(app, frame, area, &mut cursor),
        Panel::GitHub => {}
    }
    if let Some(slot) = app.cursors.get_mut(position) {
        *slot = cursor;
    }
}

fn draw_header(app: &App, frame: &mut Frame, area: Rect) {
    let mut left = vec![
        Text::styled(
            " commitscape ",
            Style::new()
                .bg(ACCENT)
                .fg(SURFACE)
                .add_modifier(Modifier::BOLD),
        ),
        Text::raw("  "),
        Text::styled(app.name.clone(), theme::title()),
    ];
    if let Some(f) = app.current() {
        let since = f
            .totals
            .first_commit
            .map(|t| format!(" · since {}", short_date(t)))
            .unwrap_or_default();
        left.push(Text::styled(
            format!(
                "   {} · {}{since}",
                counted(f.totals.commits, "commit", "commits"),
                counted(f.totals.people as u64, "person", "people"),
            ),
            theme::muted(),
        ));
    }
    let mut windows = vec![Text::styled("window ", theme::muted())];
    for span in Span::EVERY {
        let label = format!(" {} ", span.label());
        windows.push(if span == app.span {
            Text::styled(
                label,
                Style::new()
                    .bg(SELECTED)
                    .fg(TEXT)
                    .add_modifier(Modifier::BOLD),
            )
        } else {
            Text::styled(label, theme::muted())
        });
    }
    windows.push(Text::raw(" "));
    let right = Line::from(windows);
    let [l, r] = Layout::horizontal([
        Constraint::Fill(1),
        Constraint::Length(right.width() as u16),
    ])
    .areas(area);
    frame.render_widget(Paragraph::new(Line::from(left)), l);
    frame.render_widget(Paragraph::new(right), r);
}

fn draw_tabs(app: &App, frame: &mut Frame, area: Rect, rule: Rect) {
    let mut spans = vec![Text::raw(" ")];
    let mut active = (0u16, 0u16);
    let mut x = 1u16;
    for (i, panel) in Panel::EVERY.iter().enumerate() {
        let on = *panel == app.panel;
        let number = format!("{} ", i + 1);
        let title = panel.title();
        let width = (number.len() + title.len()) as u16;
        if on {
            active = (x, width);
        }
        spans.push(Text::styled(
            number,
            Style::new().fg(if on { ACCENT } else { MUTED }),
        ));
        spans.push(if on {
            Text::styled(title, theme::title())
        } else {
            Text::styled(title, theme::secondary())
        });
        spans.push(Text::raw("   "));
        x += width + 3;
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), area);

    // A hairline under the tabs, heavy and in the accent under the one
    // that is open.
    let buf = frame.buffer_mut();
    for dx in 0..rule.width {
        let under = dx >= active.0 && dx < active.0 + active.1;
        if let Some(cell) = buf.cell_mut((rule.x + dx, rule.y)) {
            cell.set_symbol(if under { "━" } else { "─" })
                .set_style(Style::new().fg(if under { ACCENT } else { LINE }));
        }
    }
}

fn draw_footer(app: &App, frame: &mut Frame, area: Rect) {
    let key =
        |k: &'static str| Text::styled(k, Style::new().fg(TEXT_2).add_modifier(Modifier::BOLD));
    let say = |s: &'static str| Text::styled(s, theme::muted());
    let line = if app.search.typing {
        Line::from(vec![
            Text::raw(" "),
            key("find "),
            Text::styled(format!("{}▏", app.search.query), theme::text()),
            say("   "),
            key("enter"),
            say(" keep   "),
            key("esc"),
            say(" clear"),
        ])
    } else if app.help.is_some() {
        Line::from(vec![
            Text::raw(" "),
            key("↑↓"),
            say(" scroll   "),
            key("esc"),
            say(" close"),
        ])
    } else {
        let mut spans = vec![Text::raw(" ")];
        let mut add = |k: &'static str, s: &'static str| {
            spans.push(key(k));
            spans.push(say(s));
        };
        add("↑↓", " move  ");
        if app.panel != Panel::Activity && app.panel != Panel::GitHub {
            add("enter", " open  ");
        }
        if !app.opened.is_empty() || (app.panel == Panel::Map && app.map.at != 0) {
            add("esc", " back  ");
        }
        add("←→", " panels  ");
        add("w", " window  ");
        if app.panel == Panel::Map {
            add("c", " colour  ");
        }
        if matches!(
            app.panel,
            Panel::People | Panel::Hotspots | Panel::Coupling | Panel::Ownership
        ) && app.opened.is_empty()
        {
            add("/", " find  ");
        }
        add("?", " help  ");
        add("q", " quit");
        if !app.search.query.is_empty() {
            spans.push(say("   showing "));
            spans.push(Text::styled(
                format!("\"{}\"", app.search.query),
                theme::text(),
            ));
        }
        Line::from(spans)
    };
    frame.render_widget(Paragraph::new(line), area);
}

/// A section `width` columns wide: a rounded hairline border with a title
/// and, on the right, a note in muted ink. The note gives way when the two
/// would not both fit.
pub(crate) fn section<'a>(width: u16, title: &str, note: Option<String>) -> Block<'a> {
    let mut block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(LINE))
        .title(Line::from(format!(" {title} ")).style(theme::title()));
    if let Some(note) = note {
        let needed = title.chars().count() + note.chars().count() + 7;
        if needed <= usize::from(width) {
            block = block.title_top(
                Line::from(format!(" {note} "))
                    .style(theme::muted())
                    .right_aligned(),
            );
        }
    }
    block
}

/// Draws a [`section`] over `area` and returns the space inside it.
pub(crate) fn boxed(frame: &mut Frame, area: Rect, title: &str, note: Option<String>) -> Rect {
    let block = section(area.width, title, note);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    inner
}

/// Wrapped text a column in from each side of `area`, so every line of a
/// paragraph keeps the same margin.
pub(crate) fn prose(frame: &mut Frame, area: Rect, lines: Vec<Line<'static>>) {
    frame.render_widget(
        Paragraph::new(lines).wrap(Wrap { trim: false }),
        inset(area),
    );
}

/// How many rows [`prose`] takes to show `lines` in `width` columns.
pub(crate) fn prose_height(lines: &[Line<'static>], width: u16) -> u16 {
    let paragraph = Paragraph::new(lines.to_vec()).wrap(Wrap { trim: false });
    u16::try_from(paragraph.line_count(width.saturating_sub(2))).unwrap_or(u16::MAX)
}

/// A Panel's opening paragraph, as tall as it needs to be up to half the
/// Panel, drawn at the top of `area`. Returns the rest of `area`.
pub(crate) fn intro(frame: &mut Frame, area: Rect, lines: Vec<Line<'static>>) -> Rect {
    let height = prose_height(&lines, area.width).min(area.height / 2);
    prose(frame, Rect { height, ..area }, lines);
    Rect {
        y: area.y + height,
        height: area.height - height,
        ..area
    }
}

/// `area` less a column on each side.
pub(crate) fn inset(area: Rect) -> Rect {
    Rect {
        x: area.x + 1,
        width: area.width.saturating_sub(2),
        ..area
    }
}

/// A folder's label as the interface shows it: the root holds the whole
/// project.
pub(crate) fn folder(label: &str) -> &str {
    if label.is_empty() || label == "(root)" {
        "whole project"
    } else {
        label
    }
}

/// A file's folder, or `top level` for a file at the root.
pub(crate) fn home(dir: &str) -> &str {
    if dir.is_empty() {
        "top level"
    } else {
        dir
    }
}

/// Two paths by their names, with as many of their folders as tell them
/// apart: `server/store.ts` and `web/store.ts` rather than `store.ts` twice.
pub(crate) fn names_apart(a: &str, b: &str) -> (String, String) {
    let (xs, ys): (Vec<&str>, Vec<&str>) = (a.split('/').collect(), b.split('/').collect());
    let mut keep = 1;
    while keep < xs.len().max(ys.len()) && xs.iter().rev().take(keep).eq(ys.iter().rev().take(keep))
    {
        keep += 1;
    }
    let tail = |parts: &[&str]| {
        parts
            .get(parts.len().saturating_sub(keep)..)
            .unwrap_or_default()
            .join("/")
    };
    (tail(&xs), tail(&ys))
}

/// A path's directory and file name: `src/engine/` and `core.rs`.
pub(crate) fn split_path(path: &str) -> (&str, &str) {
    match path.rfind('/') {
        Some(i) => (
            path.get(..=i).unwrap_or(""),
            path.get(i + 1..).unwrap_or(path),
        ),
        None => ("", path),
    }
}

/// `s` in at most `width` characters, cut from the front: the end of a path
/// or name says more than its start.
pub(crate) fn fit(s: &str, width: usize) -> String {
    let n = s.chars().count();
    if n <= width {
        return s.to_string();
    }
    if width == 0 {
        return String::new();
    }
    let keep: String = s.chars().skip(n + 1 - width).collect();
    format!("…{keep}")
}

/// A line in at most `width` characters, ending in `…` when it was longer.
pub(crate) fn fit_line(line: Line<'static>, width: usize) -> Line<'static> {
    let total: usize = line.spans.iter().map(|s| s.content.chars().count()).sum();
    if total <= width {
        return line;
    }
    let mut out = Vec::new();
    let mut used = 0;
    for span in line.spans {
        let n = span.content.chars().count();
        if used + n < width {
            used += n;
            out.push(span);
            continue;
        }
        let keep: String = span
            .content
            .chars()
            .take(width.saturating_sub(used + 1))
            .collect();
        out.push(Text::styled(format!("{keep}…"), span.style));
        break;
    }
    Line::from(out)
}

/// Spans word-wrapped to `width` columns, every line after the first
/// indented by `indent`: a bullet whose text lines up under itself.
pub(crate) fn wrap_spans(
    spans: Vec<Text<'static>>,
    width: usize,
    indent: usize,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let mut line: Vec<Text<'static>> = Vec::new();
    let (mut used, mut start) = (0, 0);
    for span in spans {
        for word in span.content.split_inclusive(' ') {
            let bare = word.trim_end().chars().count();
            if used + bare > width && used > start {
                lines.push(Line::from(std::mem::take(&mut line)));
                line.push(Text::raw(" ".repeat(indent)));
                (used, start) = (indent, indent);
            }
            line.push(Text::styled(word.to_string(), span.style));
            used += word.chars().count();
        }
    }
    if used > start {
        lines.push(Line::from(line));
    }
    lines
}

/// `s` in at most `width` characters, cut from the end.
pub(crate) fn clip(s: &str, width: usize) -> String {
    if s.chars().count() <= width {
        return s.to_string();
    }
    if width == 0 {
        return String::new();
    }
    let keep: String = s.chars().take(width - 1).collect();
    format!("{keep}…")
}

/// The rows of a list that fit in `height`, scrolled to keep the selection
/// in view, with the selection's position inside them.
pub(crate) fn visible(
    cursor: &mut Cursor,
    len: usize,
    height: usize,
) -> (std::ops::Range<usize>, usize) {
    let shown = cursor.visible(len, height);
    let at = cursor.selected().saturating_sub(shown.start);
    (shown, at)
}

/// Paints a selected row's background across `area`'s width at `y`.
pub(crate) fn highlight(frame: &mut Frame, area: Rect, y: u16) {
    let buf = frame.buffer_mut();
    for x in area.x..area.x + area.width {
        if let Some(cell) = buf.cell_mut((x, y)) {
            cell.set_bg(SELECTED);
        }
    }
    if let Some(cell) = buf.cell_mut((area.x, y)) {
        cell.set_symbol("▌").set_fg(ACCENT);
    }
}

/// A one-line message in the middle of an empty section.
pub(crate) fn empty(frame: &mut Frame, area: Rect, message: &str) {
    frame.render_widget(
        Paragraph::new(vec![
            Line::default(),
            Line::from(message.to_string()).style(theme::muted()),
        ])
        .alignment(Alignment::Center)
        .wrap(Wrap { trim: false }),
        area,
    );
}

/// A number and what it counts, as a tile: the value large and bold, the
/// label and a second line muted.
pub(crate) fn tile(frame: &mut Frame, area: Rect, value: &str, label: &str, note: &str) {
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(LINE));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let lines = vec![
        Line::from(Text::styled(value.to_string(), theme::title())),
        Line::from(Text::styled(label.to_string(), theme::secondary())),
        Line::from(Text::styled(note.to_string(), theme::muted())),
    ];
    frame.render_widget(Paragraph::new(lines), inner);
}

/// Clears an area, for overlays.
pub(crate) fn clear(frame: &mut Frame, area: Rect) {
    frame.render_widget(Clear, area);
    frame.render_widget(Block::new().style(Style::new().bg(SURFACE)), area);
}

/// `n` grouped with a unit: `1,234 commits`.
pub(crate) fn many(n: u64, one: &str, several: &str) -> String {
    format!("{} {}", grouped(n), if n == 1 { one } else { several })
}

pub(crate) fn bold<'a>(s: impl Into<String>) -> Text<'a> {
    Text::styled(s.into(), theme::title())
}

pub(crate) fn plain<'a>(s: impl Into<String>) -> Text<'a> {
    Text::styled(s.into(), theme::secondary())
}

pub(crate) fn faint<'a>(s: impl Into<String>) -> Text<'a> {
    Text::styled(s.into(), theme::muted())
}

pub(crate) fn dot<'a>(colour: ratatui::style::Color) -> Text<'a> {
    Text::styled("● ", Style::new().fg(colour))
}
