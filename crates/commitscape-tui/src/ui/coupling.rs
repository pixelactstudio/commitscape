//! Coupling: files that keep changing in the same commits.

use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::charts;
use super::{bold, boxed, clip, faint, fit, highlight, plain, short_phrase, split_path, visible};
use crate::app::App;
use crate::format::{grouped, percent};
use crate::list::Cursor;
use crate::theme::{ACCENT, MUTED, WARNING};

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let list_area = super::intro(
        frame,
        area,
        vec![
            Line::from(vec![
                plain("Files that keep changing in the same commits. "),
                bold("75%"),
                plain(" means three of every four commits that touched either file touched both."),
            ]),
            Line::from(vec![
                plain("Two files in one folder changing together is expected. "),
                Span::styled("▲ ", Style::new().fg(WARNING)),
                plain("Across folders, it often means one depends on the other without saying so."),
            ]),
        ],
    );

    let c = &f.coupling;
    let rows = app.rows(f);
    let inner = boxed(
        frame,
        list_area,
        "Change coupling",
        Some(format!(
            "files with {} or more commits in {} · enter for their commits",
            c.support,
            short_phrase(app.span)
        )),
    );
    if rows.is_empty() {
        super::empty(
            frame,
            inner,
            if app.search.query.is_empty() {
                "No two such files changed together in this window."
            } else {
                "No pair matches the search."
            },
        );
        return;
    }
    let bar_width = 14u16;
    let half = usize::from(inner.width.saturating_sub(bar_width + 48)) / 2;
    let name_width = half.max(10);
    let height = usize::from(inner.height / 2);
    let (shown, at) = visible(cursor, rows.len(), height);
    let path = |file| app.index.paths.path_lossy(file);
    let mut lines = Vec::new();
    for &i in rows.get(shown).unwrap_or_default() {
        let Some(p) = c.pairs.get(i) else {
            continue;
        };
        let (a, b) = (path(p.first), path(p.second));
        let ((dir_a, name_a), (dir_b, name_b)) = (split_path(&a), split_path(&b));
        let either = p.first_commits + p.second_commits - p.both;
        lines.push(Line::from(vec![
            faint(format!("{:>3}  ", i + 1)),
            bold(format!(
                "{:>width$}",
                clip(name_a, name_width),
                width = name_width
            )),
            Span::styled("  ⇄  ", Style::new().fg(ACCENT)),
            bold(format!(
                "{:<width$}",
                clip(name_b, name_width),
                width = name_width
            )),
            Span::raw("  "),
            Span::styled(
                format!(
                    "{:<width$}",
                    charts::bar((p.jaccard * 1000.0) as u64, 1000, bar_width),
                    width = usize::from(bar_width)
                ),
                Style::new().fg(ACCENT),
            ),
            bold(format!(" {:>4}", percent(p.jaccard))),
            plain(format!(
                "  {} of {} commits changed both",
                grouped(u64::from(p.both)),
                grouped(u64::from(either))
            )),
        ]));
        let mut second = vec![
            Span::raw("     "),
            Span::styled(
                format!(
                    "{:>width$}",
                    fit(super::home(dir_a), name_width),
                    width = name_width
                ),
                Style::new().fg(MUTED),
            ),
            faint("     "),
            Span::styled(
                format!(
                    "{:<width$}",
                    fit(super::home(dir_b), name_width),
                    width = name_width
                ),
                Style::new().fg(MUTED),
            ),
            Span::raw("  "),
        ];
        if p.cross_directory {
            second.push(Span::styled("▲ across folders", Style::new().fg(WARNING)));
        } else {
            second.push(faint("same folder"));
        }
        lines.push(Line::from(second));
    }
    frame.render_widget(Paragraph::new(lines), inner);
    highlight(frame, inner, inner.y + (at * 2) as u16);
    highlight(frame, inner, inner.y + (at * 2) as u16 + 1);
}
