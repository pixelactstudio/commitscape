//! Hotspots: code that changes often and is deeply nested. Each row shows
//! both, side by side, so the files high on both stand out.

use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{
    bold, boxed, clip, faint, fit, highlight, many, plain, short_phrase, split_path, visible,
};
use crate::app::App;
use crate::format::{grouped, most};
use crate::list::Cursor;
use crate::theme::{ACCENT, HEAT, MUTED};

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let list_area = super::intro(
        frame,
        area,
        vec![Line::from(vec![
            plain("A hotspot is code that "),
            Span::styled("changes often", Style::new().fg(ACCENT)),
            plain(" and is "),
            Span::styled("deeply nested", Style::new().fg(HEAT[2])),
            plain(". Bugs and slow changes gather in it, so it is the first code worth simplifying or testing. The longer both bars, the hotter the file. Press ? for how each is measured."),
        ])],
    );
    let rows = app.rows(f);
    let inner = boxed(
        frame,
        list_area,
        "Hotspots",
        Some(format!(
            "changes in {} · nesting at HEAD · enter for a file",
            short_phrase(app.span)
        )),
    );
    if rows.is_empty() {
        super::empty(
            frame,
            inner,
            if app.search.query.is_empty() {
                "No code a person wrote changed in this window."
            } else {
                "No hotspot matches the search."
            },
        );
        return;
    }
    // Both bars scale to the largest value among the Hotspots, so a full
    // bar is the most anything here has.
    let most_churn = f
        .hotspots
        .iter()
        .map(|h| u64::from(h.churn))
        .max()
        .unwrap_or(0);
    let most_nesting = f
        .hotspots
        .iter()
        .map(|h| u64::from(h.complexity))
        .max()
        .unwrap_or(0);
    // rank 5, name, "  changes " 10, count 6, "   nesting " 11, count 8.
    let name_width = usize::from(inner.width / 4).clamp(16, 34);
    let fixed = 5 + name_width as u16 + 10 + 6 + 11 + 8;
    let bar = (inner.width.saturating_sub(fixed) / 2).clamp(4, 24);
    let height = usize::from(inner.height / 2);
    let (shown, at) = visible(cursor, rows.len(), height);
    let mut lines = Vec::new();
    for &i in rows.get(shown).unwrap_or_default() {
        let Some(h) = f.hotspots.get(i) else {
            continue;
        };
        let path = app.index.paths.path_lossy(h.file);
        let (dir, name) = split_path(&path);
        let mut first = vec![
            faint(format!("{:>3}  ", i + 1)),
            bold(format!(
                "{:<width$}",
                clip(name, name_width),
                width = name_width
            )),
            faint("  changes "),
            Span::styled(
                format!(
                    "{:<width$}",
                    charts::bar(u64::from(h.churn), most_churn, bar),
                    width = usize::from(bar)
                ),
                Style::new().fg(ACCENT),
            ),
            bold(format!(" {:>5}", grouped(u64::from(h.churn)))),
            faint("   nesting "),
            Span::styled(
                format!(
                    "{:<width$}",
                    charts::bar(u64::from(h.complexity), most_nesting, bar),
                    width = usize::from(bar)
                ),
                Style::new().fg(HEAT[2]),
            ),
            bold(format!(" {:>7}", grouped(u64::from(h.complexity)))),
        ];
        first.push(Span::raw(""));
        lines.push(Line::from(first));
        lines.push(Line::from(vec![
            Span::raw("     "),
            Span::styled(
                format!(
                    "{:<width$}",
                    fit(super::home(dir), name_width),
                    width = name_width
                ),
                Style::new().fg(MUTED),
            ),
            faint(format!(
                "  {} of {} · {} of {}",
                most(h.churn_rank.place, "changed"),
                many(u64::from(h.churn_rank.of), "file", "files"),
                most(h.complexity_rank.place, "nested"),
                grouped(u64::from(h.complexity_rank.of)),
            )),
        ]));
    }
    frame.render_widget(Paragraph::new(lines), inner);
    highlight(frame, inner, inner.y + (at * 2) as u16);
    highlight(frame, inner, inner.y + (at * 2) as u16 + 1);
}
