//! Risk: where a change is most likely to hurt. Hotspots, the files that
//! change together, and the folders only one person knows, as one list in
//! three sections.

use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::{bold, boxed, clip, dot, faint, fit, highlight, many, plain, short_phrase, split_path};
use crate::app::{App, RiskRow};
use crate::findings::Findings;
use crate::format::{grouped, most};
use crate::list::Cursor;
use crate::theme::{CRITICAL, HEAT, MUTED};

pub(super) fn draw(app: &App, frame: &mut Frame, area: Rect, cursor: &mut Cursor) {
    let Some(f) = app.current() else {
        return;
    };
    let rows = app.risk_rows(f);
    let inner = boxed(
        frame,
        area,
        "Risk",
        Some(format!("in {} · enter to open", short_phrase(app.span))),
    );
    cursor.step(0, rows.len());
    if rows.is_empty() {
        super::empty(
            frame,
            inner,
            if app.search.query.is_empty() {
                "Nothing stands out: no hotspots, no files that always change together, no folder only one person knows."
            } else {
                "Nothing matches the search."
            },
        );
        return;
    }

    // Every line, headings among them, and which line each row is on.
    let width = usize::from(inner.width);
    let mut lines: Vec<Line> = Vec::new();
    let mut at_line = Vec::with_capacity(rows.len());
    let mut section = None;
    for row in &rows {
        let kind = std::mem::discriminant(row);
        if section != Some(kind) {
            if section.is_some() {
                lines.push(Line::default());
            }
            lines.push(heading(*row, f));
            section = Some(kind);
        }
        at_line.push(lines.len());
        lines.push(super::fit_line(line(app, f, *row, width), width));
    }

    // Scrolled to keep the selection in view.
    let height = usize::from(inner.height);
    let selected = at_line.get(cursor.selected()).copied().unwrap_or(0);
    let start = (selected + 1).saturating_sub(height);
    let shown: Vec<Line> = lines.into_iter().skip(start).take(height).collect();
    frame.render_widget(Paragraph::new(shown), inner);
    highlight(frame, inner, inner.y + (selected - start) as u16);
    for (i, &l) in at_line.iter().enumerate() {
        if l >= start && l < start + height {
            let rect = Rect {
                y: inner.y + (l - start) as u16,
                height: 1,
                ..inner
            };
            app.clickable(rect, crate::app::Click::Row(i));
        }
    }
}

fn heading(row: RiskRow, f: &Findings) -> Line<'static> {
    let (title, what, count) = match row {
        RiskRow::Hotspot(_) => (
            "Hotspots",
            " code that changes often and is deeply nested",
            f.hotspots.len(),
        ),
        RiskRow::Group(_) => (
            "Change groups",
            " files that keep changing in the same commits",
            f.groups.len(),
        ),
        RiskRow::Silo(_) => (
            "Knowledge silos",
            " folders only one person committed to",
            f.silos.len(),
        ),
    };
    Line::from(vec![
        bold(format!(" {title}")),
        faint(format!("  {what} · {}", grouped(count as u64))),
    ])
}

fn line(app: &App, f: &Findings, row: RiskRow, width: usize) -> Line<'static> {
    let path = |file| app.index.paths.path_lossy(file);
    match row {
        RiskRow::Hotspot(i) => {
            let Some(h) = f.hotspots.get(i) else {
                return Line::default();
            };
            let full = path(h.file);
            let (dir, name) = split_path(&full);
            let name_width = longest_hotspot(app, f).clamp(8, (width / 4).max(8));
            let dir_width = (width / 5).max(8);
            Line::from(vec![
                Span::styled("  ◆ ", Style::new().fg(HEAT[2])),
                bold(format!("{:<name_width$}", clip(name, name_width))),
                Span::styled(
                    format!("  {:<dir_width$}", fit(super::home(dir), dir_width)),
                    Style::new().fg(MUTED),
                ),
                plain(format!(
                    "  changed {}",
                    many(u64::from(h.churn), "time", "times")
                )),
                faint(format!(
                    " · {} of {} · {} of {}",
                    most(h.churn_rank.place, "changed"),
                    grouped(u64::from(h.churn_rank.of)),
                    most(h.complexity_rank.place, "nested"),
                    grouped(u64::from(h.complexity_rank.of)),
                )),
            ])
        }
        RiskRow::Group(i) => {
            let Some(g) = f.groups.get(i) else {
                return Line::default();
            };
            let names: Vec<String> = g
                .files
                .iter()
                .map(|&file| split_path(&path(file)).1.to_string())
                .collect();
            let mut spans = vec![
                Span::styled("  ⇄ ", Style::new().fg(MUTED)),
                plain(format!(
                    "{} together",
                    many(u64::from(g.together), "time", "times")
                )),
                faint(if g.cross_directory {
                    ", across folders: ".to_string()
                } else {
                    ": ".to_string()
                }),
            ];
            spans.push(bold(fit(&names.join(", "), width.saturating_sub(34))));
            Line::from(spans)
        }
        RiskRow::Silo(i) => {
            let Some(s) = f.silos.get(i) else {
                return Line::default();
            };
            let label = super::folder(&s.directory.label()).to_string();
            let mut spans = vec![
                Span::styled("  ▲ ", Style::new().fg(CRITICAL)),
                bold(format!("{:<28}", fit(&label, 28))),
                faint(" only "),
                dot(app.colour_of(s.holder)),
                plain(app.display_name(s.holder)),
                faint(format!(
                    ", {}",
                    many(u64::from(s.directory.commits), "commit", "commits")
                )),
            ];
            match s.successor {
                Some((who, n)) => {
                    spans.push(faint(" · could take over: "));
                    spans.push(dot(app.colour_of(who)));
                    spans.push(plain(app.display_name(who)));
                    spans.push(faint(format!(
                        ", {} nearby",
                        many(u64::from(n), "commit", "commits")
                    )));
                }
                None => spans.push(faint(" · nobody else works nearby")),
            }
            Line::from(spans)
        }
    }
}

/// The longest file name among the Hotspots listed, so their columns line
/// up.
fn longest_hotspot(app: &App, f: &Findings) -> usize {
    f.hotspots
        .iter()
        .take(crate::app::RISK_ROWS)
        .map(|h| {
            split_path(&app.index.paths.path_lossy(h.file))
                .1
                .chars()
                .count()
        })
        .max()
        .unwrap_or(0)
}
